import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PvpSession } from './session.js';
import { PVP_CASUAL_STAT_POINTS_PER_WIN, statGainMultiplier } from '../_stat-growth.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'obsidian-stronghold-integration-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let token: typeof import('../_auth.js').issuePlayerToken;
let enter: typeof import('../village/_stronghold.js').handleStrongholdAction;
let attack: typeof import('../player/attack.js').default;
let create: typeof import('./session.js').default;
let move: typeof import('./move.js').default;
let claim: typeof import('./claim-rewards.js').default;
let reportRaid: typeof import('../missions/report-raid.js').default;
let location: typeof import('../_stronghold-presence.js');
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ handleStrongholdAction: enter } = await import('../village/_stronghold.js'));
    attack = (await import('../player/attack.js')).default as unknown as typeof attack;
    create = (await import('./session.js')).default as unknown as typeof create;
    move = (await import('./move.js')).default as unknown as typeof move;
    claim = (await import('./claim-rewards.js')).default as unknown as typeof claim;
    reportRaid = (await import('../missions/report-raid.js')).default as unknown as typeof reportRaid;
    location = await import('../_stronghold-presence.js');
});
let seq = 0;
async function post(handler: typeof create, name: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.78.0.${++seq}`;
    await handler({ method: 'POST', body: { playerName: name, ...body }, query: {}, headers: { 'x-player-token': token(name), 'x-player-name': name, 'x-forwarded-for': ip }, socket: { remoteAddress: ip } } as never, res as never);
    return out;
}
const FLICKER = 'starter-universal-flicker';
async function seed(name: string, sector = 99) {
    const character = { name, level: 100, village: 'Frostfang Village', ryo: 0, hp: 10000, maxHp: 10000,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {},
        inventory: [], itemStacks: [], equippedJutsuIds: [FLICKER], jutsu: [], jutsuMastery: [{ jutsuId: FLICKER, level: 1, xp: 0 }] };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: sector, character });
    online.upsert({ name, sector, character });
    return character;
}
async function start(suffix: string, inside: boolean, sector = 99) {
    const one = `obsone${suffix}`, two = `obstwo${suffix}`;
    const p1Character = await seed(one, sector), p2Character = await seed(two, sector);
    if (inside) for (const name of [one, two]) {
        const admitted = await enter(name, 'stronghold-enter', { sector, presenceId: `obsidian-tab-${name}` });
        assert.equal(admitted.status, 200, JSON.stringify(admitted.body));
    }
    const admission = await post(attack, one, { targetName: two, attacker: { name: one } });
    assert.equal(admission.status, 200, JSON.stringify(admission.body));
    // Extra reward/cast fields are deliberately forged, including on the outside case.
    const made = await post(create, one, { battleId: `obsidian${suffix}000000000000`, p1Character, p2Character,
        baseRewards: true, rewardSector: sector, useCurrentVitals: true, requireWorldCoLocation: true,
        rewardStronghold: 'deathsgate', jutsuUsed: { p1: [FLICKER], p2: [] } });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const session = made.body.session as PvpSession;
    assert.equal(session.rewardAuthority, 'world');
    assert.equal(session.rewardStronghold, inside && sector === 99 ? 'deathsgate' : undefined);
    assert.equal(session.jutsuUsed, undefined, 'client cannot claim to have cast a jutsu');
    for (const [name, role] of [[one, 'p1'], [two, 'p2']] as const) {
        const joined = await post(move, name, { battleId: session.battleId, role, action: 'join', moveToken: `join-${role}` });
        assert.equal(joined.status, 200, JSON.stringify(joined.body));
    }
    return { one, two, battleId: session.battleId };
}

for (const [suffix, inside, sector, multiplier] of [['inside', true, 99, 4], ['outside', false, 99, 2], ['normal', true, 12, 1]] as const) {
    test(`${suffix}: admission → committed cast → KO → reward claim, with replay and location changes`, async () => {
        const { one, two, battleId } = await start(suffix, inside, sector);
        const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        // Deterministic board setup; every action and reward still uses the real handler.
        await kv.set(`pvp:${battleId}`, { ...live, activePlayer: 'p1', roundOpener: 'p1', p1: { ...live.p1, pos: 61 }, p2: { ...live.p2, pos: 63, hp: 1 } });
        const invalid = await post(move, one, { battleId, role: 'p1', action: 'jutsu', jutsuId: FLICKER, tile: 63, moveToken: 'invalid-cast' });
        assert.ok(invalid.body.rejected, JSON.stringify(invalid.body));
        assert.equal((await kv.get<PvpSession>(`pvp:${battleId}`))?.jutsuUsed, undefined);
        const castBody = { battleId, role: 'p1', action: 'jutsu', jutsuId: FLICKER, tile: 62, moveToken: 'real-cast' };
        const cast = await post(move, one, castBody);
        assert.equal(cast.status, 200, JSON.stringify(cast.body));
        assert.equal(cast.body.rejected, undefined, JSON.stringify(cast.body));
        await post(move, one, castBody);
        assert.deepEqual((await kv.get<PvpSession>(`pvp:${battleId}`))?.jutsuUsed?.p1, [FLICKER], 'move retry cannot duplicate mastery evidence');
        const ko = await post(move, one, { battleId, role: 'p1', action: 'basicAttack', moveToken: 'ko' });
        assert.equal(ko.body.status, 'done', JSON.stringify(ko.body));
        assert.equal(ko.body.winner, 'p1');
        location.leaveStrongholdPresence(one); location.leaveStrongholdPresence(two);
        online.remove(one); online.remove(two);
        const paid = await post(claim, one, { battleId, outcome: 'win', completionVersion: 1 });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        assert.equal(paid.body.base.reward.ryo, 75 * multiplier);
        assert.equal(paid.body.base.reward.combatGrowth, Math.round(PVP_CASUAL_STAT_POINTS_PER_WIN * statGainMultiplier() * multiplier));
        assert.equal(paid.body.base.reward.jutsuXp, 10 * multiplier);
        assert.equal(paid.body.base.reward.auraDust, 6, 'unrelated rewards do not multiply');
        const save = (await kv.get<Record<string, any>>(`save:${one}`))!;
        assert.equal(save.character.jutsuMastery.find((r: any) => r.jutsuId === FLICKER).xp, 10 * multiplier);
        await kv.del(`pvp:${battleId}`); // Claim recovery uses the sealed snapshot, not current presence.
        const replay = await post(claim, one, { battleId, outcome: 'win', completionVersion: 1 });
        assert.equal(replay.status, 200, JSON.stringify(replay.body));
        const again = (await kv.get<Record<string, any>>(`save:${one}`))!;
        assert.equal(again.character.ryo, save.character.ryo);
        assert.deepEqual(again.character.jutsuMastery, save.character.jutsuMastery);
        if (sector === 99) {
            const nextOpponent = `obsthree${suffix}`;
            const nextCharacter = await seed(nextOpponent, sector);
            const nextBody = { p1Character: { name: one }, p2Character: nextCharacter };
            const blocked = await post(create, one, nextBody);
            assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
            assert.match(String(blocked.body.error), /pending PvP battle settlement/);

            const reported = await post(reportRaid, one, { battleId });
            assert.equal(reported.status, 200, JSON.stringify(reported.body));
            assert.deepEqual(reported.body.fetchMissionsCredited, []);
            const acknowledged = await post(claim, one, {
                battleId, outcome: 'win', completionVersion: 1, completionAck: true,
            });
            assert.equal(acknowledged.status, 200, JSON.stringify(acknowledged.body));
            assert.equal(acknowledged.body.completionPending, false);
            const { loadPvpPendingSessionPointer } = await import('./_pending-session.js');
            assert.equal(await loadPvpPendingSessionPointer(kv, one), null);

            const next = await post(create, one, nextBody);
            assert.equal(next.status, 200, JSON.stringify(next.body));
        }
    });
}

test('Death’s Gate players on opposite sides of the entrance cannot fight', async () => {
    const one = 'obsboundaryone', two = 'obsboundarytwo';
    await seed(one); await seed(two);
    await enter(one, 'stronghold-enter', { sector: 99, presenceId: 'obsidian-boundary' });
    const blocked = await post(attack, one, { targetName: two, attacker: { name: one } });
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.body.error), /stronghold/);
});
