import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PvpSession } from './session.js';
import { isCancelledUnstartedPvpDuel, PVP_JOIN_WINDOW_MS, PVP_NO_SHOW_CLAIM_MS } from '../../shared/pvp-cancellation.js';
import { isWalkableTile } from '../../shared/sector-walk-mask.js';

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
    assert.ok(isWalkableTile(53, 65) && isWalkableTile(53, 66), 'movement probes must test the battle lock on accessible ground');
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
        assert.equal(online.moveToTile(name, 65), null);
    }
    return session;
}

test('cancellation releases both players and never writes their saves or runs browser settlement', async () => {
    for (const cancellingRole of ['p1', 'p2'] as const) {
        const session = await seed(`cancel-${cancellingRole}`);
        // Whichever fighter is seated is the one left waiting.
        await kv.set(`pvp:${session.battleId}`, { ...session, joined: { p1: cancellingRole === 'p1', p2: cancellingRole === 'p2' } });
        const saves = await Promise.all([session.p1, session.p2].map(f => kv.get(`save:${f.name}`)));
        const result = await call(move, session[cancellingRole].name, {
            battleId: session.battleId, role: cancellingRole, action: 'cancel-unjoined',
        });
        assert.equal(result.status, 200);
        assert.equal(isCancelledUnstartedPvpDuel(result.body), true);
        assert.equal(result.body.terminalReason, 'cancelled-unjoined');
        for (const [i, fighter] of [session.p1, session.p2].entries()) {
            assert.equal(online.moveToTile(fighter.name, 65)?.tile, 65, 'movement resumes before any claim');
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

/** Rewind a seeded duel so its creation is `ageMs` old. */
async function aged(session: PvpSession, ageMs: number, patch: Partial<PvpSession> = {}) {
    const createdAt = Date.now() - ageMs;
    const row: PvpSession = { ...session, createdAt, lastMoveAt: createdAt, ...patch };
    await kv.set(`pvp:${session.battleId}`, row);
    for (const role of ['p1', 'p2'] as const) {
        await kv.set(`pvp:pending-session:${session[role].name}`, JSON.stringify({
            version: 1, playerName: session[role].name, battleId: session.battleId, role, createdAt, phase: 'active',
        }));
    }
    return row;
}

test('the fighter being waited for cannot wave the attack off', async () => {
    const session = await seed('cancel-by-absent');
    const refused = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'cancel-unjoined' });
    assert.equal(refused.status, 409);
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))?.status, 'active');
    const joined = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'join' });
    assert.deepEqual(joined.body.joined, { p1: true, p2: true }, 'they can still take the fight');
});

test('a fighter who joined cannot use the join window to leave the fight', async () => {
    const session = await seed('joined-cannot-dodge');
    await aged(session, PVP_JOIN_WINDOW_MS * 2, { joined: { p1: true, p2: true }, turnStartedAt: Date.now() + 5_000 });
    const refused = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'cancel-unjoined' });
    assert.equal(refused.status, 409);
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))?.status, 'active');
});

test('a no-show who went quiet gets a sleeper camp, because they were never marked as in battle', async () => {
    const { sleeperCampForPresence } = await import('../_realtime/sleeper-camps.js');
    const { resolveBattleAuthority, battleAuthorityKeys, battleEvidenceFrom } = await import('../_realtime/battle-authority.js');
    const session = await seed('no-show-camp');
    await kv.del(`pvp:pending-session:${session.p2.name}`, `battle-state:${session.p2.name}`);
    const evidence = battleEvidenceFrom(await kv.mget(...battleAuthorityKeys(session.p2.name)));
    const authority = await resolveBattleAuthority(session.p2.name, evidence);
    assert.equal(authority.inBattle, false, 'an unjoined defender holds no pointer');
    const presence = online.get(session.p2.name)!;
    assert.equal(sleeperCampForPresence({ ...presence, inBattle: authority.inBattle }, Date.now())?.sector, 53);
});

test('the join window is the offline window, so a silent fighter is never called off early', async () => {
    const { OFFLINE_AFTER_MS } = await import('../_realtime/online-store.js');
    assert.equal(PVP_JOIN_WINDOW_MS, OFFLINE_AFTER_MS);
});

