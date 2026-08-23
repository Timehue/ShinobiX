import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-reward-completion-handler-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

function response() {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(
    playerName: string,
    battleId: string,
    outcome: 'win' | 'loss' | 'draw',
    completionAck = false,
) {
    return {
        method: 'POST',
        body: { playerName, battleId, outcome, completionVersion: 1, completionAck },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(playerName),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./claim-rewards.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_COMBAT_RECEIPTS;
});

test('completion ACK cannot pass the server-credit barrier and remains repairable after session expiry', async () => {
    const now = Date.now();
    const winner = 'ackbarrierwinner';
    const loser = 'ackbarrierloser';
    const stranger = 'ackbarrierstranger';
    const battleId = 'pvp-ack-barrier-12345678';
    for (const name of [winner, loser, stranger]) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                village: 'Leaf',
                level: 20,
                ryo: 100,
                stats: {},
                inventory: [],
                itemStacks: [],
                serverSettlementReceipts: [],
            },
        });
    }
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: winner, character: { name: winner, village: 'Leaf' } },
        p2: { name: loser, character: { name: loser, village: 'Leaf' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        baseRewards: true,
        realFighters: { p1: true, p2: true },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 1_000,
        endedAt: now,
    }, { ex: 24 * 60 * 60 });

    const claimKey = `pvp:rewarded:${winner}:${battleId}`;
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    let releaseReserve!: () => void;
    let observeReserve!: () => void;
    const reserveObserved = new Promise<void>(resolve => { observeReserve = resolve; });
    const reserveReleased = new Promise<void>(resolve => { releaseReserve = resolve; });
    (kv as any).set = async (key: string, value: unknown, options?: unknown) => {
        const result = await originalSet(key, value, options as never);
        if (key === claimKey && (options as { nx?: boolean } | undefined)?.nx) {
            observeReserve();
            await reserveReleased;
        }
        return result;
    };
    let failWinnerCredit = true;
    (kv as any).compareSet = async (key: string, expected: unknown, next: unknown, options?: unknown) => {
        if (key === `save:${winner}` && failWinnerCredit) {
            failWinnerCredit = false;
            throw new Error('forced winner credit failure after claim reserve');
        }
        return originalCompareSet(key, expected, next, options as never);
    };

    try {
        const first = response();
        const claim = handler(request(winner, battleId, 'win'), first.res);
        await reserveObserved;

        // The immutable recovery snapshot was sealed before the receipt. Remove
        // the live combat row while credits are still pending to model its TTL
        // expiring during a failed claim attempt.
        await kv.del(`pvp:${battleId}`);

        const racingAck = response();
        await handler(request(winner, battleId, 'win', true), racingAck.res);
        assert.equal(racingAck.out.statusCode, 409);
        assert.match(String(racingAck.out.body?.error), /credits are still pending/i);

        releaseReserve();
        await claim;
        assert.equal(first.out.statusCode, 503);
    } finally {
        (kv as any).set = originalSet;
        (kv as any).compareSet = originalCompareSet;
        releaseReserve?.();
    }

    // A normal claim retry reconstructs the terminal session from the sealed
    // recovery row, help-forwards the missing credit exactly once, and returns
    // the callback response even though the live battle row is gone.
    const repairedClaim = response();
    await handler(request(winner, battleId, 'win'), repairedClaim.res);
    assert.equal(repairedClaim.out.statusCode, 200);
    assert.equal(repairedClaim.out.body?.completionPending, true);
    assert.deepEqual(
        (await kv.get<Record<string, any>>(`save:${winner}`))?.character.itemStacks,
        [],
        'ordinary PvP wins must not drop Territory Control Scrolls',
    );

    // The exact claim receipt, not the short-lived combat row, authorizes ACK.
    const repairedAck = response();
    await handler(request(winner, battleId, 'win', true), repairedAck.res);
    assert.equal(repairedAck.out.statusCode, 200);
    assert.equal(repairedAck.out.body?.completionPending, false);

    const wrongOutcome = response();
    await handler(request(winner, battleId, 'loss', true), wrongOutcome.res);
    assert.equal(wrongOutcome.out.statusCode, 409);

    const wrongActor = response();
    await handler(request(stranger, battleId, 'win', true), wrongActor.res);
    assert.equal(wrongActor.out.statusCode, 409);
});

