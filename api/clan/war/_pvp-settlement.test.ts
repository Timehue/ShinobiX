import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PvpSession } from '../../pvp/session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../../_storage.js').kv;
let settle: typeof import('./_pvp-settlement.js').settlePvpClanWarContinuation;

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ settlePvpClanWarContinuation: settle } = await import('./_pvp-settlement.js'));
});

function terminal(battleId: string, overrides: Partial<PvpSession> = {}): PvpSession {
    const endedAt = Date.now() - 500;
    return {
        battleId,
        p1: { name: 'clanpvpfrom', character: { name: 'clanpvpfrom', clan: 'From' } },
        p2: { name: 'clanpvpto', character: { name: 'clanpvpto', clan: 'To' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'clan-war',
        clanWarId: 'from-vs-to',
        clanWarChallengeId: `challenge-${battleId}`,
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        round: 2,
        activePlayer: 'p1',
        ap: { p1: 0, p2: 0 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        createdAt: endedAt - 1_000,
        endedAt,
        ...overrides,
    } as unknown as PvpSession;
}

async function seed(session: PvpSession): Promise<void> {
    for (const [name, clan] of [['clanpvpfrom', 'From'], ['clanpvpto', 'To']] as const) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                clan,
                clanPoints: 0,
                weeklyClanPoints: 0,
                lifetimeClanPoints: 0,
                clanPointHistory: [],
                serverSettlementReceipts: [],
            },
        });
    }
    const challenge = {
        id: session.clanWarChallengeId,
        mode: 'pvp1v1',
        fromClan: 'From',
        fromPlayer: 'clanpvpfrom',
        acceptedPlayer: 'clanpvpto',
        createdAt: Number(session.createdAt) - 2_000,
        acceptedAt: Number(session.createdAt) - 1_000,
        expiresAt: Number(session.endedAt) + 60_000,
        status: 'accepted',
        battleId: session.battleId,
    };
    await kv.set(`clan-war:${session.clanWarId}`, {
        id: session.clanWarId,
        clans: ['From', 'To'],
        villages: { From: 'Leaf', To: 'Mist' },
        hp: { From: 100, To: 100 },
        startedAt: Number(session.createdAt) - 5_000,
        updatedAt: Number(session.createdAt) - 5_000,
        declaredBy: 'clanpvpfrom',
        pendingChallenges: [challenge],
        completedChallenges: [],
    });
}

test('either claimant can finalize the sealed Clan War result and crash replay cannot duplicate points', async () => {
    const session = terminal('pvp-clan-server-owned-0001');
    await seed(session);
    const first = await settle(session);
    assert.equal(first?.outcome, 'applied');
    const war = await kv.get<Record<string, any>>(`clan-war:${session.clanWarId}`);
    assert.equal(war?.hp?.To, 70);
    assert.equal(war?.pendingChallenges.length, 0);
    assert.equal(war?.completedChallenges[0]?.battleId, session.battleId);
    const winner = await kv.get<Record<string, any>>('save:clanpvpfrom');
    const loser = await kv.get<Record<string, any>>('save:clanpvpto');
    assert.equal(winner?.character.clanPoints, 50);
    assert.equal(loser?.character.clanPoints, 25);

    // Model process death after the war/save CAS writes but before the external
    // continuation receipt. The embedded completed challenge and per-save PvP
    // journals reconstruct completion without applying either effect twice.
    await kv.del(`pvp:clan-war-continuation:${session.battleId}`);
    const recovered = await settle(session);
    assert.equal(recovered?.outcome, 'applied');
    assert.equal((await kv.get<Record<string, any>>('save:clanpvpfrom'))?.character.clanPoints, 50);
    assert.equal((await kv.get<Record<string, any>>('save:clanpvpto'))?.character.clanPoints, 25);
    const replay = await settle(session);
    assert.equal(replay?.replayed, true);
});

test('participant drift or a conflicting completed result fails closed', async () => {
    const session = terminal('pvp-clan-server-owned-0002', {
        p2: { name: 'outsider', character: { name: 'outsider', clan: 'Else' } } as never,
    });
    await seed(session);
    await assert.rejects(() => settle(session), /participants-conflict/);
    const war = await kv.get<Record<string, any>>(`clan-war:${session.clanWarId}`);
    assert.equal(war?.hp?.To, 100);
});

test('a battle overtaken by another ending blow records a canonical superseded continuation', async () => {
    const session = terminal('pvp-clan-server-owned-0003');
    await seed(session);
    const key = `clan-war:${session.clanWarId}`;
    const row = await kv.get<Record<string, any>>(key);
    const swept = { ...row!.pendingChallenges[0], status: 'cancelled' };
    await kv.set(key, {
        ...row,
        endedAt: Number(session.endedAt) - 1,
        winnerClan: 'From',
        pendingChallenges: [],
        completedChallenges: [swept],
    });
    const result = await settle(session);
    assert.equal(result?.outcome, 'superseded');
    assert.equal((await kv.get<Record<string, any>>(key))?.hp?.To, 100);
    assert.equal((await settle(session))?.replayed, true);
});

test('a legacy or admin report completed before claim is backfilled without duplicate side effects', async () => {
    const session = terminal('pvp-clan-server-owned-0004');
    await seed(session);
    const key = `clan-war:${session.clanWarId}`;
    const row = await kv.get<Record<string, any>>(key);
    const legacyCompleted = {
        ...row!.pendingChallenges[0],
        status: 'completed',
        result: 'from-wins',
        completedAt: Number(session.endedAt),
    };
    await kv.set(key, {
        ...row,
        hp: { ...row!.hp, To: 70 },
        pendingChallenges: [],
        completedChallenges: [legacyCompleted],
    });

    const result = await settle(session);
    assert.equal(result?.outcome, 'superseded');
    assert.equal((await kv.get<Record<string, any>>('save:clanpvpfrom'))?.character.clanPoints, 0);
    assert.equal((await kv.get<Record<string, any>>('save:clanpvpto'))?.character.clanPoints, 0);
    assert.equal((await kv.get<Record<string, any>>(key))?.hp?.To, 70);
    assert.equal((await settle(session))?.replayed, true);
});
