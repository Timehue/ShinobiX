import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PvpSession } from './session.js';
import { isCancelledUnstartedPvpDuel } from '../../shared/pvp-cancellation.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'cancel-duel-lifecycle-test';

let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let issueToken: typeof import('../_auth.js').issuePlayerToken;
type Handler = (req: never, res: never) => Promise<unknown>;
let move: Handler;
let claim: Handler;
let getSession: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken: issueToken } = await import('../_auth.js'));
    move = (await import('./move.js')).default as unknown as Handler;
    claim = (await import('./claim-rewards.js')).default as unknown as Handler;
    getSession = (await import('./session.js')).default as unknown as Handler;
});

async function call(handler: typeof move, name: string, body: Record<string, unknown>, query?: Record<string, string>) {
    const out = { status: 200, body: undefined as any };
    const res = {
        setHeader() { return res; },
        status(status: number) { out.status = status; return res; },
        json(value: unknown) { out.body = value; return res; },
        end() { return res; },
    };
    await handler({
        method: query ? 'GET' : 'POST', body: { playerName: name, ...body }, query: query ?? {},
        headers: { 'x-player-token': issueToken(name), 'x-forwarded-for': '127.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function seed(id: string) {
    const now = Date.now();
    const fighter = (name: string, pos: number) => ({
        name, pos, hp: 90, maxHp: 100, chakra: 70, maxChakra: 100,
        stamina: 60, maxStamina: 100, shield: 0, statuses: [],
        character: { name, level: 20, village: 'Leaf', stats: {}, jutsu: [], pvpItems: [] },
    });
    const session: PvpSession = {
        battleId: id, stateRevision: 1, p1: fighter(`${id}a`, 0), p2: fighter(`${id}b`, 1),
        round: 1, activePlayer: 'p1', ap: { p1: 100, p2: 100 }, actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} }, log: ['Battle begins.'], status: 'active', winner: null,
        rewardAuthority: 'world', continuousVitals: true, realFighters: { p1: true, p2: true },
        joined: { p1: true, p2: false }, createdAt: now - 100, lastMoveAt: now,
        itemsUsed: { p1: {}, p2: {} },
    };
    await kv.set(`pvp:${id}`, session);
    for (const role of ['p1', 'p2'] as const) {
        const name = session[role].name;
        await kv.set(`save:${name}`, { _saveVersion: 17, character: {
            ...session[role].character, hp: 95, maxHp: 100, chakra: 85, maxChakra: 100,
            stamina: 80, maxStamina: 100, ryo: 700, inventory: [], itemStacks: [],
        } });
        // Also cover a stale pointer/lock on the target who never joined.
        await kv.set(`pvp:pending-session:${name}`, JSON.stringify({
            version: 1, playerName: name, battleId: id, role,
            createdAt: session.createdAt, phase: 'active',
        }));
        await kv.set(`battle-state:${name}`, {
            version: 1, kind: 'pvp', sessionId: id, startedAt: session.createdAt, expiresAt: now + 60_000,
        });
        online.upsert({ name, sector: 53, character: null });
        online.setInBattle(name, true);
        online.setPendingAttacker(name, { name: session[role === 'p1' ? 'p2' : 'p1'].name });
        assert.equal(online.moveToTile(name, 10), null);
    }
    return session;
}

test('cancellation releases both players and never writes their saves or runs browser settlement', async () => {
    for (const cancellingRole of ['p1', 'p2'] as const) {
        const session = await seed(`cancel-${cancellingRole}`);
        const saves = await Promise.all([session.p1, session.p2].map(f => kv.get(`save:${f.name}`)));
        const result = await call(move, session[cancellingRole].name, {
            battleId: session.battleId, role: cancellingRole, action: 'cancel-unjoined',
        });
        assert.equal(result.status, 200);
        assert.equal(isCancelledUnstartedPvpDuel(result.body), true);
        assert.equal(result.body.terminalReason, 'cancelled-unjoined');
        for (const [i, fighter] of [session.p1, session.p2].entries()) {
            assert.equal(online.moveToTile(fighter.name, 10)?.tile, 10, 'movement resumes before any claim');
            assert.equal(online.get(fighter.name)?.pendingAttacker, null);
            assert.equal(await kv.get(`pvp:pending-session:${fighter.name}`), null);
            const reward = await call(claim, fighter.name, {
                battleId: session.battleId, outcome: 'draw', completionVersion: 1,
            });
            assert.equal(reward.status, 200);
            assert.equal(reward.body.completionPending, false, 'no battle-history save or completion ACK');
            assert.equal(reward.body.rewardAuthorized, false);
            assert.deepEqual(await kv.get(`save:${fighter.name}`), saves[i], 'no damage, inventory, reward, or version write');
            assert.equal((await call(getSession, fighter.name, {}, {
                pending: '1', playerName: fighter.name, recoveryProbeVersion: '2',
            })).status, 204);
        }
        const retry = await call(move, session.p1.name, { battleId: session.battleId, role: 'p1', action: 'cancel-unjoined' });
        assert.equal(retry.status, 200);
        assert.equal(retry.body.log.filter((line: string) => line.includes('cancelled the unstarted duel')).length, 1);
    }
});

test('pending recovery repairs a legacy cancellation after a crash, including after the live row expires', async () => {
    const { sealPvpRewardRecoverySnapshot } = await import('./_reward-recovery.js');
    for (const expired of [false, true]) {
        const session = await seed(`cancel-legacy-${expired}`);
        const terminal: PvpSession = { ...session, status: 'done', winner: 'draw', endedAt: Date.now(),
            log: [...session.log, `${session.p1.name} cancelled the unstarted duel.`] };
        await kv.set(`pvp:${session.battleId}`, terminal);
        await sealPvpRewardRecoverySnapshot(kv, session.battleId, terminal);
        if (expired) await kv.del(`pvp:${session.battleId}`);
        assert.equal((await call(getSession, session.p1.name, {}, {
            pending: '1', playerName: session.p1.name, recoveryProbeVersion: '2',
        })).status, 204);
        for (const fighter of [session.p1, session.p2]) {
            assert.equal(online.moveToTile(fighter.name, 11)?.tile, 11);
            assert.equal(await kv.get(`pvp:pending-session:${fighter.name}`), null);
        }
    }
});

test('cancellation replay cannot clear a newer duel or bypass outcome and participant checks', async () => {
    const session = await seed('cancel-newer');
    const result = await call(move, session.p1.name, { battleId: session.battleId, role: 'p1', action: 'cancel-unjoined' });
    assert.equal(result.status, 200);
    const newPointer = JSON.stringify({ version: 1, playerName: session.p1.name, battleId: 'new-duel',
        role: 'p1', createdAt: Date.now(), phase: 'active' });
    await kv.set(`pvp:pending-session:${session.p1.name}`, newPointer);
    online.setInBattle(session.p1.name, true);
    assert.equal((await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'cancel-unjoined' })).status, 200);
    assert.equal(await kv.get(`pvp:pending-session:${session.p1.name}`), newPointer);
    assert.equal(online.moveToTile(session.p1.name, 12), null, 'the newer fight still blocks movement');
    assert.equal((await call(claim, 'stranger', { battleId: session.battleId, outcome: 'draw', completionVersion: 1 })).status, 403);
    assert.equal((await call(claim, session.p1.name, { battleId: session.battleId, outcome: 'win', completionVersion: 1 })).status, 409);
    await kv.del(`pvp:pending-session:${session.p1.name}`);
    const newerProjection = { version: 1, kind: 'solo-pve', sessionId: 'new-solo-fight',
        startedAt: Date.now(), expiresAt: Date.now() + 60_000 };
    await kv.set(`battle-state:${session.p1.name}`, newerProjection);
    assert.equal((await call(claim, session.p1.name, {
        battleId: session.battleId, outcome: 'draw', completionVersion: 1,
    })).status, 200);
    assert.equal(online.moveToTile(session.p1.name, 12), null);
    assert.deepEqual(await kv.get(`battle-state:${session.p1.name}`), newerProjection);
});