test('a versioned terminal recovery remains first-claimable after the legacy two-hour window', async () => {
    const now = Date.now();
    const winner = 'latefirstclaimwinner';
    const loser = 'latefirstclaimloser';
    const battleId = 'pvp-late-first-claim-12345678';
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: winner, character: { name: winner, village: 'Leaf' } },
        p2: { name: loser, character: { name: loser, village: 'Leaf' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        pvpCompletionAuthorityVersion: 1,
        pvpConsumableAuthorityVersion: 1,
        vanguardRewardAuthorityVersion: 2,
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - (3 * 60 * 60 * 1_000),
        endedAt: now - (3 * 60 * 60 * 1_000) + 1_000,
    }, { ex: 48 * 60 * 60 });

    const downgradeRequest = request(winner, battleId, 'win') as any;
    downgradeRequest.body = { playerName: winner, battleId, outcome: 'win' };
    const downgrade = response();
    await handler(downgradeRequest as never, downgrade.res);
    assert.equal(downgrade.out.statusCode, 409);
    assert.match(String(downgrade.out.body?.error), /durable reward-completion protocol/i);

    const firstClaim = response();
    await handler(request(winner, battleId, 'win'), firstClaim.res);
    assert.equal(firstClaim.out.statusCode, 200);
    assert.equal(firstClaim.out.body?.completionPending, true);
    const receipt = await kv.get<Record<string, unknown>>(`pvp:rewarded:${winner}:${battleId}`);
    assert.equal(
        receipt?.expiresAt,
        Number((await kv.get<Record<string, unknown>>(`pvp:reward-recovery:${battleId}`))?.expiresAt),
        'claim and recovery proof must share one immutable terminal deadline',
    );
});

test('a legacy caller cannot create an invalid completed/server-pending receipt', async () => {
    const now = Date.now();
    const winner = 'legacycreditwinner';
    const loser = 'legacycreditloser';
    const battleId = 'pvp-legacy-credit-12345678';
    for (const name of [winner, loser]) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                village: 'Leaf',
                level: 20,
                ryo: 100,
                stats: {},
                inventory: [],
                itemStacks: [],
                serverSettlementReceipts: [],
            },
        });
    }
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: winner, character: { name: winner, village: 'Leaf' } },
        p2: { name: loser, character: { name: loser, village: 'Leaf' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        baseRewards: true,
        realFighters: { p1: true, p2: true },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 1_000,
        endedAt: now,
    }, { ex: 48 * 60 * 60 });

    const claimKey = `pvp:rewarded:${winner}:${battleId}`;
    const originalCompareSet = kv.compareSet.bind(kv);
    let loseMarkAck = true;
    (kv as any).compareSet = async (key: string, expected: unknown, next: unknown, options?: unknown) => {
        const committed = await originalCompareSet(key, expected, next, options as never);
        if (key === claimKey
            && committed
            && loseMarkAck
            && (next as { serverCreditsState?: string })?.serverCreditsState === 'completed') {
            loseMarkAck = false;
            throw new Error('lost legacy server-credit mark acknowledgement');
        }
        return committed;
    };
    try {
        const legacyRequest = request(winner, battleId, 'win') as any;
        delete legacyRequest.body.completionVersion;
        const first = response();
        await handler(legacyRequest as never, first.res);
        assert.equal(first.out.statusCode, 200);
        assert.equal(first.out.body?.completionPending, false);

        const replay = response();
        await handler(legacyRequest as never, replay.res);
        assert.equal(replay.out.statusCode, 200);
        assert.equal(replay.out.body?.alreadyClaimed, true);
        const receipt = await kv.get<Record<string, unknown>>(claimKey);
        assert.equal(receipt?.completionState, 'completed');
        assert.equal(receipt?.serverCreditsState, 'completed');
    } finally {
        (kv as any).compareSet = originalCompareSet;
    }
});

