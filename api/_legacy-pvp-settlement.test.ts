import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PvpSession } from './pvp/session.js';
import type { LegacyStats } from './_legacy-track.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';
let kv: typeof import('./_storage.js').kv;
let settle: typeof import('./_legacy-pvp-settlement.js').settlePvpLegacyProgress;
let bump: typeof import('./_legacy-track.js').bumpLegacyStats;
before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ settlePvpLegacyProgress: settle } = await import('./_legacy-pvp-settlement.js'));
    ({ bumpLegacyStats: bump } = await import('./_legacy-track.js'));
});

async function battle(id: string, at = Date.now()): Promise<PvpSession> {
    const winner = `${id}winner`, loser = `${id}loser`;
    for (const name of [winner, loser]) await kv.set(`save:${name}`, { character: { name, level: 100, specialty: 'Ninjutsu', createdAt: at - 10 * 86400_000 } });
    return {
        battleId: id, status: 'done', winner: 'p1', rewardAuthority: 'world', progressionAuthorityVersion: 1,
        round: 1, activePlayer: 'p1', ap: { p1: 100, p2: 100 }, actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        joined: { p1: true, p2: true }, realFighters: { p1: true, p2: true },
        createdAt: at - 30_000, endedAt: at, lastMoveAt: at,
        worldAttacker: { side: 'p2', name: loser, village: 'Leaf' },
        p1: { name: winner, hp: 100, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            shield: 0, statuses: [], pos: 0, character: { level: 100, specialty: 'Ninjutsu' } },
        p2: { name: loser, hp: 0, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            shield: 0, statuses: [], pos: 1, character: { level: 100, specialty: 'Genjutsu' } },
        log: [`100 damage to ${loser}.`, `${winner} uses Basic Heal, restoring 50 HP.`, `Heal: ${loser} restores 50 HP.`],
    };
}
const stats = async (name: string) => (await kv.get<LegacyStats>(`legacy:stats:${name}`))!;

test('server terminal delivery credits both fighters once without a win-report, including 40-hour recovery', async () => {
    const session = await battle('legacyraidrepair', Date.now() - 40 * 3600_000);
    await kv.set(`legacy:guard-defense:${session.battleId}`, { defender: session.p1.name, attacker: session.p2.name });
    await settle(session);
    await settle(session);
    const winner = await stats(session.p1.name), loser = await stats(session.p2.name);
    assert.equal(winner.pvpWins, 1);
    assert.equal(winner.ninjutsuKills, 1);
    assert.equal(winner.ninjutsuDamage, 100);
    assert.equal(winner.defensiveWins, 1);
    assert.equal(winner.healingDone, 50);
    assert.equal(loser.pvpLosses, 1);
    assert.equal(loser.healingDone, 50);
    await bump(session.p1.name, { defensiveWins: 1, sectorDefenses: 1, warContribution: 2000 }, {
        pvpTarget: session.p2.name, pvpAttributionId: session.battleId, pvpAttributionAt: session.endedAt,
        receiptId: `sector:${session.battleId}`, durableReceipt: true,
    });
    assert.equal((await stats(session.p1.name)).defensiveWins, 1, 'one defense also scoring a war remains one victory');
    assert.equal((await stats(session.p1.name)).warContribution, 2000);
});

