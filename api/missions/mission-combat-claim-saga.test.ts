import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    COMBAT_MISSION_CLAIM_TOKEN_TTL_MS,
    appendCombatMissionClaimSettlement,
    parseCombatMissionClaimPaymentReservation,
    parseCombatMissionClaimToken,
    retireCombatMissionClaimToken,
    type CombatMissionClaimToken,
    type CombatMissionClaimSettlement,
} from './_combat-claim-authority.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'mission-combat-claim-saga-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
type FaultMode = 'commit-then-throw' | 'throw-before-commit' | 'null-before-commit';

const MISSION_ID = 'combat-c-patrol';
let queueHandler: Handler;
let claimHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let createActivePointer: typeof import('./_authoritative-combat-session.js').createMissionCombatActivePointer;
let createBinding: typeof import('./_authoritative-combat-session.js').createMissionCombatBinding;
let activeKey: typeof import('./_authoritative-combat-session.js').missionCombatActiveKey;
let bindingKey: typeof import('./_authoritative-combat-session.js').missionCombatBindingKey;
let rewardFingerprint: typeof import('./_authoritative-combat-session.js').missionCombatRewardFingerprint;
let missionByKey: typeof import('./_mission-catalog.js').combatMissionByKey;
let createSession: typeof import('../solo-pve/_session.js').createSoloPveSession;
let writeSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let readSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let tokenKey: typeof import('./_combat-claim-authority.js').combatMissionClaimTokenKey;
let loadOrIssueNewbieDailies: typeof import('./_progress.js').loadOrIssueNewbieDailies;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({
        createMissionCombatActivePointer: createActivePointer,
        createMissionCombatBinding: createBinding,
        missionCombatActiveKey: activeKey,
        missionCombatBindingKey: bindingKey,
        missionCombatRewardFingerprint: rewardFingerprint,
    } = await import('./_authoritative-combat-session.js'));
    ({ combatMissionByKey: missionByKey } = await import('./_mission-catalog.js'));
    ({ createSoloPveSession: createSession } = await import('../solo-pve/_session.js'));
    ({ writeSoloPveSession: writeSession, readSoloPveSession: readSession } = await import('../solo-pve/_store.js'));
    ({ combatMissionClaimTokenKey: tokenKey } = await import('./_combat-claim-authority.js'));
    ({ loadOrIssueNewbieDailies } = await import('./_progress.js'));
    queueHandler = (await import('./queue-combat-claim.js')).default as unknown as Handler;
    claimHandler = (await import('./claim-mission.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:missionsaga*',
        'legacy:stats:missionsaga*',
        'missions:newbie-daily:missionsaga*',
        'solo-pve:missionsaga*',
        'mission-combat-active:missionsaga*',
        'mission-combat-binding:missionsaga*',
        'missions:combat-claim:missionsaga*',
        'pve-outcome:missionsaga*',
        'lock:*missionsaga*',
    ]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(playerName: string, body: Record<string, unknown>) {
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName)!,
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out = response();
    await handler(request(playerName, body), out.res);
    return out.out;
}

async function queue(playerName: string, runId: string): Promise<Out> {
    return post(queueHandler, playerName, { missionId: MISSION_ID, runId });
}

async function claim(playerName: string): Promise<Out> {
    return post(claimHandler, playerName, { missionType: 'combat', missionId: MISSION_ID });
}

function fighter(name: string, hp: number, pos: number) {
    return {
        name,
        hp,
        maxHp: 500,
        chakra: 100,
        maxChakra: 100,
        stamina: 100,
        maxStamina: 100,
        shield: 0,
        statuses: [],
        pos,
        character: {
            name,
            level: 20,
            specialty: 'Taijutsu',
            stats: { ninjutsu: 10, taijutsu: 10, genjutsu: 10, speed: 10, chakra: 10, strength: 10 },
            jutsu: [],
            pvpItems: [],
            equipment: {},
        },
    };
}

async function seedPlayer(playerName: string, ryo = 100, profession: string | null = 'Medic'): Promise<void> {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        character: {
            name: playerName,
            level: 20,
            rankTitle: 'Chunin',
            ...(profession ? { profession } : {}),
            hp: 500,
            maxHp: 500,
            stamina: 100,
            maxStamina: 100,
            ryo,
            inventory: [],
            unspentStats: 0,
        },
    });
}

async function seedWonRun(playerName: string, suffix: string): Promise<string> {
    const mission = missionByKey(MISSION_ID)!;
    const runId = `missionsaga${suffix}`;
    const now = Date.now();
    const base = createSession({
        sessionId: runId,
        ownerSlug: playerName,
        encounter: {
            kind: 'mission',
            id: mission.key,
            sourceId: mission.aiProfileId,
            bindingId: runId,
        },
        player: fighter(playerName, 420, 62),
        enemy: fighter('Mission Enemy', 0, 63),
        now,
    });
    const terminal = {
        ...base,
        status: 'done' as const,
        winner: 'player' as const,
        outcome: 'win' as const,
        terminalEvidence: {
            finishedAt: now + 1,
            finalMoveToken: `mission-win-${suffix}-0001`,
            finalVersion: 2,
            finalEventSeq: 1,
            winner: 'player' as const,
            outcome: 'win' as const,
            itemsUsed: {},
            settlementState: 'pending' as const,
        },
    };
    await writeSession(terminal);
    await kv.set(bindingKey(runId), createBinding({ runId, playerName, mission, now }));
    return runId;
}

async function seedActivePointer(playerName: string, runId: string): Promise<void> {
    const mission = missionByKey(MISSION_ID)!;
    const binding = await kv.get<{ createdAt?: number }>(bindingKey(runId));
    const createdAt = Number(binding?.createdAt);
    assert.equal(Number.isSafeInteger(createdAt), true, 'seeded binding owns an exact creation timestamp');
    await kv.set(activeKey(playerName, MISSION_ID), createActivePointer({
        runId,
        playerName,
        mission,
        now: createdAt,
        sessionId: runId,
    }));
}

function hasPendingClaim(value: unknown): boolean {
    const character = value && typeof value === 'object'
        ? (value as Record<string, unknown>).character
        : null;
    return !!character && typeof character === 'object'
        && Array.isArray((character as Record<string, unknown>).pendingCombatMissionClaims)
        && ((character as Record<string, unknown>).pendingCombatMissionClaims as unknown[]).includes(MISSION_ID);
}

function hasPayoutReceipt(value: unknown): boolean {
    const character = value && typeof value === 'object'
        ? (value as Record<string, unknown>).character
        : null;
    return !!character && typeof character === 'object'
        && Array.isArray((character as Record<string, unknown>).combatMissionClaimSettlements)
        && ((character as Record<string, unknown>).combatMissionClaimSettlements as unknown[]).length > 0;
}