test('joining another duel repairs a prior cancelled duel without demanding a draw settlement', async () => {
    const prior = await seed('cancel-before-join');
    await kv.set(`pvp:${prior.battleId}`, { ...prior, status: 'done', winner: 'draw', endedAt: Date.now(),
        log: [...prior.log, `${prior.p1.name} cancelled the unstarted duel.`] });
    const next: PvpSession = { ...prior, battleId: 'next-after-cancel',
        createdAt: Date.now(), p1: { ...prior.p1, name: 'newchallenger' }, p2: prior.p1 };
    await kv.set(`pvp:${next.battleId}`, next);
    const joined = await call(move, prior.p1.name, { battleId: next.battleId, role: 'p2', action: 'join' });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.joined.p2, true);
    assert.equal(JSON.parse(String(await kv.get(`pvp:pending-session:${prior.p1.name}`))).battleId, next.battleId);
    const { resolveBattleAuthority, battleAuthorityKeys, battleEvidenceFrom } = await import('../_realtime/battle-authority.js');
    const evidence = battleEvidenceFrom(await kv.mget(...battleAuthorityKeys(prior.p1.name)));
    assert.equal((await resolveBattleAuthority(prior.p1.name, evidence)).inBattle, true,
        'the next heartbeat must derive its movement lock from the new duel');
});

test('a cancellation cleanup failure remains repairable from the committed terminal row', async () => {
    const session = await seed('cancel-crash');
    const originalCompareSet = kv.compareSet.bind(kv);
    let fail = true;
    kv.compareSet = async (...args) => {
        if (fail && args[0] === `pvp:reward-recovery:${session.battleId}`) {
            fail = false;
            throw new Error('injected cancellation publication outage');
        }
        return originalCompareSet(...args);
    };
    try {
        await assert.rejects(call(move, session.p1.name, {
            battleId: session.battleId, role: 'p1', action: 'cancel-unjoined',
        }), /injected cancellation publication outage/);
    } finally { kv.compareSet = originalCompareSet; }
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))?.status, 'done');
    assert.equal((await call(getSession, session.p1.name, {}, { id: session.battleId })).status, 200);
    for (const fighter of [session.p1, session.p2]) assert.ok(online.moveToTile(fighter.name, 14));
});