test('a fighter who never joins forfeits: the attacker is released, the no-show is hurt, and nobody is paid', async () => {
    const session = await seed('no-show');
    const inbox = `challenges:${session.p2.name}`;
    await kv.set(inbox, [{ id: 'no-show-notice', fromName: session.p1.name, toName: session.p2.name, sectorAttack: true, battleId: session.battleId }], { ex: 180 });
    await aged(session, PVP_JOIN_WINDOW_MS + 1, { rewardSector: 53 });

    // Nothing but the waiting fighter's own poll runs here.
    const read = await call(getSession, session.p1.name, {}, { id: session.battleId });
    assert.equal(read.status, 200);
    assert.equal(read.body.status, 'done');
    assert.equal(read.body.winner, 'p1');
    assert.equal(read.body.terminalReason, 'no-show');
    assert.equal(isCancelledUnstartedPvpDuel(read.body), false);
    assert.equal(read.body.log.at(-1), `${session.p2.name} did not join in time and forfeits the duel.`);
    assert.equal(await kv.get(inbox), null, 'the late fighter is not routed into a finished duel');

    const absent = (await kv.get<{ character: Record<string, unknown> }>(`save:${session.p2.name}`))!.character;
    assert.equal(absent.hp, 0);
    assert.equal(absent.hospitalized, true);
    assert.ok(Number(absent.pvpShieldUntil) > Date.now(), 'the same Field Recovery every defeat grants, so they cannot be hit again at once');

    const reward = await call(claim, session.p1.name, { battleId: session.battleId, outcome: 'win', completionVersion: 1 });
    assert.equal(reward.status, 200, JSON.stringify(reward.body));
    assert.equal(reward.body.rewardAuthorized, false);
    assert.equal(reward.body.progressionAuthorized, false);
    assert.equal(reward.body.base, undefined);
    assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${session.p1.name}`))!.character.ryo, 700, 'a forfeit pays the winner nothing');
    assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${session.p2.name}`))!.character.ryo, 700);

    // Replays are constant from here on; the notice must not repeat with them.
    await call(getSession, session.p1.name, {}, { id: session.battleId });
    await call(claim, session.p2.name, { battleId: session.battleId, outcome: 'loss', completionVersion: 1 });
    const notices = await kv.get<{ kind: string; by: string; sector: number }[]>(`offline-notices:${session.p2.name}`);
    assert.deepEqual(notices?.map(({ kind, by, sector }) => ({ kind, by, sector })),
        [{ kind: 'duel-no-show', by: session.p1.name, sector: 53 }]);
    assert.equal(online.get(session.p1.name)?.pendingAttacker, null);
});

test('a forfeit needs someone still there to win it, so a duel both fighters left is only called off', async () => {
    const session = await seed('both-left');
    const saves = await Promise.all([session.p1, session.p2].map(f => kv.get(`save:${f.name}`)));
    await aged(session, PVP_JOIN_WINDOW_MS + PVP_NO_SHOW_CLAIM_MS + 1);

    const read = await call(getSession, session.p2.name, {}, { id: session.battleId });
    assert.equal(read.status, 200);
    assert.equal(isCancelledUnstartedPvpDuel(read.body), true);
    assert.equal(read.body.terminalReason, 'cancelled-unjoined');
    assert.equal(read.body.log.at(-1), `${session.p2.name} did not join in time, so the duel was called off.`);
    for (const [i, fighter] of [session.p1, session.p2].entries()) {
        assert.equal(online.moveToTile(fighter.name, 65)?.tile, 65, 'movement resumes for both fighters');
        assert.equal(online.get(fighter.name)?.pendingAttacker, null);
        assert.equal(await kv.get(`pvp:pending-session:${fighter.name}`), null);
        assert.deepEqual(await kv.get(`save:${fighter.name}`), saves[i], 'no damage, reward, or version write');
        const reward = await call(claim, fighter.name, { battleId: session.battleId, outcome: 'draw', completionVersion: 1 });
        assert.equal(reward.status, 200);
        assert.equal(reward.body.rewardAuthorized, false);
    }
});