function oldWorkerWouldAcceptToken(value: unknown): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && (value as Record<string, unknown>).authority === 'server-combat';
}

function hasSettlementEffect(value: unknown, field: string): boolean {
    const character = value && typeof value === 'object'
        ? (value as Record<string, unknown>).character
        : null;
    if (!character || typeof character !== 'object') return false;
    const receipts = (character as Record<string, unknown>).combatMissionClaimSettlements;
    return Array.isArray(receipts) && receipts.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const effects = (entry as Record<string, unknown>).effects;
        return !!effects && typeof effects === 'object'
            && Number((effects as Record<string, unknown>)[field] ?? 0) > 0;
    });
}

async function seedNewbieDaily(playerName: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await kv.set(`missions:newbie-daily:${playerName}`, {
        date: today,
        missions: [
            {
                id: `newbie-missions:${today}`,
                templateId: 'newbie-missions-test',
                kind: 'newbie-missions',
                name: 'Mission lesson',
                description: 'Complete a mission.',
                target: 1,
                progress: 0,
                ryoReward: 120,
                completedAt: null,
            },
            {
                id: `newbie-battles:${today}`,
                templateId: 'newbie-battles-test',
                kind: 'newbie-battle-wins',
                name: 'Battle lesson',
                description: 'Win a battle.',
                target: 1,
                progress: 0,
                ryoReward: 160,
                completedAt: null,
            },
        ],
    }, { ex: 36 * 60 * 60 });
}