test('an official Kage duel cannot complete until its exact seat settlement is durable', async () => {
    const now = Date.now();
    const winner = 'kageclaimchallenger';
    const loser = 'kageclaimincumbent';
    const battleId = 'pvp-kage-completion-12345678';
    const challengeId = 'kage-challenge-completion-1';
    const village = 'Leaf';
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: winner, character: { name: winner, village } },
        p2: { name: loser, character: { name: loser, village } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        pvpCompletionAuthorityVersion: 1,
        pvpConsumableAuthorityVersion: 1,
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 1_000,
        endedAt: now,
    }, { ex: 48 * 60 * 60 });
    await kv.set('village:kage:leaf', {
        kageSystemUnlocked: true,
        seatedKage: loser,
        seatedAt: now - 100_000,
        defenseCount: 0,
        challenge: {
            challengeId,
            challenger: winner,
            status: 'accepted',
            battleId,
            createdAt: now - 10_000,
            obligationRemainingMs: 1,
        },
    });
    await kv.set(`kage-duel:${battleId}`, { village, challengeId }, { ex: 48 * 60 * 60 });

    const originalCompareSet = kv.compareSet.bind(kv);
    let failEvidence = true;
    (kv as any).compareSet = async (key: string, expected: unknown, next: unknown, options?: unknown) => {
        if (key === `kage-settle:${battleId}` && failEvidence) {
            failEvidence = false;
            throw new Error('forced Kage terminal-evidence failure');
        }
        return originalCompareSet(key, expected, next, options as never);
    };
    try {
        const first = response();
        await handler(request(winner, battleId, 'win'), first.res);
        assert.equal(first.out.statusCode, 503);

        const prematureAck = response();
        await handler(request(winner, battleId, 'win', true), prematureAck.res);
        assert.equal(prematureAck.out.statusCode, 409);
        assert.equal(await kv.get(`pvp:rewarded:${winner}:${battleId}`), null,
            'claim receipt must not advance past an unconfirmed official Kage effect');
    } finally {
        (kv as any).compareSet = originalCompareSet;
    }

    const repaired = response();
    await handler(request(winner, battleId, 'win'), repaired.res);
    assert.equal(repaired.out.statusCode, 200);
    assert.equal(repaired.out.body?.completionPending, true);

    const settled = await kv.get<Record<string, any>>('village:kage:leaf');
    assert.equal(settled?.seatedKage, winner);
    assert.equal(settled?.pvpDuelSettlementReceipts?.[battleId]?.outcome, 'transferred');
    assert.equal(settled?.pvpDuelSettlementReceipts?.[battleId]?.settledAt, now);

    const replay = response();
    await handler(request(winner, battleId, 'win'), replay.res);
    assert.equal(replay.out.statusCode, 200);
    const replayedState = await kv.get<Record<string, any>>('village:kage:leaf');
    assert.equal(replayedState?.history?.filter((entry: any) => entry.name === winner).length, 1,
        'exact receipt replay must not open a second reign');

    const ack = response();
    await handler(request(winner, battleId, 'win', true), ack.res);
    assert.equal(ack.out.statusCode, 200);
});

test('an official draw closes the accepted Kage challenge as a durable defense before ACK', async () => {
    const now = Date.now();
    const challenger = 'kagedrawchallenger';
    const incumbent = 'kagedrawincumbent';
    const battleId = 'pvp-kage-draw-completion-12345678';
    const challengeId = 'kage-challenge-draw-completion';
    const village = 'Leaf';
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: challenger, character: { name: challenger, village } },
        p2: { name: incumbent, character: { name: incumbent, village } },
        status: 'done',
        winner: 'draw',
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        pvpCompletionAuthorityVersion: 1,
        pvpConsumableAuthorityVersion: 1,
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 1_000,
        endedAt: now,
    }, { ex: 48 * 60 * 60 });
    await kv.set('village:kage:leaf', {
        kageSystemUnlocked: true,
        seatedKage: incumbent,
        seatedAt: now - 100_000,
        defenseCount: 0,
        challenge: {
            challengeId,
            challenger,
            status: 'accepted',
            battleId,
            createdAt: now - 10_000,
            obligationRemainingMs: 1,
        },
    });
    // Deliberately omit kage-duel:<battle>: terminal replay must repair the
    // accepted-row -> pointer crash gap before it may advance server credits.
    const claim = response();
    await handler(request(challenger, battleId, 'draw'), claim.res);
    assert.equal(claim.out.statusCode, 200);
    assert.equal(claim.out.body?.completionPending, true);

    const state = await kv.get<Record<string, any>>('village:kage:leaf');
    assert.equal(state?.seatedKage, incumbent);
    // `challenge: null` is the Kage system's canonical cleared value — see
    // _kage-challenge.ts and the ServerKageState type.
    assert.equal(state?.challenge, null);
    assert.equal(state?.pvpDuelSettlementReceipts?.[battleId]?.outcome, 'defended');
    assert.equal(state?.pvpDuelSettlementReceipts?.[battleId]?.winnerName, 'draw');
    assert.deepEqual(await kv.get(`kage-duel:${battleId}`), { village, challengeId });

    const ack = response();
    await handler(request(challenger, battleId, 'draw', true), ack.res);
    assert.equal(ack.out.statusCode, 200);
});

