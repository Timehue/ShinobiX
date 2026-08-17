import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { KAGE_CHALLENGE_EXPIRY_MS } from './_kage-challenge.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let helpers: typeof import('./_kage-settle.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    helpers = await import('./_kage-settle.js');
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function terminalSession(battleId: string, now: number, winner: 'p1' | 'p2' | 'draw' = 'p1') {
    return {
        battleId,
        p1: { name: 'challenger', character: { name: 'challenger', village: 'Leaf' } },
        p2: { name: 'incumbent', character: { name: 'incumbent', village: 'Leaf' } },
        status: 'done' as const,
        winner,
        rewardAuthority: 'challenge' as const,
        joined: { p1: true, p2: true },
        baseRewards: false,
        log: [],
        createdAt: now - 1_000,
        endedAt: now,
    } as unknown as import('../pvp/session.js').PvpSession;
}

test('official Kage evidence and seat CAS recover lost acknowledgements exactly once', async () => {
    const now = Date.now();
    const battleId = 'pvp-kage-lost-ack-12345678';
    const challengeId = 'challenge-kage-lost-ack';
    const session = terminalSession(battleId, now);
    const stateKey = helpers.kageKey('Leaf');
    await kv.set(stateKey, {
        kageSystemUnlocked: true,
        seatedKage: 'incumbent',
        seatedAt: now - 100_000,
        defenseCount: 0,
        challenge: {
            challengeId,
            challenger: 'challenger',
            status: 'accepted',
            battleId,
            createdAt: now - 10_000,
            obligationRemainingMs: 1,
        },
    });
    await helpers.ensureKageDuelPointer('Leaf', battleId, challengeId);

    const originalCompareSet = kv.compareSet.bind(kv);
    let loseEvidenceAck = true;
    let loseSeatAck = true;
    (kv as any).compareSet = async (key: string, expected: unknown, next: unknown, options?: unknown) => {
        if (key === helpers.kageSettleKey(battleId) && loseEvidenceAck) {
            loseEvidenceAck = false;
            assert.equal(await originalCompareSet(key, expected, next, options as never), true);
            throw new Error('lost Kage evidence acknowledgement');
        }
        if (key === stateKey && loseSeatAck) {
            loseSeatAck = false;
            assert.equal(await originalCompareSet(key, expected, next, options as never), true);
            throw new Error('lost Kage seat acknowledgement');
        }
        return originalCompareSet(key, expected, next, options as never);
    };
    try {
        await helpers.recordPendingKageSettle('Leaf', session, challengeId);
        const first = await helpers.settleKageDuelFromSession('Leaf', session, now, {
            expectChallengeId: challengeId,
        });
        assert.equal(first.ok, true);
    } finally {
        (kv as any).compareSet = originalCompareSet;
    }

    const landed = await kv.get<Record<string, any>>(stateKey);
    assert.equal(landed?.seatedKage, 'challenger');
    assert.equal(landed?.pvpDuelSettlementReceipts?.[battleId]?.outcome, 'transferred');
    assert.equal(landed?.pvpDuelSettlementReceipts?.[battleId]?.settledAt, now);

    const replay = await helpers.settleKageDuelFromSession('Leaf', session, now + 1, {
        expectChallengeId: challengeId,
    });
    assert.equal(replay.ok, true);
    const replayed = await kv.get<Record<string, any>>(stateKey);
    assert.equal(replayed?.history?.filter((entry: any) => entry.name === 'challenger').length, 1);
});

test('malformed or conflicting official pointers fail closed', async () => {
    const battleId = 'pvp-kage-pointer-conflict-12345678';
    await kv.set(helpers.kageDuelKey(battleId), { village: 'Leaf' });
    await assert.rejects(
        helpers.ensureKageDuelPointer('Leaf', battleId, 'challenge-kage-pointer-conflict'),
        /pointer-conflict/,
    );
});

test('a pointer publication gap and post-expiry draw recovery close as an exact incumbent defense', async () => {
    const terminalAt = Date.now();
    const battleId = 'pvp-kage-draw-recovery-12345678';
    const challengeId = 'challenge-kage-draw-recovery';
    const session = terminalSession(battleId, terminalAt, 'draw');
    const stateKey = helpers.kageKey('Leaf');
    await kv.set(stateKey, {
        kageSystemUnlocked: true,
        seatedKage: 'incumbent',
        seatedAt: terminalAt - 100_000,
        defenseCount: 0,
        challenge: {
            challengeId,
            challenger: 'challenger',
            status: 'accepted',
            battleId,
            // The immutable terminal lands one second before the challenge
            // deadline; recovery intentionally runs after that wall-clock edge.
            createdAt: terminalAt - KAGE_CHALLENGE_EXPIRY_MS + 1_000,
            obligationRemainingMs: 1,
        },
    });

    assert.equal(await kv.get(helpers.kageDuelKey(battleId)), null,
        'models crash after accepted challenge CAS but before pointer publication');
    assert.deepEqual(
        await helpers.discoverAcceptedKageDuelPointer(session),
        { village: 'Leaf', challengeId },
    );
    await helpers.recordPendingKageSettle('Leaf', session, challengeId);
    const result = await helpers.settleKageDuelFromSession('Leaf', session, terminalAt + 2_000, {
        expectChallengeId: challengeId,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.result, 'defended');
    const landed = await kv.get<Record<string, any>>(stateKey);
    assert.equal(landed?.seatedKage, 'incumbent');
    assert.equal(landed?.challenge, undefined);
    assert.equal(landed?.pvpDuelSettlementReceipts?.[battleId]?.winnerName, 'draw');
    assert.equal(landed?.pvpDuelSettlementReceipts?.[battleId]?.settledAt, terminalAt);
});