async function withSetFault(
    predicate: (key: string, value: unknown) => boolean,
    mode: FaultMode,
    fn: () => Promise<Out>,
): Promise<Out> {
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    let injected = false;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (!injected && predicate(key, value)) {
            injected = true;
            if (mode === 'throw-before-commit') throw new Error('simulated write rejection');
            if (mode === 'null-before-commit') return null;
            const result = await originalSet(key, value, options);
            throw new Error('simulated committed write acknowledgement loss');
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (!injected && predicate(key, value)) {
            injected = true;
            if (mode === 'throw-before-commit') throw new Error('simulated compare-set rejection');
            if (mode === 'null-before-commit') return false;
            await originalCompareSet(key, expected, value, options);
            throw new Error('simulated committed compare-set acknowledgement loss');
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    try {
        const result = await fn();
        assert.equal(injected, true, 'fault predicate was reached');
        return result;
    } finally {
        kv.set = originalSet as typeof kv.set;
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
}

async function savedCharacter(playerName: string): Promise<Record<string, unknown>> {
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    return save?.character as Record<string, unknown>;
}

function settlement(runId: string, settledAt: number): CombatMissionClaimSettlement {
    return {
        version: 1,
        runId,
        missionId: MISSION_ID,
        rewardFingerprint: 'a'.repeat(64),
        settledAt,
        result: {
            reward: {
                xpBoosted: 0,
                statPoints: 0,
                ryo: 60,
                stamina: 0,
                territoryScrolls: 1,
                currency: {},
                items: [],
            },
            combat: { aiProfileId: 'builtin-ai-ember-duelist', missionKey: MISSION_ID },
            completion: 'daily',
        },
        effects: {
            version: 1,
            newbieAppliedAt: settledAt,
            newbieRyoAwarded: 0,
            legacyAppliedAt: settledAt,
            eraAppliedAt: settledAt,
            completedAt: settledAt,
        },
    };
}

describe('mission claim authority shape and retention', { concurrency: false }, () => {
    it('accepts the previous rolling-deploy token shape but keeps run + mission binding', () => {
        const parsed = parseCombatMissionClaimToken({
            authority: 'server-combat',
            runId: 'missionsagalegacytoken',
            missionId: MISSION_ID,
            wonAt: Date.now(),
        });
        assert.equal(parsed?.runId, 'missionsagalegacytoken');
        assert.equal(parsed?.missionId, MISSION_ID);
        assert.equal(parseCombatMissionClaimToken({
            authority: 'server-combat',
            runId: '',
            missionId: MISSION_ID,
            wonAt: Date.now(),
        }), null);
    });

    it('preserves all 40 possible live-token markers and bounds only expired history', () => {
        const now = Date.now();
        const live = Array.from({ length: 39 }, (_, index) => settlement(`missionsagalive${index}`, now - index));
        const expired = Array.from({ length: 80 }, (_, index) => (
            settlement(`missionsagaexpired${index}`, now - COMBAT_MISSION_CLAIM_TOKEN_TTL_MS - index - 1)
        ));
        const updated = appendCombatMissionClaimSettlement({
            combatMissionClaimSettlements: [...live, ...expired],
        }, settlement('missionsaganewlive', now), now);
        const receipts = updated.combatMissionClaimSettlements as CombatMissionClaimSettlement[];
        assert.equal(receipts.length, 64);
        for (const marker of live) assert.ok(receipts.some((entry) => entry.runId === marker.runId));
        assert.throws(() => appendCombatMissionClaimSettlement({
            combatMissionClaimSettlements: [settlement('missionsagaextra', now), ...live],
        }, settlement('missionsagaoverflow', now), now), /token-horizon-overflow/);
    });

    it('never evicts an unfinished effect saga after its token horizon', () => {
        const now = Date.now();
        const unfinished = {
            ...settlement('missionsagaunfinished', now - COMBAT_MISSION_CLAIM_TOKEN_TTL_MS - 1),
            effects: { version: 1 as const },
        };
        const expired = Array.from({ length: 80 }, (_, index) => (
            settlement(`missionsagaoldhistory${index}`, now - COMBAT_MISSION_CLAIM_TOKEN_TTL_MS - index - 10)
        ));
        const updated = appendCombatMissionClaimSettlement({
            combatMissionClaimSettlements: [unfinished, ...expired],
        }, settlement('missionsaganext', now), now);
        const receipts = updated.combatMissionClaimSettlements as CombatMissionClaimSettlement[];
        assert.ok(receipts.some((entry) => entry.runId === unfinished.runId));
    });

    it('fails closed when token retirement cannot distinguish read failure from absence', async () => {
        const token: CombatMissionClaimToken = {
            version: 1,
            authority: 'server-combat',
            playerName: 'missionsagaretireread',
            runId: 'missionsagaretirereadrun',
            missionId: MISSION_ID,
            enemyProfileId: 'builtin-ai-ember-duelist',
            rewardFingerprint: 'a'.repeat(64),
            wonAt: Date.now(),
        };
        await assert.rejects(() => retireCombatMissionClaimToken({
            store: {
                compareSet: async () => false,
                get: async () => { throw new Error('simulated retirement read outage'); },
                set: async () => null,
            } as never,
            key: tokenKey(token.playerName, token.missionId),
            expected: token,
            token,
            settlement: settlement(token.runId, Date.now()),
        }), /simulated retirement read outage/);
    });
});

describe('mission queue publication recovery', { concurrency: false }, () => {
    it('accepts a committed token acknowledgement loss only after exact readback', async () => {
        const player = 'missionsagatokenack';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'tokenack');
        const result = await withSetFault(
            (key) => key === tokenKey(player, MISSION_ID),
            'commit-then-throw',
            () => queue(player, runId),
        );
        assert.equal(result.statusCode, 200);
        assert.equal(result.body?.queued, true);
        const token = await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID));
        assert.equal(token?.version, 1);
        assert.equal(token?.runId, runId);
        assert.equal(token?.rewardFingerprint, rewardFingerprint(missionByKey(MISSION_ID)!));
        assert.equal((await kv.get<{ status?: string }>(bindingKey(runId)))?.status, 'won');
    });

    it('fails closed on null token publication and retries from the completed run', async () => {
        const player = 'missionsagatokennull';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'tokennull');
        const failed = await withSetFault(
            (key) => key === tokenKey(player, MISSION_ID),
            'null-before-commit',
            () => queue(player, runId),
        );
        assert.equal(failed.statusCode, 500);
        assert.equal(await kv.get(tokenKey(player, MISSION_ID)), null);
        assert.equal((await kv.get<{ status?: string }>(bindingKey(runId)))?.status, 'active');

        const retry = await queue(player, runId);
        assert.equal(retry.statusCode, 200);
        assert.equal(retry.body?.queued, true);
        assert.ok(await kv.get(tokenKey(player, MISSION_ID)));
    });

    it('does not finalize metadata when the pending-save row is null, then repairs it', async () => {
        const player = 'missionsagasavenull';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'savenull');
        const failed = await withSetFault(
            (key, value) => key === `save:${player}` && hasPendingClaim(value),
            'null-before-commit',
            () => queue(player, runId),
        );
        assert.equal(failed.statusCode, 500);
        assert.ok(await kv.get(tokenKey(player, MISSION_ID)), 'the exact token is safe repair authority');
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), false);
        assert.equal((await kv.get<{ status?: string }>(bindingKey(runId)))?.status, 'active');
        assert.equal((await readSession(runId))?.settlementState, 'pending');

        const retry = await queue(player, runId);
        assert.equal(retry.statusCode, 200);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);
        assert.equal((await kv.get<{ status?: string }>(bindingKey(runId)))?.status, 'won');
    });

    it('repairs either publication row from settled session + binding authority', async () => {
        const player = 'missionsagarepairrows';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'repairrows');
        assert.equal((await queue(player, runId)).statusCode, 200);

        await kv.del(tokenKey(player, MISSION_ID));
        const tokenRepair = await queue(player, runId);
        assert.equal(tokenRepair.statusCode, 200);
        assert.ok(await kv.get(tokenKey(player, MISSION_ID)));

        const saveKey = `save:${player}`;
        const save = (await kv.get<Record<string, unknown>>(saveKey))!;
        const character = save.character as Record<string, unknown>;
        await kv.set(saveKey, {
            ...save,
            _saveVersion: Number(save._saveVersion ?? 0) + 1,
            character: { ...character, pendingCombatMissionClaims: [] },
        });
        const saveRepair = await queue(player, runId);
        assert.equal(saveRepair.statusCode, 200);
        assert.equal(hasPendingClaim(await kv.get(saveKey)), true);
        assert.ok(
            Number((await kv.get<{ expiresAt?: number }>(bindingKey(runId)))?.expiresAt ?? 0)
                >= Date.now() + COMBAT_MISSION_CLAIM_TOKEN_TTL_MS - 1_000,
            'a replay must keep the binding repairable for the refreshed token horizon',
        );
    });

    it('does not let a second completed run replace an earlier unpaid token', async () => {
        const player = 'missionsagaqueueorder';
        await seedPlayer(player);
        const firstRun = await seedWonRun(player, 'queueorderone');
        assert.equal((await queue(player, firstRun)).body?.queued, true);

        const secondRun = await seedWonRun(player, 'queueordertwo');
        const rejected = await queue(player, secondRun);
        assert.equal(rejected.statusCode, 200);
        assert.equal(rejected.body?.queued, false);
        assert.equal(rejected.body?.reason, 'combat-claim-already-pending');
        assert.equal(
            (await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.runId,
            firstRun,
        );
    });

    it('does not overwrite corrupt non-null authority while an earlier payout may be pending', async () => {
        const player = 'missionsagaqueuecorrupt';
        await seedPlayer(player);
        const firstRun = await seedWonRun(player, 'queuecorruptone');
        assert.equal((await queue(player, firstRun)).body?.queued, true);
        const validToken = await kv.get<unknown>(tokenKey(player, MISSION_ID));
        const corrupt = { version: 1, authority: 'server-combat', runId: firstRun };
        await kv.set(tokenKey(player, MISSION_ID), corrupt);

        const secondRun = await seedWonRun(player, 'queuecorrupttwo');
        const rejected = await queue(player, secondRun);
        assert.equal(rejected.statusCode, 200);
        assert.equal(rejected.body?.queued, false);
        assert.equal(rejected.body?.reason, 'combat-claim-authority-invalid');
        assert.deepEqual(await kv.get(tokenKey(player, MISSION_ID)), corrupt);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);

        await kv.set(tokenKey(player, MISSION_ID), validToken);
        assert.equal((await claim(player)).statusCode, 200);
    });
});