test('a fighter inside the join window keeps their seat', async () => {
    const session = await seed('join-in-time');
    await aged(session, PVP_JOIN_WINDOW_MS - 10_000);
    const read = await call(getSession, session.p1.name, {}, { id: session.battleId });
    assert.equal(read.body.status, 'active');
    const joined = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'join' });
    assert.equal(joined.status, 200);
    assert.deepEqual(joined.body.joined, { p1: true, p2: true });
    assert.equal(joined.body.status, 'active');
    const later = await call(getSession, session.p1.name, {}, { id: session.battleId });
    assert.equal(later.body.status, 'active');
});

test('a join that arrives after the window lands on the forfeit instead of starting the duel', async () => {
    const session = await seed('late-join');
    await aged(session, PVP_JOIN_WINDOW_MS + 1);
    const joined = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'join' });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.status, 'done');
    assert.equal(joined.body.joined.p2, false);
    assert.equal(joined.body.winner, 'p1');
    assert.equal(joined.body.terminalReason, 'no-show');
    const retry = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'join' });
    assert.equal(retry.body.log.filter((line: string) => line.includes('forfeits')).length, 1);
    assert.equal((await kv.get<unknown[]>(`offline-notices:${session.p2.name}`))?.length, 1);
    const reward = await call(claim, session.p2.name, { battleId: session.battleId, outcome: 'loss', completionVersion: 1 });
    assert.equal(reward.status, 200, JSON.stringify(reward.body));
    assert.equal(reward.body.rewardAuthorized, false);
});

test('a fighter returning long after both left walks in on a call-off, not a hospital bed', async () => {
    const session = await seed('late-return');
    await aged(session, PVP_JOIN_WINDOW_MS + PVP_NO_SHOW_CLAIM_MS + 1);
    const joined = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'join' });
    assert.equal(isCancelledUnstartedPvpDuel(joined.body), true);
    assert.equal((await kv.get<{ character: { hp: number } }>(`save:${session.p2.name}`))!.character.hp, 95);
    assert.equal(await kv.get(`offline-notices:${session.p2.name}`), null);
});

test('reloading onto a forfeit shows the waiting fighter their result', async () => {
    const session = await seed('reload-after-window');
    await aged(session, PVP_JOIN_WINDOW_MS + 1);
    const probe = await call(getSession, session.p1.name, {}, {
        pending: '1', playerName: session.p1.name, recoveryProbeVersion: '2',
    });
    assert.equal(probe.status, 200, JSON.stringify(probe.body));
    assert.equal(probe.body.outcome, 'win');
    assert.equal(probe.body.session.terminalReason, 'no-show');
});

test('reloading onto a duel nobody was left to win goes straight back to the world', async () => {
    const session = await seed('reload-after-both-left');
    await aged(session, PVP_JOIN_WINDOW_MS + PVP_NO_SHOW_CLAIM_MS + 1);
    const probe = await call(getSession, session.p1.name, {}, {
        pending: '1', playerName: session.p1.name, recoveryProbeVersion: '2',
    });
    assert.equal(probe.status, 204);
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))?.status, 'done');
    assert.equal(await kv.get(`pvp:pending-session:${session.p1.name}`), null);
});

test('the join window leaves every duel alone that is not an unstarted casual one', async () => {
    const seated = await seed('window-seated');
    await aged(seated, PVP_JOIN_WINDOW_MS * 2, { joined: { p1: true, p2: true }, turnStartedAt: Date.now() + 5_000 });
    const clanWar = await seed('window-clan-war');
    await aged(clanWar, PVP_JOIN_WINDOW_MS * 2, { clanWarId: 'war', rewardAuthority: 'clan-war' });
    for (const session of [seated, clanWar]) {
        const read = await call(getSession, session.p1.name, {}, { id: session.battleId });
        assert.equal(read.status, 200);
        assert.equal(read.body.status, 'active', session.battleId);
    }
});

test('the live stream wakes at the join deadline rather than on its next safety poll', async () => {
    const { pvpTurnNextCheckAt, pvpTurnDeadlineNeedsWork } = await import('./_turn-deadline.js');
    const session = await seed('stream-deadline');
    const deadline = session.createdAt + PVP_JOIN_WINDOW_MS;
    assert.equal(pvpTurnNextCheckAt(session, session.createdAt), deadline);
    assert.equal(pvpTurnDeadlineNeedsWork(session, deadline - 1), false);
    assert.equal(pvpTurnDeadlineNeedsWork(session, deadline), true);
});

