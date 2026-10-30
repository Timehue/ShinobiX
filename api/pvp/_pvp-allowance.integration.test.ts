import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { PvpSession } from './session.js';

// The valid-fight rules (api/pvp/_valid-fight.ts) through the real handlers:
// attack admission → session create → join → KO → claim-rewards for both
// fighters. Pay is read from each claim's `base.reward`, the authoritative
// receipt the client renders.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-valid-fight-integration-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let token: typeof import('../_auth.js').issuePlayerToken;
let attack: typeof import('../player/attack.js').default;
let create: typeof import('./session.js').default;
let move: typeof import('./move.js').default;
let claim: typeof import('./claim-rewards.js').default;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    attack = (await import('../player/attack.js')).default as unknown as typeof attack;
    create = (await import('./session.js')).default as unknown as typeof create;
    move = (await import('./move.js')).default as unknown as typeof move;
    claim = (await import('./claim-rewards.js')).default as unknown as typeof claim;
});

let seq = 0;
async function post(handler: typeof create, name: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.81.${Math.floor(++seq / 250)}.${seq % 250}`;
    await handler({ method: 'POST', body: { playerName: name, ...body }, query: {}, headers: { 'x-player-token': token(name), 'x-player-name': name, 'x-forwarded-for': ip }, socket: { remoteAddress: ip } } as never, res as never);
    return out;
}

const SECTOR = 12;
async function seed(name: string, extra: Record<string, unknown> = {}) {
    const character = { name, level: 100, village: 'Frostfang Village', ryo: 0, unspentStats: 0, hp: 10000, maxHp: 10000,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {},
        inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [], ...extra };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: SECTOR, character });
    online.upsert({ name, sector: SECTOR, character });
}

type Duel = { battleId: string; win: Record<string, any>; loss?: Record<string, any> };

/**
 * One real casual world duel won by `winner`. `full` plays it past the 3-round,
 * 60 s floor; `winnerHp` is the winner's HP at the KO (of 10,000), which sets
 * how much the loser dealt.
 */
async function duel(winner: string, loser: string, o: { full: boolean; winnerHp?: number; loserClaims?: boolean; loserExtra?: Record<string, unknown>; winnerExtra?: Record<string, unknown>; recoverClaim?: (failed: { status: number; body: Record<string, any> }, battleId: string) => Promise<void> }): Promise<Duel> {
    await seed(winner, o.winnerExtra);
    await seed(loser, o.loserExtra);
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
    if (o.full) mock.timers.tick(61_000);
    const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
    await kv.set(`pvp:${battleId}`, {
        ...live,
        ...(o.full ? { round: 4 } : {}),
        turnStartedAt: Date.now(), lastMoveAt: Date.now(),
        activePlayer: 'p1', roundOpener: 'p1',
        p1: { ...live.p1, pos: 62, hp: o.winnerHp ?? live.p1.hp },
        p2: { ...live.p2, pos: 63, hp: 1 },
    });
    const ko = await post(move, winner, { battleId, role: 'p1', action: 'basicAttack', moveToken: 'ko' });
    if (o.recoverClaim && ko.status >= 500) {
        // Reward storage can fail after the winning move committed. The
        // sealed outcome remains authoritative and its claim is retryable.
        const sealed = (await kv.get<PvpSession>('pvp:' + battleId))!;
        assert.equal(sealed.status, 'done', JSON.stringify(ko.body));
        assert.equal(sealed.winner, 'p1');
    } else {
        assert.equal(ko.body.status, 'done', JSON.stringify(ko.body));
        assert.equal(ko.body.winner, 'p1');
    }
    online.remove(winner); online.remove(loser);
    let win = await post(claim, winner, { battleId, outcome: 'win', completionVersion: 1 });
    if (o.recoverClaim) {
        await o.recoverClaim(win, battleId);
        win = await post(claim, winner, { battleId, outcome: 'win', completionVersion: 1 });
    }
    assert.equal(win.status, 200, JSON.stringify(win.body));
    const winAck = await post(claim, winner, { battleId, outcome: 'win', completionVersion: 1, completionAck: true });
    assert.equal(winAck.status, 200, JSON.stringify(winAck.body));
    let loss: Record<string, any> | undefined;
    if (o.loserClaims !== false) {
        const lost = await post(claim, loser, { battleId, outcome: 'loss', completionVersion: 1 });
        assert.equal(lost.status, 200, JSON.stringify(lost.body));
        loss = lost.body;
        const lossAck = await post(claim, loser, { battleId, outcome: 'loss', completionVersion: 1, completionAck: true });
        assert.equal(lossAck.status, 200, JSON.stringify(lossAck.body));
    }
    return { battleId, win: win.body, loss };
}

test('one pair alternating wins mints at most 2.75 fights a day from one shared counter', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 12, 0, 0) });
    t.after(() => mock.timers.reset());
    const a = 'validpaira', b = 'validpairb';
    const pays: number[] = [];
    const dust: number[] = [];
    const weights: number[] = [];
    for (let i = 0; i < 5; i += 1) {
        const [winner, loser] = i % 2 === 0 ? [a, b] : [b, a];
        const out = await duel(winner, loser, { full: true });
        pays.push(out.win.base.reward.ryo);
        dust.push(out.win.base.reward.auraDust);
        weights.push(out.win.base.reward.credit.pairWeight);
        if (i === 0) {
            // A replayed claim neither pays twice nor moves the pair counter.
            const before = (await kv.get<Record<string, any>>(`save:${winner}`))!.character.ryo;
            const replay = await post(claim, winner, { battleId: out.battleId, outcome: 'win', completionVersion: 1 });
            assert.equal(replay.status, 200, JSON.stringify(replay.body));
            assert.equal((await kv.get<Record<string, any>>(`save:${winner}`))!.character.ryo, before);
        }
    }
    // PVP_PURSE_SCALE 1 at launch (owner A13): 13.5 x A(100) = 4,050 per full win.
    assert.deepEqual(weights, [1, 1, 0.5, 0.25, 0]);
    assert.deepEqual(pays, [4050, 4050, 2025, 1012, 0]);
    assert.deepEqual(dust, [6, 6, 3, 1, 0]);
    assert.equal(await kv.get(`pvp:pair:${a}:${b}:2026-10-21`), 5);
});

test('a short KO pays the winner half and the loser nothing; stat points still follow the shared budget', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 13, 0, 0) });
    t.after(() => mock.timers.reset());
    const out = await duel('validshortwin', 'validshortlose', { full: false, winnerHp: 5000 });
    assert.equal(out.win.base.reward.ryo, 2025, 'floor(4,050 x 0.5)');
    assert.equal(out.win.base.reward.credit.short, true);
    assert.ok(out.win.base.reward.combatGrowth > 0, 'a short KO is still a credited win');
    assert.equal(out.loss?.base?.reward?.ryo, 0, 'no loss pay below the 3-round, 60 s floor');
    const winner = (await kv.get<Record<string, any>>('save:validshortwin'))!.character;
    assert.equal(winner.totalPvpKills, 1);
    // The clan "Win 20 Battles" mission and Clan Patriot count this; nothing used to.
    assert.equal(winner.clanBattleContrib, 1);
    assert.equal(winner.clanContribMonth, '2026-10');
});

test('an engaged loser earns 0.4 of the win purse, once', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 14, 0, 0) });
    t.after(() => mock.timers.reset());
    const out = await duel('validlosswin', 'validlosslose', { full: true, winnerHp: 8000 });
    assert.equal(out.win.base.reward.ryo, 4050);
    assert.equal(out.loss?.base?.reward?.ryo, 1620);
    assert.equal(out.loss?.base?.reward?.combatGrowth, 0, 'stat points stay win-only');
    const after = (await kv.get<Record<string, any>>('save:validlosslose'))!.character.ryo;
    const replay = await post(claim, 'validlosslose', { battleId: out.battleId, outcome: 'loss', completionVersion: 1 });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal((await kv.get<Record<string, any>>('save:validlosslose'))!.character.ryo, after, 'a replayed loss claim pays once');

    // A loser who dealt under 15% of the winner's max HP did not engage.
    const passive = await duel('validpassivewin', 'validpassivelose', { full: true, winnerHp: 9000 });
    assert.equal(passive.loss?.base?.reward?.ryo, 0);
});

test('a >20-level stomp and a fresh-alt loser pay nothing and take no pair slot', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 15, 0, 0) });
    t.after(() => mock.timers.reset());
    const nothing = { ryo: 0, combatGrowth: 0, auraDust: 0 };
    const reward = (body: Record<string, any>) => ({ ryo: body.base.reward.ryo, combatGrowth: body.base.reward.combatGrowth, auraDust: body.base.reward.auraDust });

    const stomp = await duel('validstompwin', 'validstomplose', { full: true, loserClaims: false, loserExtra: { level: 70 } });
    assert.deepEqual(reward(stomp.win), nothing);
    assert.equal(stomp.win.base.reward.credit.reason, 'level-gap');
    assert.equal(await kv.get('pvp:pair:validstomplose:validstompwin:2026-10-21'), null);
    assert.equal((await kv.get<Record<string, any>>('save:validstompwin'))!.character.totalPvpKills, 1, 'the kill still counts');

    // A fresh alt below L20 is not established (owner A14: 72 h old OR L20).
    const fresh = await duel('validfreshwin', 'validfreshlose', { full: true, loserClaims: false,
        winnerExtra: { level: 19 }, loserExtra: { level: 19, createdAt: Date.now() - 71 * 3_600_000 } });
    assert.deepEqual(reward(fresh.win), nothing);
    assert.equal(fresh.win.base.reward.credit.reason, 'too-young');
    assert.equal(await kv.get('pvp:pair:validfreshlose:validfreshwin:2026-10-21'), null);

    // The same fresh account at L100 is established, so a reset week pays.
    const established = await duel('validnewwin', 'validnewlose', { full: true, loserClaims: false,
        loserExtra: { createdAt: Date.now() - 71 * 3_600_000 } });
    assert.ok(established.win.base.reward.ryo > 0, JSON.stringify(established.win.base.reward));
});


test('pair storage failures leave legitimate and exhausted claims retryable without duplicate pay', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 16, 0, 0) });
    t.after(() => mock.timers.reset());
    const compareSetMany = kv.compareSetMany!.bind(kv);
    let unavailable = true;
    t.mock.method(kv as typeof kv & { compareSetMany: NonNullable<typeof kv.compareSetMany> }, 'compareSetMany', async (ops: Parameters<NonNullable<typeof kv.compareSetMany>>[0]) => {
        if (unavailable && ops.some((op: { key: string }) => op.key.startsWith('pvp:pair:'))) {
            throw new Error('pair-counter transaction unavailable');
        }
        return compareSetMany(ops);
    });
    for (const exhausted of [false, true]) {
        const winner = exhausted ? 'retryexhaustedwin' : 'retryvalidwin';
        const loser = exhausted ? 'retryexhaustedlose' : 'retryvalidlose';
        const counterKey = 'pvp:pair:' + [winner, loser].sort().join(':') + ':2026-10-21';
        if (exhausted) await kv.set(counterKey, 5);
        unavailable = true;
        const result = await duel(winner, loser, {
            full: true, winnerHp: 8000,
            recoverClaim: async (failed) => {
                assert.equal(failed.status, 503, JSON.stringify(failed.body));
                assert.equal((await kv.get<Record<string, any>>('save:' + winner))!.character.ryo, 0);
                assert.equal(await kv.get(counterKey), exhausted ? 5 : null, 'no partial pair allocation');
                unavailable = false;
            },
        });
        assert.equal(result.win.base.reward.ryo, exhausted ? 0 : 4050);
        assert.equal(result.loss?.base?.reward?.ryo, exhausted ? 0 : 1620);
        assert.equal(await kv.get(counterKey), exhausted ? 6 : 1);
        const before = (await kv.get<Record<string, any>>('save:' + winner))!.character.ryo;
        const replay = await post(claim, winner, { battleId: result.battleId, outcome: 'win', completionVersion: 1 });
        assert.equal(replay.status, 200);
        assert.equal((await kv.get<Record<string, any>>('save:' + winner))!.character.ryo, before);
        assert.equal(await kv.get(counterKey), exhausted ? 6 : 1, 'both sides and replays share one slot');
    }
});