describe('mission payout receipt recovery', { concurrency: false }, () => {
    it('fails closed when the token read throws and never clears the pending claim', async () => {
        const player = 'missionsagatokenread';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'tokenread');
        assert.equal((await queue(player, runId)).statusCode, 200);
        const key = tokenKey(player, MISSION_ID);
        const originalGet = kv.get.bind(kv);
        let injected = false;
        kv.get = (async <T>(readKey: string) => {
            if (!injected && readKey === key) {
                injected = true;
                throw new Error('simulated token read outage');
            }
            return originalGet<T>(readKey);
        }) as typeof kv.get;
        let failed: Out;
        try {
            failed = await claim(player);
        } finally {
            kv.get = originalGet as typeof kv.get;
        }
        assert.equal(injected, true);
        assert.equal(failed.statusCode, 500);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);
        assert.equal((await kv.get<Record<string, unknown>>(key))?.runId, runId);
        assert.equal((await claim(player)).statusCode, 200);
    });

    it('treats only an authoritative null as absence and preserves pending on corrupt authority', async () => {
        const player = 'missionsagatokencorrupt';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'tokencorrupt');
        assert.equal((await queue(player, runId)).statusCode, 200);
        const key = tokenKey(player, MISSION_ID);
        const validToken = await kv.get<unknown>(key);
        await kv.set(key, { version: 1, authority: 'server-combat', runId });

        const rejected = await claim(player);
        assert.equal(rejected.statusCode, 200);
        assert.equal(rejected.body?.applied, false);
        assert.equal(rejected.body?.reason, 'combat-claim-authority-invalid');
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);

        await kv.set(key, validToken);
        assert.equal((await claim(player)).statusCode, 200);
    });

    it('fences an expired-lock stale-heal writer with exact save CAS', async () => {
        const player = 'missionsagastaleheal';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'staleheal');
        assert.equal((await queue(player, runId)).statusCode, 200);
        await kv.del(tokenKey(player, MISSION_ID));
        const saveKey = `save:${player}`;
        const originalCompareSet = kv.compareSet.bind(kv);
        const originalSet = kv.set.bind(kv);
        let injected = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (!injected && key === saveKey && !hasPendingClaim(value)) {
                injected = true;
                const current = (await kv.get<Record<string, unknown>>(saveKey))!;
                const character = current.character as Record<string, unknown>;
                await originalSet(saveKey, {
                    ...current,
                    _saveVersion: Number(current._saveVersion ?? 0) + 1,
                    character: { ...character, ryo: Number(character.ryo ?? 0) + 7 },
                });
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        let failed: Out;
        try {
            failed = await claim(player);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.equal(injected, true);
        assert.equal(failed.statusCode, 500);
        assert.equal(hasPendingClaim(await kv.get(saveKey)), true);
        assert.equal(Number((await savedCharacter(player)).ryo), 107);

        const healed = await claim(player);
        assert.equal(healed.statusCode, 200);
        assert.equal(healed.body?.applied, false);
        assert.equal(hasPendingClaim(await kv.get(saveKey)), false);
        assert.equal(Number((await savedCharacter(player)).ryo), 107);
    });

    it('recovers an old-worker delete then pre-save crash only after CAS fencing null to paying', async () => {
        const player = 'missionsagaolddeletepresave';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'olddeletepresave');
        await seedActivePointer(player, runId);
        assert.equal((await queue(player, runId)).statusCode, 200);
        await kv.del(tokenKey(player, MISSION_ID));
        const before = Number((await savedCharacter(player)).ryo);

        const interrupted = await withSetFault(
            (key, value) => key === `save:${player}` && hasPayoutReceipt(value),
            'throw-before-commit',
            () => claim(player),
        );
        assert.equal(interrupted.statusCode, 500);
        assert.equal(Number((await savedCharacter(player)).ryo), before);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);
        const reservationRaw = await kv.get<unknown>(tokenKey(player, MISSION_ID));
        const reservation = parseCombatMissionClaimPaymentReservation(reservationRaw);
        assert.equal(reservation?.runId, runId);
        assert.equal(oldWorkerWouldAcceptToken(reservationRaw), false,
            'legacy recovery must fence old claim workers before any payout write');

        const recovered = await claim(player);
        assert.equal(recovered.statusCode, 200);
        assert.equal(recovered.body?.applied, true);
        assert.equal(Number((await savedCharacter(player)).ryo), before + missionByKey(MISSION_ID)!.ryo);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), false);
        assert.equal(
            (await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.authority,
            'server-combat-spent',
        );
    });

    it('does not recover or repay after the old-worker payout save already cleared pending', async () => {
        const player = 'missionsagaolddeletepaid';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'olddeletepaid');
        await seedActivePointer(player, runId);
        assert.equal((await queue(player, runId)).statusCode, 200);
        await kv.del(tokenKey(player, MISSION_ID));
        const mission = missionByKey(MISSION_ID)!;
        const saveKey = `save:${player}`;
        const record = (await kv.get<Record<string, unknown>>(saveKey))!;
        const character = record.character as Record<string, unknown>;
        const oldCommittedRyo = Number(character.ryo ?? 0) + mission.ryo;
        await kv.set(saveKey, {
            ...record,
            _saveVersion: Number(record._saveVersion ?? 0) + 1,
            character: {
                ...character,
                ryo: oldCommittedRyo,
                pendingCombatMissionClaims: [],
            },
        });

        const replay = await claim(player);
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.applied, false);
        assert.equal(Number((await savedCharacter(player)).ryo), oldCommittedRyo);
        assert.equal(hasPayoutReceipt(await kv.get(saveKey)), false);
        assert.equal(await kv.get(tokenKey(player, MISSION_ID)), null);
    });

    it('fails closed on a non-null mismatched old-delete recovery triplet', async () => {
        const player = 'missionsagaolddeletemismatch';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'olddeletemismatch');
        await seedActivePointer(player, runId);
        assert.equal((await queue(player, runId)).statusCode, 200);
        await kv.del(tokenKey(player, MISSION_ID));
        const pointerKey = activeKey(player, MISSION_ID);
        const pointer = (await kv.get<Record<string, unknown>>(pointerKey))!;
        await kv.set(pointerKey, { ...pointer, playerName: 'missionsagaotheraccount' });

        const rejected = await claim(player);
        assert.equal(rejected.statusCode, 200);
        assert.equal(rejected.body?.applied, false);
        assert.equal(rejected.body?.reason, 'combat-claim-recovery-evidence-invalid');
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);
        assert.equal(Number((await savedCharacter(player)).ryo), 100);
        assert.equal(await kv.get(tokenKey(player, MISSION_ID)), null);
    });

    it('fails closed when old-delete recovery evidence cannot be read', async () => {
        const player = 'missionsagaolddeleteread';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'olddeleteread');
        await seedActivePointer(player, runId);
        assert.equal((await queue(player, runId)).statusCode, 200);
        await kv.del(tokenKey(player, MISSION_ID));
        const pointerKey = activeKey(player, MISSION_ID);
        const originalGet = kv.get.bind(kv);
        let injected = false;
        kv.get = (async <T>(key: string) => {
            if (!injected && key === pointerKey) {
                injected = true;
                throw new Error('simulated active-pointer read outage');
            }
            return originalGet<T>(key);
        }) as typeof kv.get;
        let rejected: Out;
        try {
            rejected = await claim(player);
        } finally {
            kv.get = originalGet as typeof kv.get;
        }
        assert.equal(injected, true);
        assert.equal(rejected.statusCode, 500);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);
        assert.equal(Number((await savedCharacter(player)).ryo), 100);
        assert.equal(await kv.get(tokenKey(player, MISSION_ID)), null);
    });

    it('recovers commit-then-throw and replays the exact reward/character without a second payout', async () => {
        const player = 'missionsagaclaimack';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'claimack');
        assert.equal((await queue(player, runId)).statusCode, 200);
        const before = Number((await savedCharacter(player)).ryo);

        const first = await withSetFault(
            (key, value) => key === `save:${player}` && hasPayoutReceipt(value),
            'commit-then-throw',
            () => claim(player),
        );
        assert.equal(first.statusCode, 200);
        const paidCharacter = await savedCharacter(player);
        assert.equal(Number(paidCharacter.ryo) > before, true);
        assert.equal((first.body?.reward as Record<string, unknown>)?.territoryScrolls, 0);
        assert.equal((paidCharacter.inventory as string[]).includes('territory-control-scroll'), false);
        assert.equal(
            (await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.authority,
            'server-combat-spent',
        );
        assert.equal(oldWorkerWouldAcceptToken(
            await kv.get(tokenKey(player, MISSION_ID)),
        ), false);
        const paidRyo = Number((await savedCharacter(player)).ryo);

        const replay = await claim(player);
        assert.equal(replay.statusCode, 200);
        assert.deepEqual(replay.body?.reward, first.body?.reward);
        assert.deepEqual(replay.body?.character, first.body?.character);
        assert.equal(replay.body?._saveVersion, first.body?._saveVersion);
        assert.equal(Number((await savedCharacter(player)).ryo), paidRyo);
    });

    it('fences the old worker before a payout commit whose acknowledgement is lost', async () => {
        const player = 'missionsagarollingcommit';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'rollingcommit');
        assert.equal((await queue(player, runId)).statusCode, 200);
        const before = Number((await savedCharacter(player)).ryo);
        const originalCompareSet = kv.compareSet.bind(kv);
        let observedFence = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (!observedFence && key === `save:${player}` && hasPayoutReceipt(value)) {
                await originalCompareSet(key, expected, value, options);
                const authority = await kv.get<unknown>(tokenKey(player, MISSION_ID));
                assert.ok(parseCombatMissionClaimPaymentReservation(authority));
                assert.equal(oldWorkerWouldAcceptToken(authority), false);
                observedFence = true;
                throw new Error('simulated payout commit acknowledgement loss');
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        let result: Out;
        try {
            result = await claim(player);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.equal(observedFence, true);
        assert.equal(result.statusCode, 200);
        assert.equal(
            Number((await savedCharacter(player)).ryo),
            before + Number((result.body?.reward as Record<string, unknown>)?.ryo ?? 0),
        );
        assert.equal((await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.authority,
            'server-combat-spent');
    });

    for (const mode of ['throw-before-commit', 'null-before-commit'] as const) {
        it(`${mode} leaves the sole token retryable and pays once`, async () => {
            const suffix = mode === 'throw-before-commit' ? 'claimreject' : 'claimnull';
            const player = `missionsaga${suffix}`;
            await seedPlayer(player);
            const runId = await seedWonRun(player, suffix);
            assert.equal((await queue(player, runId)).statusCode, 200);
            const before = Number((await savedCharacter(player)).ryo);

            const failed = await withSetFault(
                (key, value) => key === `save:${player}` && hasPayoutReceipt(value),
                mode,
                () => claim(player),
            );
            assert.equal(failed.statusCode, 500);
            assert.equal(Number((await savedCharacter(player)).ryo), before);
            const reservation = await kv.get<unknown>(tokenKey(player, MISSION_ID));
            assert.ok(parseCombatMissionClaimPaymentReservation(reservation));
            assert.equal(oldWorkerWouldAcceptToken(reservation), false,
                'a pre-commit failure must never restore old-worker payout authority');
            assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);

            const retry = await claim(player);
            assert.equal(retry.statusCode, 200);
            const paid = Number((await savedCharacter(player)).ryo);
            assert.equal(paid > before, true);
            assert.equal((await claim(player)).statusCode, 200);
            assert.equal(Number((await savedCharacter(player)).ryo), paid);
        });
    }

    it('repairs an old worker pending-clear from the durable pre-commit payment reservation', async () => {
        const player = 'missionsagarollingprecommit';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'rollingprecommit');
        assert.equal((await queue(player, runId)).statusCode, 200);
        const before = Number((await savedCharacter(player)).ryo);
        const failed = await withSetFault(
            (key, value) => key === `save:${player}` && hasPayoutReceipt(value),
            'throw-before-commit',
            () => claim(player),
        );
        assert.equal(failed.statusCode, 500);
        const reservation = await kv.get<unknown>(tokenKey(player, MISSION_ID));
        assert.ok(parseCombatMissionClaimPaymentReservation(reservation));

        // This is exactly what the preceding worker does when it sees the new,
        // intentionally incompatible authority: it removes the mission flag.
        const saveKey = `save:${player}`;
        const oldWorkerSave = (await kv.get<Record<string, unknown>>(saveKey))!;
        const oldWorkerCharacter = oldWorkerSave.character as Record<string, unknown>;
        await kv.set(saveKey, {
            ...oldWorkerSave,
            _saveVersion: Number(oldWorkerSave._saveVersion ?? 0) + 1,
            character: { ...oldWorkerCharacter, pendingCombatMissionClaims: [] },
        });
        assert.equal(hasPendingClaim(await kv.get(saveKey)), false);

        const repaired = await queue(player, runId);
        assert.equal(repaired.statusCode, 200);
        assert.equal(repaired.body?.queued, true);
        assert.equal(hasPendingClaim(await kv.get(saveKey)), true);
        assert.ok(parseCombatMissionClaimPaymentReservation(
            await kv.get(tokenKey(player, MISSION_ID)),
        ), 'queue repair must not roll payment authority back to old-compatible active');

        const recovered = await claim(player);
        assert.equal(recovered.statusCode, 200);
        assert.equal(
            Number((await savedCharacter(player)).ryo),
            before + Number((recovered.body?.reward as Record<string, unknown>)?.ryo ?? 0),
        );
    });

    it('fences an expired-lock writer when an intervening save wins the CAS', async () => {
        const player = 'missionsagacasfence';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'casfence');
        assert.equal((await queue(player, runId)).body?.queued, true);
        const before = Number((await savedCharacter(player)).ryo);
        const saveKey = `save:${player}`;
        const originalCompareSet = kv.compareSet.bind(kv);
        const originalSet = kv.set.bind(kv);
        let injected = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (!injected && key === saveKey && hasPayoutReceipt(value)) {
                injected = true;
                const current = (await kv.get<Record<string, unknown>>(saveKey))!;
                assert.deepEqual(current, expected);
                const currentCharacter = current.character as Record<string, unknown>;
                await originalSet(saveKey, {
                    ...current,
                    _saveVersion: Number(current._saveVersion ?? 0) + 1,
                    character: { ...currentCharacter, ryo: Number(currentCharacter.ryo ?? 0) + 7 },
                });
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        let failed: Out;
        try {
            failed = await claim(player);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }

        assert.equal(injected, true);
        assert.equal(failed.statusCode, 500);
        assert.equal(Number((await savedCharacter(player)).ryo), before + 7);
        assert.equal(hasPayoutReceipt(await kv.get(saveKey)), false);
        assert.equal(hasPendingClaim(await kv.get(saveKey)), true);
        assert.equal(
            (await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.authority,
            'server-combat-paying',
        );

        const retry = await claim(player);
        assert.equal(retry.statusCode, 200);
        assert.equal(
            Number((await savedCharacter(player)).ryo),
            before + 7 + Number((retry.body?.reward as Record<string, unknown>)?.ryo ?? 0),
            'reservation recovery applies its pinned delta onto the intervening exact save',
        );
    });

    it('a lost HTTP response replays from the atomic marker without changing the save', async () => {
        const player = 'missionsagaresponse';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'response');
        assert.equal((await queue(player, runId)).statusCode, 200);
        const first = await claim(player);
        assert.equal(first.statusCode, 200);
        const afterFirst = await kv.get<Record<string, unknown>>(`save:${player}`);

        const retry = await claim(player);
        const afterRetry = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.equal(retry.statusCode, 200);
        assert.deepEqual(retry.body, first.body);
        assert.deepEqual(afterRetry, afterFirst, 'replay skips payout and post-claim side effects');
    });

    it('an old run token can only replay its old receipt and cannot pay a later queued run', async () => {
        const player = 'missionsagastaletoken';
        await seedPlayer(player);
        const firstRun = await seedWonRun(player, 'staleone');
        assert.equal((await queue(player, firstRun)).statusCode, 200);
        const oldToken = (await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))!;
        assert.equal((await claim(player)).statusCode, 200);
        const afterFirst = Number((await savedCharacter(player)).ryo);

        const secondRun = await seedWonRun(player, 'staletwo');
        assert.equal((await queue(player, secondRun)).statusCode, 200);
        const newToken = (await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))!;
        assert.equal(newToken.runId, secondRun);

        const oldQueueRetry = await queue(player, firstRun);
        assert.equal(oldQueueRetry.statusCode, 200);
        assert.equal(oldQueueRetry.body?.queued, true);
        assert.equal(oldQueueRetry.body?.replayed, true);
        assert.equal(
            (await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.runId,
            secondRun,
            'an old run retry must not roll the token key back',
        );
        await kv.set(tokenKey(player, MISSION_ID), oldToken);

        const staleReplay = await claim(player);
        assert.equal(staleReplay.statusCode, 200);
        assert.equal(staleReplay.body?.combatRunId, firstRun);
        assert.equal(Number((await savedCharacter(player)).ryo), afterFirst);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), true);

        await kv.set(tokenKey(player, MISSION_ID), newToken);
        const freshClaim = await claim(player);
        assert.equal(freshClaim.statusCode, 200);
        assert.equal(freshClaim.body?.combatRunId, secondRun);
        assert.equal(Number((await savedCharacter(player)).ryo) > afterFirst, true);
    });

    it('does not let a successor run overlap unfinished effects from the prior payout', async () => {
        const player = 'missionsagasuccessorfence';
        await seedPlayer(player);
        const firstRun = await seedWonRun(player, 'successorone');
        assert.equal((await queue(player, firstRun)).statusCode, 200);
        const oldCompatibleToken = await kv.get<unknown>(tokenKey(player, MISSION_ID));

        const interrupted = await withSetFault(
            (key, value) => key === `save:${player}` && hasSettlementEffect(value, 'newbieAppliedAt'),
            'throw-before-commit',
            () => claim(player),
        );
        assert.equal(interrupted.statusCode, 500);
        const paying = await kv.get<unknown>(tokenKey(player, MISSION_ID));
        assert.ok(parseCombatMissionClaimPaymentReservation(paying));

        const secondRun = await seedWonRun(player, 'successortwo');
        // Emulate a stale rolling row that still exposes the prior active token:
        // the receipt's incomplete effect phase must independently block replace.
        await kv.set(tokenKey(player, MISSION_ID), oldCompatibleToken);
        const blocked = await queue(player, secondRun);
        assert.equal(blocked.statusCode, 200);
        assert.equal(blocked.body?.queued, false);
        assert.equal(blocked.body?.reason, 'combat-claim-already-pending');
        assert.equal((await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.runId, firstRun);

        const recovered = await claim(player);
        assert.equal(recovered.statusCode, 200);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), false);
        const successor = await queue(player, secondRun);
        assert.equal(successor.statusCode, 200);
        assert.equal(successor.body?.queued, true);
        assert.equal((await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.runId, secondRun);
    });

    it('helps a newbie reward forward after crashing between progress and save credit', async () => {
        const player = 'missionsaganewbieeffect';
        await seedPlayer(player, 100, null);
        await seedNewbieDaily(player);
        const runId = await seedWonRun(player, 'newbieeffect');
        assert.equal((await queue(player, runId)).statusCode, 200);

        const failed = await withSetFault(
            (key, value) => key === `save:${player}` && hasSettlementEffect(value, 'newbieAppliedAt'),
            'throw-before-commit',
            () => claim(player),
        );
        assert.equal(failed.statusCode, 500);
        assert.equal(Number((await savedCharacter(player)).ryo), 160, 'only the primary mission payout landed');
        const crashAuthority = await kv.get<unknown>(tokenKey(player, MISSION_ID));
        assert.ok(parseCombatMissionClaimPaymentReservation(crashAuthority));
        assert.equal(oldWorkerWouldAcceptToken(crashAuthority), false,
            'a crash during effects keeps the primary payout fenced from old workers');
        const dailyAfterCrash = await kv.get<{ missions?: Array<{ progress?: number }>; combatMissionEffects?: unknown[] }>(`missions:newbie-daily:${player}`);
        assert.deepEqual(dailyAfterCrash?.missions?.map((entry) => entry.progress), [1, 1]);
        assert.equal(dailyAfterCrash?.combatMissionEffects?.length, 1);
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const rolled = await loadOrIssueNewbieDailies(player, tomorrow);
        assert.equal(rolled.date, tomorrow.toISOString().slice(0, 10));
        assert.equal(rolled.combatMissionEffects?.length, 1, 'daily rollover preserves an unresolved run receipt');
        const rolledMissions = structuredClone(rolled.missions);
        await kv.del(tokenKey(player, MISSION_ID));

        const retry = await claim(player);
        assert.equal(retry.statusCode, 200);
        assert.equal(Number((await savedCharacter(player)).ryo), 440, 'the two newbie rewards land exactly once');
        const dailyAfterRetry = await kv.get<{ missions?: unknown[]; combatMissionEffects?: unknown[] }>(`missions:newbie-daily:${player}`);
        assert.deepEqual(dailyAfterRetry?.missions, rolledMissions, 'help-forward does not roll the new daily board backwards');
        assert.equal(dailyAfterRetry?.combatMissionEffects?.length, 1);
        assert.ok(Number((dailyAfterRetry?.combatMissionEffects?.[0] as Record<string, unknown>)?.acknowledgedAt) > 0,
            'ack retains a bounded terminal run ID so a paused stale caller cannot reapply it');
        assert.equal((await claim(player)).statusCode, 200);
        assert.equal(Number((await savedCharacter(player)).ryo), 440);
    });

    it('honors pinned newbie Ryo when a profession is chosen after the target marker commits', async () => {
        const player = 'missionsagaprofessiontransition';
        await seedPlayer(player, 100, null);
        await seedNewbieDaily(player);
        const runId = await seedWonRun(player, 'professiontransition');
        assert.equal((await queue(player, runId)).statusCode, 200);

        const interrupted = await withSetFault(
            (key, value) => key === `save:${player}` && hasSettlementEffect(value, 'newbieAppliedAt'),
            'throw-before-commit',
            () => claim(player),
        );
        assert.equal(interrupted.statusCode, 500);
        assert.equal(Number((await savedCharacter(player)).ryo), 160);
        const saveKey = `save:${player}`;
        const record = (await kv.get<Record<string, unknown>>(saveKey))!;
        await kv.set(saveKey, {
            ...record,
            _saveVersion: Number(record._saveVersion ?? 0) + 1,
            character: { ...(record.character as Record<string, unknown>), profession: 'Medic' },
        });

        const recovered = await claim(player);
        assert.equal(recovered.statusCode, 200);
        const recoveredCharacter = await savedCharacter(player);
        assert.equal(recoveredCharacter.profession, 'Medic');
        assert.equal(Number(recoveredCharacter.ryo), 440,
            'the run marker, not the later profession state, owns the already-earned 280 Ryo');
        const daily = await kv.get<{ combatMissionEffects?: Array<{ runId?: string; acknowledgedAt?: number }> }>(
            `missions:newbie-daily:${player}`,
        );
        assert.ok(daily?.combatMissionEffects?.some((entry) => entry.runId === runId
            && Number(entry.acknowledgedAt) > 0));
        assert.equal((await claim(player)).statusCode, 200);
        assert.equal(Number((await savedCharacter(player)).ryo), 440);
    });

    it('help-forwards an unstaged receipt instead of silently declaring its post-effects complete', async () => {
        const player = 'missionsagaunstagedreceipt';
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        await kv.del('era:contrib:missions', 'era:contrib-idempotent:missions');
        try {
            const { readEraContributions } = await import('../_era.js');
            await seedPlayer(player, 100, null);
            await seedNewbieDaily(player);
            const runId = await seedWonRun(player, 'unstagedreceipt');
            assert.equal((await queue(player, runId)).statusCode, 200);

            const mission = missionByKey(MISSION_ID)!;
            const saveKey = `save:${player}`;
            const paidRecord = (await kv.get<Record<string, unknown>>(saveKey))!;
            const paidCharacter = paidRecord.character as Record<string, unknown>;
            const unstaged: CombatMissionClaimSettlement = {
                version: 1,
                runId,
                missionId: mission.key,
                rewardFingerprint: rewardFingerprint(mission),
                settledAt: Date.now(),
                result: {
                    reward: {
                        xpBoosted: 0,
                        statPoints: 0,
                        ryo: mission.ryo,
                        stamina: 0,
                        territoryScrolls: mission.territoryScrolls,
                        currency: {},
                        items: [],
                    },
                    combat: { aiProfileId: mission.aiProfileId, missionKey: mission.key },
                    completion: 'daily',
                },
            };
            await kv.set(saveKey, {
                ...paidRecord,
                _saveVersion: Number(paidRecord._saveVersion ?? 0) + 1,
                character: {
                    ...paidCharacter,
                    ryo: Number(paidCharacter.ryo ?? 0) + mission.ryo,
                    totalAiKills: Number(paidCharacter.totalAiKills ?? 0) + 1,
                    totalMissionsCompleted: Number(paidCharacter.totalMissionsCompleted ?? 0) + 1,
                    combatMissionClaimSettlements: [unstaged],
                },
            });
            await kv.del(tokenKey(player, MISSION_ID));

            const recovered = await claim(player);
            assert.equal(recovered.statusCode, 200);
            assert.equal(Number((await savedCharacter(player)).ryo), 100 + mission.ryo + 280);
            const legacy = await kv.get<Record<string, unknown>>(`legacy:stats:${player}`);
            assert.equal(legacy?.missionCompletions, 1);
            assert.equal(legacy?.pveKills, 1);
            assert.equal((await readEraContributions()).missions, 1);
            const recoveredCharacter = await savedCharacter(player);
            const recoveredReceipt = (recoveredCharacter.combatMissionClaimSettlements as CombatMissionClaimSettlement[])
                .find((entry) => entry.runId === runId);
            assert.ok(recoveredReceipt?.effects?.newbieAppliedAt);
            assert.ok(recoveredReceipt?.effects?.legacyAppliedAt);
            assert.ok(recoveredReceipt?.effects?.eraAppliedAt);
            assert.ok(recoveredReceipt?.effects?.completedAt);
            assert.equal(hasPendingClaim(await kv.get(saveKey)), false);

            const afterRecovery = await kv.get<Record<string, unknown>>(saveKey);
            assert.equal((await claim(player)).statusCode, 200);
            assert.deepEqual(await kv.get(saveKey), afterRecovery, 'an exact replay does not repeat any recovered effect');
        } finally {
            await kv.del('era:contrib:missions', 'era:contrib-idempotent:missions');
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });

    it('helps Legacy counters forward after crashing between target CAS and save stamp', async () => {
        const player = 'missionsagalegacyeffect';
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        try {
            await seedPlayer(player);
            const runId = await seedWonRun(player, 'legacyeffect');
            assert.equal((await queue(player, runId)).statusCode, 200);
            const failed = await withSetFault(
                (key, value) => key === `save:${player}` && hasSettlementEffect(value, 'legacyAppliedAt'),
                'throw-before-commit',
                () => claim(player),
            );
            assert.equal(failed.statusCode, 500);
            const afterCrash = await kv.get<Record<string, unknown>>(`legacy:stats:${player}`);
            assert.equal(afterCrash?.missionCompletions, 1);
            assert.equal(afterCrash?.pveKills, 1);
            assert.equal(Array.isArray(afterCrash?.combatMissionEffects), true);

            assert.equal((await claim(player)).statusCode, 200);
            const afterRetry = await kv.get<Record<string, unknown>>(`legacy:stats:${player}`);
            assert.equal(afterRetry?.missionCompletions, 1);
            assert.equal(afterRetry?.pveKills, 1);
            assert.equal(Array.isArray(afterRetry?.combatMissionEffects), true);
            assert.ok(Number((afterRetry?.combatMissionEffects as Array<Record<string, unknown>>)?.[0]?.acknowledgedAt) > 0);
            assert.equal((await claim(player)).statusCode, 200);
            assert.equal((await kv.get<Record<string, unknown>>(`legacy:stats:${player}`))?.pveKills, 1);
        } finally {
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });

    it('helps the Era contribution forward after crashing between target CAS and save stamp', async () => {
        const player = 'missionsagaeraeffect';
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        await kv.del('era:contrib:missions', 'era:contrib-idempotent:missions');
        try {
            const { readEraContributions } = await import('../_era.js');
            await seedPlayer(player);
            const runId = await seedWonRun(player, 'eraeffect');
            assert.equal((await queue(player, runId)).statusCode, 200);
            const failed = await withSetFault(
                (key, value) => key === `save:${player}` && hasSettlementEffect(value, 'eraAppliedAt'),
                'throw-before-commit',
                () => claim(player),
            );
            assert.equal(failed.statusCode, 500);
            assert.equal((await readEraContributions()).missions, 1);

            assert.equal((await claim(player)).statusCode, 200);
            assert.equal((await readEraContributions()).missions, 1);
            const sidecar = await kv.get<{
                pending?: unknown[];
                settled?: Array<{ receiptId?: string }>;
                compactedTotal?: number;
            }>('era:contrib-idempotent:missions');
            assert.deepEqual(sidecar?.pending, []);
            assert.equal(sidecar?.compactedTotal, 1);
            assert.equal(sidecar?.settled?.length, 1);
            assert.equal((await claim(player)).statusCode, 200);
            assert.equal((await readEraContributions()).missions, 1);
        } finally {
            await kv.del('era:contrib:missions', 'era:contrib-idempotent:missions');
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });

    it('terminal target-row run IDs fence callers paused until after acknowledgement', async () => {
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        const player = 'missionsagapausedafterack';
        const runId = 'missionsagapausedafterackrun';
        await kv.del('era:contrib:missions', 'era:contrib-idempotent:missions');
        try {
            const {
                reportNewbieCombatRunOnce,
                acknowledgeNewbieCombatRun,
            } = await import('./_progress.js');
            const {
                bumpLegacyStatsForCombatRunOnce,
                acknowledgeLegacyCombatRun,
            } = await import('../_legacy-track.js');
            const {
                bumpEraContributionOnce,
                acknowledgeEraContribution,
                readEraContributions,
            } = await import('../_era.js');

            await seedPlayer(player, 100, null);
            await seedNewbieDaily(player);
            const firstNewbie = await reportNewbieCombatRunOnce({ playerName: player, runId, settledAt: Date.now() });
            await acknowledgeNewbieCombatRun(player, runId);
            const newbieAfterAck = await kv.get<unknown>(`missions:newbie-daily:${player}`);
            const staleNewbie = await reportNewbieCombatRunOnce({ playerName: player, runId, settledAt: Date.now() });
            assert.equal(staleNewbie.ryoAwarded, firstNewbie.ryoAwarded);
            assert.deepEqual(await kv.get(`missions:newbie-daily:${player}`), newbieAfterAck,
                'a stale report after ack must not advance the daily board twice');

            assert.equal(await bumpLegacyStatsForCombatRunOnce(
                player,
                runId,
                { missionCompletions: 1, pveKills: 1 },
                await savedCharacter(player),
            ), true);
            await acknowledgeLegacyCombatRun(player, runId);
            assert.equal(await bumpLegacyStatsForCombatRunOnce(
                player,
                runId,
                { missionCompletions: 1, pveKills: 1 },
                await savedCharacter(player),
            ), false);
            const legacy = await kv.get<Record<string, unknown>>(`legacy:stats:${player}`);
            assert.equal(legacy?.missionCompletions, 1);
            assert.equal(legacy?.pveKills, 1);

            assert.equal(await bumpEraContributionOnce('missions', runId), true);
            await acknowledgeEraContribution('missions', runId);
            assert.equal(await bumpEraContributionOnce('missions', runId), false);
            assert.equal((await readEraContributions()).missions, 1);
            const era = await kv.get<{ settled?: Array<{ receiptId?: string }> }>('era:contrib-idempotent:missions');
            assert.ok(era?.settled?.some((entry) => entry.receiptId === runId));
        } finally {
            await kv.del('era:contrib:missions', 'era:contrib-idempotent:missions');
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });

    it('a successor queue helps a completed paying row through lost retirement acknowledgement', async () => {
        const player = 'missionsagasuccessorretire';
        await seedPlayer(player);
        const firstRun = await seedWonRun(player, 'successorretireone');
        assert.equal((await queue(player, firstRun)).statusCode, 200);
        const failed = await withSetFault(
            (key, value) => key === tokenKey(player, MISSION_ID)
                && !!value && typeof value === 'object'
                && (value as Record<string, unknown>).authority === 'server-combat-spent',
            'throw-before-commit',
            () => claim(player),
        );
        assert.equal(failed.statusCode, 500);
        assert.equal((await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.authority,
            'server-combat-paying');
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), false);
        const paid = Number((await savedCharacter(player)).ryo);

        const secondRun = await seedWonRun(player, 'successorretiretwo');
        const successor = await queue(player, secondRun);
        assert.equal(successor.statusCode, 200);
        assert.equal(successor.body?.queued, true);
        assert.equal((await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.runId, secondRun);
        assert.equal(Number((await savedCharacter(player)).ryo), paid,
            'queue retirement repair never replays the prior payout');
    });

    it('retries token retirement after every effect is durable without replaying any payout', async () => {
        const player = 'missionsagaretireeffect';
        await seedPlayer(player);
        const runId = await seedWonRun(player, 'retireeffect');
        assert.equal((await queue(player, runId)).statusCode, 200);
        const before = Number((await savedCharacter(player)).ryo);
        const failed = await withSetFault(
            (key, value) => key === tokenKey(player, MISSION_ID)
                && !!value && typeof value === 'object'
                && (value as Record<string, unknown>).authority === 'server-combat-spent',
            'throw-before-commit',
            () => claim(player),
        );
        assert.equal(failed.statusCode, 500);
        const paid = Number((await savedCharacter(player)).ryo);
        assert.equal(paid > before, true);
        assert.equal(hasPendingClaim(await kv.get(`save:${player}`)), false);
        assert.equal((await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.authority, 'server-combat-paying');

        assert.equal((await claim(player)).statusCode, 200);
        assert.equal(Number((await savedCharacter(player)).ryo), paid);
        assert.equal((await kv.get<Record<string, unknown>>(tokenKey(player, MISSION_ID)))?.authority, 'server-combat-spent');
    });
});