test('a transient Vanguard saga failure keeps completion pending and retry credits exactly once', async () => {
    const now = Date.now();
    const winner = 'strictvanguardwinner';
    const loser = 'strictvanguardloser';
    const battleId = 'pvp-strict-vanguard-retry-12345678';
    await kv.set(`save:${winner}`, {
        _saveVersion: 1,
        character: {
            name: winner,
            village: 'Leaf',
            level: 30,
            createdAt: now - (10 * 24 * 60 * 60 * 1_000),
            profession: 'vanguard',
            professionRank: 1,
            professionXp: 0,
            honorSeals: 0,
            ryo: 100,
            stats: {},
            inventory: [],
            itemStacks: [],
            serverSettlementReceipts: [],
        },
    });
    await kv.set(`save:${loser}`, {
        _saveVersion: 1,
        character: {
            name: loser,
            village: 'Leaf',
            level: 30,
            createdAt: now - (10 * 24 * 60 * 60 * 1_000),
            ryo: 100,
            stats: {},
            inventory: [],
            itemStacks: [],
            serverSettlementReceipts: [],
        },
    });
    await kv.set(`pvp:${battleId}`, {
        battleId,
        // The Vanguard grant reads profession from the SEALED fighter snapshot,
        // not the live save, so a player cannot switch profession after the
        // fight and claim seals. `profession` is a public-char field and is not
        // combat-stripped, so a real session carries it. Omitting it here made
        // the grant return not-vanguard before the retry under test could ever
        // credit anything.
        p1: {
            name: winner,
            character: { name: winner, village: 'Leaf', level: 30, profession: 'vanguard' },
        },
        p2: { name: loser, character: { name: loser, village: 'Leaf', level: 30 } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        baseRewards: true,
        realFighters: { p1: true, p2: true },
        pvpCompletionAuthorityVersion: 1,
        pvpConsumableAuthorityVersion: 1,
        vanguardRewardAuthorityVersion: 2,
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 20_000,
        // The anti-farm duration check measures lastMoveAt (not endedAt) against
        // createdAt, and move.ts stamps lastMoveAt on every move, so a real
        // terminal session always carries one. Without it the fight measured as
        // zero seconds and the grant returned too-quick.
        lastMoveAt: now,
        endedAt: now,
    }, { ex: 48 * 60 * 60 });

    const originalCompareSet = kv.compareSet.bind(kv);
    let failVanguard = true;
    (kv as any).compareSet = async (key: string, expected: unknown, next: unknown, options?: unknown) => {
        if (key === `pvp:vanguard-rewarded:${battleId}` && failVanguard) {
            failVanguard = false;
            throw new Error('forced Vanguard receipt outage');
        }
        return originalCompareSet(key, expected, next, options as never);
    };
    try {
        const first = response();
        await handler(request(winner, battleId, 'win'), first.res);
        assert.equal(first.out.statusCode, 503);
        assert.equal(await kv.get(`pvp:rewarded:${winner}:${battleId}`), null,
            'server credits must not be marked ready around a failed Vanguard saga');
        assert.notEqual(await kv.get(`pvp:pending-session:${winner}`), null,
            'the storage-independent recovery pointer must remain discoverable');

        const earlyAck = response();
        await handler(request(winner, battleId, 'win', true), earlyAck.res);
        assert.equal(earlyAck.out.statusCode, 409);

        const repaired = response();
        await handler(request(winner, battleId, 'win'), repaired.res);
        assert.equal(repaired.out.statusCode, 200);
        const afterRepair = await kv.get<Record<string, any>>(`save:${winner}`);
        assert.equal(afterRepair?.character?.honorSeals, 1);

        const replay = response();
        await handler(request(winner, battleId, 'win'), replay.res);
        assert.equal(replay.out.statusCode, 200);
        const afterReplay = await kv.get<Record<string, any>>(`save:${winner}`);
        assert.equal(afterReplay?.character?.honorSeals, 1, 'durable retry must not pay Vanguard twice');
    } finally {
        (kv as any).compareSet = originalCompareSet;
    }
});
