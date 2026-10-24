import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PvpSession } from './session.js';

// I-12 through the real handlers: the admin growth event scales the casual PvP
// stat REQUEST, the shared daily stat-point budget (60, owner ruling A1; mission
// claims draw from it too) bounds the credit, and the era dial
// (STAT_GAIN_MULTIPLIER) never touches combat wins. Before the fix the budget
// was charged the unboosted 6 and the credit was multiplied afterwards, so dial
// 2.5 x event 2 paid 30 + 30 + 30 = 90 in a day.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-growth-budget-integration-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let token: typeof import('../_auth.js').issuePlayerToken;
let attack: typeof import('../player/attack.js').default;
let create: typeof import('./session.js').default;
let move: typeof import('./move.js').default;
let claim: typeof import('./claim-rewards.js').default;
let clearProcCache: () => void;
let BOOST_EVENT_KEY: string;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    attack = (await import('../player/attack.js')).default as unknown as typeof attack;
    create = (await import('./session.js')).default as unknown as typeof create;
    move = (await import('./move.js')).default as unknown as typeof move;
    claim = (await import('./claim-rewards.js')).default as unknown as typeof claim;
    ({ __clearProcCache: clearProcCache } = await import('../_proc-cache.js'));
    ({ BOOST_EVENT_KEY } = await import('../_boost-event.js'));
});

let seq = 0;
async function post(handler: typeof create, name: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.79.0.${++seq}`;
    await handler({ method: 'POST', body: { playerName: name, ...body }, query: {}, headers: { 'x-player-token': token(name), 'x-player-name': name, 'x-forwarded-for': ip }, socket: { remoteAddress: ip } } as never, res as never);
    return out;
}

const SECTOR = 12;
async function seed(name: string) {
    const character = { name, level: 100, village: 'Frostfang Village', ryo: 0, unspentStats: 0, hp: 10000, maxHp: 10000,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {},
        inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [] };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: SECTOR, character });
    online.upsert({ name, sector: SECTOR, character });
}
async function rejoinWorld(name: string) {
    const save = await kv.get<Record<string, any>>(`save:${name}`);
    online.upsert({ name, sector: SECTOR, character: save!.character });
}

/** One real casual world duel won by `winner`, claimed through claim-rewards. */
async function winAndClaim(winner: string, loser: string) {
    await seed(loser);
    await rejoinWorld(winner);
    const admission = await post(attack, winner, { targetName: loser, attacker: { name: winner } });
    assert.equal(admission.status, 200, JSON.stringify(admission.body));
    const loserCharacter = (await kv.get<Record<string, any>>(`save:${loser}`))!.character;
    const made = await post(create, winner, { p1Character: { name: winner }, p2Character: loserCharacter,
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const battleId = (made.body.session as PvpSession).battleId;
    for (const [name, role] of [[winner, 'p1'], [loser, 'p2']] as const) {
        const joined = await post(move, name, { battleId, role, action: 'join', moveToken: `join-${role}` });
        assert.equal(joined.status, 200, JSON.stringify(joined.body));
    }
    const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
    // Deterministic board: adjacent, defender on 1 HP. Every action and reward
    // still runs through the real handlers.
    await kv.set(`pvp:${battleId}`, { ...live, activePlayer: 'p1', roundOpener: 'p1', p1: { ...live.p1, pos: 62 }, p2: { ...live.p2, pos: 63, hp: 1 } });
    const ko = await post(move, winner, { battleId, role: 'p1', action: 'basicAttack', moveToken: 'ko' });
    assert.equal(ko.body.status, 'done', JSON.stringify(ko.body));
    assert.equal(ko.body.winner, 'p1');
    online.remove(winner); online.remove(loser);
    const paid = await post(claim, winner, { battleId, outcome: 'win', completionVersion: 1 });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    // Complete the settlement so the winner may start the next duel.
    const ack = await post(claim, winner, { battleId, outcome: 'win', completionVersion: 1, completionAck: true });
    assert.equal(ack.status, 200, JSON.stringify(ack.body));
    return Number(paid.body.base.reward.combatGrowth);
}

test('a growth event fills the shared daily budget sooner but never raises it; the era dial is ignored', async (t) => {
    // The budget key is combat-stat-count:<player>:<UTC day>, so hold one day.
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 17, 12, 0, 0) });
    const previousDial = process.env.STAT_GAIN_MULTIPLIER;
    process.env.STAT_GAIN_MULTIPLIER = '2.5';
    t.after(() => {
        if (previousDial === undefined) delete process.env.STAT_GAIN_MULTIPLIER;
        else process.env.STAT_GAIN_MULTIPLIER = previousDial;
    });
    const now = Date.now();
    await kv.set(BOOST_EVENT_KEY, { id: 'growth-budget-test', multiplier: 2, targets: ['growth'], startsAt: now - 60_000, endsAt: now + 3_600_000 });
    clearProcCache();
    t.after(async () => { await kv.del(BOOST_EVENT_KEY); clearProcCache(); });

    const winner = 'growthbudgetwinner';
    await seed(winner);
    // Fourteen hunt claims earlier in the day spent 42 of the 60 (the claims
    // credit their own saves; only the shared budget row matters here).
    const { reserveDailyStatPoints } = await import('../_daily-stat-budget.js');
    for (let i = 0; i < 14; i += 1) {
        const claimed = await reserveDailyStatPoints(kv, { playerName: winner, receiptId: `mission:2026-10-17:hunt:hunt-wild-boar:seed${i}`, eventAt: now, requested: 3 });
        assert.equal(claimed.points, 3);
    }
    const credits = [];
    for (const loser of ['growthbudgetlosera', 'growthbudgetloserb', 'growthbudgetloserc']) {
        credits.push(await winAndClaim(winner, loser));
    }
    assert.deepEqual(credits, [12, 6, 0], 'event-scaled requests of 12 are bounded by the 18 left of the shared budget');
    const save = (await kv.get<Record<string, any>>(`save:${winner}`))!;
    assert.equal(save.character.unspentStats, 18, 'exactly what was left of the daily budget reached the pool');
});