test('a guard challenge retains its server evidence through delayed terminal recovery', async (t) => {
    const at = Date.now();
    const session = await battle('legacyguardretention', at);
    await kv.set(`guard:${session.p1.name}`, { name: session.p1.name, village: 'Stormveil Village', level: 100, lastSeen: at });
    const previousAdmin = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = 'legacy-guard-retention-test';
    try {
        const handler = (await import('./village-guard/challenge.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
        let statusCode = 200;
        const res = {
            setHeader() { return this; }, status(code: number) { statusCode = code; return this; },
            json() { return this; }, end() { return this; },
        };
        await handler({
            method: 'POST', body: { attackerCharacter: { name: session.p2.name }, village: 'Stormveil Village', guardName: session.p1.name, battleId: session.battleId },
            headers: { 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '198.51.100.83' },
            socket: { remoteAddress: '198.51.100.83' },
        } as never, res as never);
        assert.equal(statusCode, 200);
        assert.ok(await kv.get(`legacy:guard-defense:${session.battleId}`), 'actual challenge must publish defense proof');
        t.mock.method(Date, 'now', () => at + 40 * 3600_000);
        await settle(session);
        assert.equal((await stats(session.p1.name)).defensiveWins, 1);
        assert.equal((await stats(session.p1.name)).sectorDefenses, 1);
        assert.equal(await kv.get(`legacy:guard-defense:${session.battleId}`), null, 'successful delivery retires the marker');
    } finally {
        if (previousAdmin === undefined) delete process.env.ADMIN_PASSWORD;
        else process.env.ADMIN_PASSWORD = previousAdmin;
    }
});

test('guard proof must name both actual battle participants', async () => {
    for (const defender of ['p1', 'p2'] as const) {
        const session = await battle(`legacyguardseal${defender}`);
        session.winner = defender;
        await kv.set(`legacy:guard-defense:${session.battleId}`, { defender: session[defender].name, attacker: 'unrelatedplayer' });
        await settle(session);
        const guard = await stats(session[defender].name);
        assert.equal(guard.pvpWins, 1);
        assert.equal(guard.defensiveWins, undefined);
        assert.equal(guard.sectorDefenses, undefined);
        assert.equal(guard.warPvpKills, undefined);
    }
});

test('guard proof cannot reverse the server-sealed attacker and defender', async () => {
    const session = await battle('legacyreversedguard');
    await kv.set(`legacy:guard-defense:${session.battleId}`, { defender: session.p2.name, attacker: session.p1.name });
    await settle(session);
    const winner = await stats(session.p1.name);
    assert.equal(winner.pvpWins, 1);
    assert.equal(winner.defensiveWins, undefined);
    assert.equal(winner.warPvpKills, undefined);
});

test('a failed loser write retries the same terminal without recrediting the winner', async () => {
    const session = await battle('legacywritegap');
    await kv.set(`legacy:stats:${session.p2.name}`, { bootstrappedAt: Date.now() });
    const original = kv.set;
    let fail = true;
    kv.set = async (key, value, options) => {
        if (fail && key === `legacy:stats:${session.p2.name}`) { fail = false; return null; }
        return original(key, value, options);
    };
    try { await assert.rejects(settle(session), /delivery-pending/); } finally { kv.set = original; }
    assert.equal(await kv.get(`legacy:pvp-tracked:${session.battleId}`), null);
    await settle(session);
    assert.equal((await stats(session.p1.name)).pvpWins, 1);
    assert.equal((await stats(session.p2.name)).pvpLosses, 1);
});

test('pending combat and war delivery retain their battle proof through later activity receipt churn', async () => {
    const session = await battle('legacyreceiptchurn', Date.now() - 40 * 3600_000);
    await kv.set(`legacy:stats:${session.p2.name}`, { bootstrappedAt: Date.now() });
    const original = kv.set;
    let fail = true;
    kv.set = async (key, value, options) => {
        if (fail && key === `legacy:stats:${session.p2.name}`) { fail = false; return null; }
        return original(key, value, options);
    };
    try { await assert.rejects(settle(session), /delivery-pending/); } finally { kv.set = original; }
    // Legitimate later deeds can exceed the ordinary rolling receipt window.
    for (let i = 0; i < 270; i++) await bump(session.p1.name, { missionCompletions: 1 }, { receiptId: `later-mission:${i}` });
    await settle(session);
    assert.equal((await stats(session.p1.name)).pvpWins, 1, 'repair cannot credit the already-delivered winner again');
    assert.equal((await stats(session.p2.name)).pvpLosses, 1);
    // Even further attributed fights cannot change this earlier battle's weight.
    for (let i = 0; i < 5; i++) await settle({ ...session, battleId: `${session.battleId}-later-${i}` });
    await bump(session.p1.name, { warPvpKills: 1 }, {
        pvpTarget: session.p2.name, pvpAttributionId: session.battleId, pvpAttributionAt: session.endedAt,
        receiptId: `war:${session.battleId}`, durableReceipt: true,
    });
    assert.equal((await stats(session.p1.name)).warPvpKills, 1, 'pending war credit reuses the original full weight');
});

test('repeat-opponent decay applies to loser support and war proof, then renews next UTC day', async () => {
    const session = await battle('legacydailydecay');
    for (let i = 0; i < 6; i++) {
        const current = { ...session, battleId: `${session.battleId}-${i}` };
        await settle(current);
        await bump(session.p1.name, { warPvpKills: 1 }, {
            pvpTarget: session.p2.name, pvpAttributionId: current.battleId, pvpAttributionAt: session.endedAt,
            receiptId: `war:${current.battleId}`,
        });
    }
    assert.equal((await stats(session.p1.name)).pvpWins, 2.75);
    assert.equal((await stats(session.p1.name)).warPvpKills, 2.75, 'war uses the battle weight without consuming another encounter');
    assert.equal((await stats(session.p2.name)).healingDone, 137.5);
    const tomorrow = Number(session.endedAt) + 86400_000;
    await settle({ ...session, battleId: `${session.battleId}-tomorrow`, createdAt: tomorrow - 30_000, lastMoveAt: tomorrow, endedAt: tomorrow });
    assert.equal((await stats(session.p1.name)).pvpWins, 3.75);
    assert.equal((await stats(session.p2.name)).healingDone, 187.5);
});

test('practice, pet, NPC and quick-surrender battles do not grant player proof', async () => {
    const session = await battle('legacyexcluded');
    for (const candidate of [
        { ...session, rewardAuthority: undefined }, { ...session, rankedKind: 'pet' },
        { ...session, realFighters: { p1: true, p2: false } }, { ...session, lastMoveAt: session.createdAt + 1000 },
    ]) await settle(candidate as PvpSession);
    assert.equal(await kv.get(`legacy:stats:${session.p1.name}`), null);
});