test('cancelling drops the defender\'s sector-attack notice so the heartbeat cannot route them back in', async () => {
    const session = await seed('cancel-notice');
    const notice = (id: string, battleId: string) => ({ id, fromName: session.p1.name, toName: session.p2.name, sectorAttack: true, battleId });
    const unrelated = notice('other-notice', 'some-other-duel');
    const inbox = `challenges:${session.p2.name}`;
    await kv.set(inbox, [notice('sector-notice', session.battleId), unrelated], { ex: 180 });
    assert.equal((await call(move, session.p1.name, { battleId: session.battleId, role: 'p1', action: 'cancel-unjoined' })).status, 200);
    assert.deepEqual(await kv.get(inbox), [unrelated], 'only the cancelled duel\'s notice is removed');
});

test('a cancelled duel\'s only notice leaves the inbox empty', async () => {
    const session = await seed('cancel-lone-notice');
    const inbox = `challenges:${session.p2.name}`;
    await kv.set(inbox, [{ id: 'lone-notice', fromName: session.p1.name, toName: session.p2.name, sectorAttack: true, battleId: session.battleId }], { ex: 180 });
    assert.equal((await call(move, session.p1.name, { battleId: session.battleId, role: 'p1', action: 'cancel-unjoined' })).status, 200);
    assert.equal(await kv.get(inbox), null);
});

test('a duel that ends any other way (a flee) also drops the defender\'s notice on the next terminal read', async () => {
    const session = await seed('flee-notice');
    const inbox = `challenges:${session.p2.name}`;
    const notice = { id: 'flee-notice-id', fromName: session.p1.name, toName: session.p2.name, sectorAttack: true, battleId: session.battleId };
    await kv.set(inbox, [notice], { ex: 180 });
    await kv.set(`pvp:${session.battleId}`, { ...session, joined: { p1: true, p2: true }, status: 'done', winner: 'p2',
        fleedBy: 'p1', endedAt: Date.now(), log: [...session.log, `${session.p1.name} fled the battle, losing 10 HP.`] });
    const result = await call(move, session.p2.name, { battleId: session.battleId, role: 'p2', action: 'wait' });
    assert.equal(result.status, 200);
    assert.equal(await kv.get(inbox), null, 'a finished duel leaves no notice to route the defender back into it');
});

test('a notice posted after its duel already ended is not queued', async () => {
    const challenge = (await import('../player/challenge.js')).default as unknown as Handler;
    const session = await seed('late-notice');
    await kv.set(`pvp:${session.battleId}`, { ...session, status: 'done', winner: 'draw', terminalReason: 'cancelled-unjoined',
        endedAt: Date.now(), log: [...session.log, `${session.p1.name} cancelled the unstarted duel.`] });
    const posted = await call(challenge, session.p1.name, {
        targetName: session.p2.name,
        challenge: { id: 'late-notice-id', fromName: session.p1.name, toName: session.p2.name, mode: 'standard',
            sectorAttack: true, battleId: session.battleId },
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.skipped, 'battle-ended');
    assert.equal(await kv.get(`challenges:${session.p2.name}`), null);
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
            assert.equal(online.moveToTile(fighter.name, 65)?.tile, 65);
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
    assert.equal(online.moveToTile(session.p1.name, 65), null, 'the newer fight still blocks movement');
    assert.equal((await call(claim, 'stranger', { battleId: session.battleId, outcome: 'draw', completionVersion: 1 })).status, 403);
    assert.equal((await call(claim, session.p1.name, { battleId: session.battleId, outcome: 'win', completionVersion: 1 })).status, 409);
    await kv.del(`pvp:pending-session:${session.p1.name}`);
    const newerProjection = { version: 1, kind: 'solo-pve', sessionId: 'new-solo-fight',
        startedAt: Date.now(), expiresAt: Date.now() + 60_000 };
    await kv.set(`battle-state:${session.p1.name}`, newerProjection);
    assert.equal((await call(claim, session.p1.name, {
        battleId: session.battleId, outcome: 'draw', completionVersion: 1,
    })).status, 200);
    assert.equal(online.moveToTile(session.p1.name, 65), null);
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
    for (const fighter of [session.p1, session.p2]) assert.ok(online.moveToTile(fighter.name, 66));
});
