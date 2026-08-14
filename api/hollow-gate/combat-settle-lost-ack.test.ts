import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hollow-gate-lost-ack-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let startHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let createBinding: typeof import('./_combat-session.js').createHollowGateCombatBinding;
let bindingKeyFor: typeof import('./_combat-session.js').hollowGateCombatBindingKey;
let runKeyFor: typeof import('./_run-token.js').hollowGateRunKey;
let createSoloSession: typeof import('../solo-pve/_session.js').createSoloPveSession;
let readSoloSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let summonLeaseKey: typeof import('../solo-pve/_pet-battle-authority.js').soloPveSummonLeaseKey;

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

function request(playerName: string, token: string, runId: string, petReceipt: string) {
    return {
        method: 'POST',
        body: { playerName, token, runId, petReceipt },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName)!,
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function post(playerName: string, token: string, runId: string, petReceipt: string): Promise<Out> {
    const out = response();
    await handler(request(playerName, token, runId, petReceipt), out.res);
    return out.out;
}

async function postStart(playerName: string, requestId: string): Promise<Out> {
    const out = response();
    await startHandler({
        method: 'POST',
        body: { playerName, requestId },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName)!,
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, out.res);
    return out.out;
}

async function seedPetEncounter(playerName: string, suffix: string) {
    const token = `gatetoken${suffix}`;
    const runId = `hgcombat${suffix}`;
    const petReceipt = `petreceipt${suffix}`;
    const nodeId = 'floor:1:tile:12';
    const binding = createBinding({
        playerName,
        token,
        floor: 1,
        nodeId,
        kind: 'battle',
        runId,
        combatMode: 'pet',
    });
    const saveKey = `save:${playerName}`;
    await kv.set(saveKey, {
        _saveVersion: 7,
        character: {
            name: playerName,
            level: 20,
            maxHp: 500,
            hp: 500,
            ryo: 100,
            hollowGateRun: { floor: 1, runToken: token, serverSeed: `seed-${suffix}` },
            pets: [{
                id: 'pet-1',
                name: 'Ack Hound',
                loadout: { consumable: { id: 'soldier-pill', name: 'Soldier Pill' } },
            }],
        },
    });
    await kv.set(runKeyFor(playerName, token), {
        playerName,
        mintedAt: Date.now(),
        floorDepth: 5,
        currentFloor: 1,
        seed: `seed-${suffix}`,
        entryCurrencies: { ryo: 100 },
        offeredAugmentIds: [],
        chosenAugmentId: null,
        dailyRunOrdinal: 1,
        activeEncounter: {
            runId,
            nodeId,
            floor: 1,
            kind: 'battle',
            enemyProfileId: binding.enemyProfileId,
            createdAt: binding.createdAt,
        },
        resolvedEncounterIds: [],
    });
    await kv.set(bindingKeyFor(runId), binding);
    await kv.set(`hg-pet-result:${playerName}:${petReceipt}`, {
        playerName,
        runId,
        outcome: 'win',
        playerPetIds: ['pet-1'],
        settledAt: Date.now(),
    });
    return { token, runId, petReceipt, saveKey, receiptKey: `hg-combat-paid:${runId}` };
}

async function seedPendingCompanionEncounter(playerName: string, suffix: string) {
    const token = `gatesolotoken${suffix}`;
    const runId = `hgsolocombat${suffix}`;
    const nodeId = 'floor:1:tile:13';
    const binding = createBinding({
        playerName,
        token,
        floor: 1,
        nodeId,
        kind: 'battle',
        runId,
        combatMode: 'solo-pve',
    });
    const saveKey = `save:${playerName}`;
    await kv.set(saveKey, {
        _saveVersion: 7,
        character: {
            name: playerName,
            level: 20,
            maxHp: 500,
            hp: 500,
            ryo: 100,
            hollowGateRun: { floor: 1, runToken: token, serverSeed: `seed-${suffix}` },
            pets: [{
                id: 'pet-common',
                name: 'Common Hound',
                loadout: { pve: 'pve-crest', pveDurability: 2, consumable: 'pet-tonic' },
            }],
        },
    });
    const fighter = (name: string, hp: number, pos: number) => ({
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
        character: { name, level: 20, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    });
    const base = createSoloSession({
        sessionId: runId,
        ownerSlug: playerName,
        encounter: {
            kind: 'hollow-gate',
            id: `seed-${suffix}:1:${nodeId}:battle`,
            sourceId: binding.enemyProfileId,
            bindingId: runId,
            metadata: { floor: 1, nodeId, combatKind: 'battle' },
        },
        player: fighter(playerName, 350, 62),
        enemy: fighter('Hollow Hound', 0, 63),
        now: Date.now(),
    });
    const moveToken = `summon-hollow-${suffix}-0001`;
    const leaseValue = `solo-pve-summon:${runId}`;
    const session = {
        ...base,
        usageAuthorityVersion: 1 as const,
        status: 'done' as const,
        winner: 'player' as const,
        outcome: 'win' as const,
        companionUsage: {
            petId: 'pet-common',
            pveGearId: 'pve-crest',
            consumableId: 'pet-tonic',
        },
        companionCostAuthority: {
            version: 1 as const,
            leaseValue,
            moveToken,
            settlementState: 'pending' as const,
        },
        terminalEvidence: {
            finishedAt: Date.now(),
            finalMoveToken: moveToken,
            finalVersion: 2,
            finalEventSeq: 1,
            winner: 'player' as const,
            outcome: 'win' as const,
            itemsUsed: {},
            companionUsage: {
                petId: 'pet-common',
                pveGearId: 'pve-crest',
                consumableId: 'pet-tonic',
            },
            settlementState: 'pending' as const,
        },
    };
    await writeSoloSession(session);
    await kv.set(summonLeaseKey(playerName), leaseValue, { ex: 2 * 60 * 60 });
    await kv.set(runKeyFor(playerName, token), {
        playerName,
        mintedAt: Date.now(),
        floorDepth: 5,
        currentFloor: 1,
        seed: `seed-${suffix}`,
        entryCurrencies: { ryo: 100 },
        offeredAugmentIds: [],
        chosenAugmentId: null,
        dailyRunOrdinal: 1,
        activeEncounter: {
            runId,
            nodeId,
            floor: 1,
            kind: 'battle',
            enemyProfileId: binding.enemyProfileId,
            createdAt: binding.createdAt,
        },
        resolvedEncounterIds: [],
    });
    await kv.set(bindingKeyFor(runId), binding);
    return { token, runId, saveKey, receiptKey: `hg-combat-paid:${runId}` };
}

function settledIds(record: Record<string, unknown> | null): string[] {
    const character = record?.character as Record<string, unknown> | undefined;
    return Array.isArray(character?.settledHollowGateCombatIds)
        ? character.settledHollowGateCombatIds.filter((id): id is string => typeof id === 'string')
        : [];
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ createHollowGateCombatBinding: createBinding, hollowGateCombatBindingKey: bindingKeyFor } = await import('./_combat-session.js'));
    ({ hollowGateRunKey: runKeyFor } = await import('./_run-token.js'));
    ({ createSoloPveSession: createSoloSession } = await import('../solo-pve/_session.js'));
    ({ readSoloPveSession: readSoloSession, writeSoloPveSession: writeSoloSession } = await import('../solo-pve/_store.js'));
    ({ soloPveSummonLeaseKey: summonLeaseKey } = await import('../solo-pve/_pet-battle-authority.js'));
    handler = (await import('./combat-settle.js')).default as unknown as Handler;
    startHandler = (await import('./start.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

function settlementMarkers(record: Record<string, unknown> | null): Array<Record<string, unknown>> {
    const character = record?.character as Record<string, unknown> | undefined;
    return Array.isArray(character?.hollowGateCombatSettlements)
        ? character.hollowGateCombatSettlements as Array<Record<string, unknown>>
        : [];
}

/** Mirrors the rolling v2 handler's cached-receipt branch through its first mutation. */
async function legacyWorkerCachedReceiptAttempt(playerName: string, token: string, runId: string): Promise<'deleted-orphan' | 'would-advance'> {
    const receiptKey = `hg-combat-paid:${runId}`;
    const receipt = await kv.get<Record<string, unknown>>(receiptKey);
    if (!receipt) throw new Error('legacy-receipt-missing');
    const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const character = record?.character as Record<string, unknown> | undefined;
    const appliedIds = Array.isArray(character?.settledHollowGateCombatIds)
        ? character.settledHollowGateCombatIds as unknown[]
        : [];
    if (receipt.version === 2 && !appliedIds.includes(runId)) {
        await kv.del(receiptKey);
        return 'deleted-orphan';
    }
    const run = await kv.get<Record<string, unknown>>(runKeyFor(playerName, token));
    if (!run) return 'would-advance';
    const activeEncounter = run.activeEncounter as Record<string, unknown> | null | undefined;
    const resolvedEncounterIds = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
    const alreadyResolved = resolvedEncounterIds.includes(`floor:1:battle:floor:1:tile:12`);
    if (activeEncounter?.runId === runId && receipt.won === true && !alreadyResolved) {
        // This is the exact v2 persistRun access that the v4 tripwire must
        // fail before any run/binding write.
        const paid = receipt.reward as Record<string, unknown>;
        void paid.ryo;
    }
    return 'would-advance';
}

test('a committed save CAS with a lost acknowledgement completes from exact in-save proof', { concurrency: false }, async () => {
    const playerName = 'hollowackcommit';
    const seeded = await seedPetEncounter(playerName, 'commit');
    const originalCompareSet = kv.compareSet.bind(kv);
    let loseAcknowledgement = true;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const result = await originalCompareSet(key, expected, value, options);
        if (key === seeded.saveKey && loseAcknowledgement) {
            loseAcknowledgement = false;
            throw new Error('simulated committed save acknowledgement loss');
        }
        return result;
    }) as typeof kv.compareSet;

    let settled: Out;
    try {
        settled = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(settled.statusCode, 200);
    assert.equal(loseAcknowledgement, false);
    assert.equal((await kv.get<{ version?: number }>(seeded.receiptKey))?.version, 3);

    const committed = await kv.get<Record<string, unknown>>(seeded.saveKey);
    const committedCharacter = committed?.character as Record<string, unknown>;
    const committedRyo = Number(committedCharacter.ryo);
    assert.equal(committed?._saveVersion, 8);
    assert.ok(committedRyo > 100);
    assert.ok(settledIds(committed).includes(seeded.runId));
    assert.equal(settlementMarkers(committed).length, 1);
    const committedPet = (committedCharacter.pets as Array<Record<string, unknown>>)[0];
    assert.equal((committedPet.loadout as Record<string, unknown>).consumable, undefined);

    const replay = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.alreadyReported, true);
    const afterReplay = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(afterReplay?._saveVersion, 8);
    assert.equal(Number((afterReplay?.character as Record<string, unknown>).ryo), committedRyo);
    assert.equal((await kv.get<{ status?: string }>(bindingKeyFor(seeded.runId)))?.status, 'won');
    assert.equal((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
});

test('a fulfilled-null save CAS fails before payout and retry pays once', { concurrency: false }, async () => {
    const playerName = 'hollowackreject';
    const seeded = await seedPetEncounter(playerName, 'reject');
    const originalCompareSet = kv.compareSet.bind(kv);
    let rejectWrite = true;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === seeded.saveKey && rejectWrite) {
            rejectWrite = false;
            return null as never;
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    let failed: Out;
    try {
        failed = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(failed.statusCode, 500);
    const preparation = await kv.get<{ version?: number; state?: string }>(seeded.receiptKey);
    assert.equal(preparation?.version, 4);
    assert.equal(preparation?.state, 'prepared');
    const rejected = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(rejected?._saveVersion, 7);
    assert.equal(Number((rejected?.character as Record<string, unknown>).ryo), 100);
    assert.equal(settledIds(rejected).includes(seeded.runId), false);
    assert.equal(settlementMarkers(rejected).length, 0);

    const retry = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(retry.statusCode, 200);
    assert.notEqual(retry.body?.alreadyReported, true);
    const paid = await kv.get<Record<string, unknown>>(seeded.saveKey);
    const paidRyo = Number((paid?.character as Record<string, unknown>).ryo);
    assert.equal(paid?._saveVersion, 8);
    assert.ok(paidRyo > 100);
    assert.ok(settledIds(paid).includes(seeded.runId));

    const replay = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.alreadyReported, true);
    const final = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(final?._saveVersion, 8);
    assert.equal(Number((final?.character as Record<string, unknown>).ryo), paidRyo);
});

test('pending common companion usage and payout recover exact committed CAS acknowledgements without double charge', { concurrency: false }, async () => {
    const playerName = 'hollowcommonack';
    const seeded = await seedPendingCompanionEncounter(playerName, 'common');
    const originalCompareSet = kv.compareSet.bind(kv);
    let saveWrites = 0;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const result = await originalCompareSet(key, expected, value, options);
        if (key === seeded.saveKey) {
            saveWrites += 1;
            // Companion charge + marker finalization are the first two writes;
            // lose the acknowledgement for the subsequent Hollow payout.
            if (saveWrites === 3) throw new Error('simulated Hollow payout acknowledgement loss');
        }
        return result;
    }) as typeof kv.compareSet;

    let failed: Out;
    try {
        failed = await post(playerName, seeded.token, seeded.runId, '');
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(failed.statusCode, 200);
    assert.equal(saveWrites, 3);
    const afterCommit = await kv.get<Record<string, unknown>>(seeded.saveKey);
    const committedCharacter = afterCommit?.character as Record<string, unknown>;
    const committedPet = (committedCharacter.pets as Array<Record<string, any>>)[0]!;
    assert.equal(committedPet.loadout.pveDurability, 1);
    assert.equal(committedPet.loadout.consumable, undefined);
    const marker = (committedCharacter.soloPveCompanionSettlements as Array<Record<string, unknown>>)[0]!;
    assert.ok(Number(marker.committedAt) > 0);
    assert.equal(marker.recoverUntil, 0);
    assert.equal(await kv.get(summonLeaseKey(playerName)), null);
    assert.equal((await kv.get<{ version?: number }>(seeded.receiptKey))?.version, 3);

    const durableSession = await readSoloSession(seeded.runId);
    assert.equal(durableSession?.companionCostAuthority?.settlementState, 'settled');
    const paidRyo = Number(committedCharacter.ryo);
    const replay = await post(playerName, seeded.token, seeded.runId, '');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.alreadyReported, true);
    const afterReplay = await kv.get<Record<string, unknown>>(seeded.saveKey);
    const replayCharacter = afterReplay?.character as Record<string, unknown>;
    assert.equal(Number(replayCharacter.ryo), paidRyo);
    assert.equal(((replayCharacter.pets as Array<Record<string, any>>)[0]!.loadout as Record<string, unknown>).pveDurability, 1);
});

test('lost cache CAS acknowledgement proceeds only after exact stored readback', { concurrency: false }, async () => {
    const playerName = 'hollowreceiptack';
    const seeded = await seedPetEncounter(playerName, 'receiptack');
    const originalCompareSet = kv.compareSet.bind(kv);
    let injected = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const result = await originalCompareSet(key, expected, value, options);
        if (key === seeded.receiptKey && !injected) {
            injected = true;
            throw new Error('simulated committed receipt acknowledgement loss');
        }
        return result;
    }) as typeof kv.compareSet;
    let outcome: Out;
    try {
        outcome = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(outcome.statusCode, 200);
    assert.equal(injected, true);
    assert.ok(await kv.get(seeded.receiptKey));
    const paid = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.ok(settledIds(paid).includes(seeded.runId));
});

test('cache CAS failure after payout keeps run advancement closed and retry repairs from the in-save marker', { concurrency: false }, async () => {
    const playerName = 'hollowreceiptreject';
    const seeded = await seedPetEncounter(playerName, 'receiptreject');
    const originalCompareSet = kv.compareSet.bind(kv);
    let reject = true;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === seeded.receiptKey && reject && (value as { version?: number } | null)?.version === 3) {
            reject = false;
            return null as never;
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    let failed: Out;
    try {
        failed = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(failed.statusCode, 500);
    const preparation = await kv.get<{ version?: number; state?: string }>(seeded.receiptKey);
    assert.equal(preparation?.version, 4);
    assert.equal(preparation?.state, 'prepared');
    const committed = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(committed?._saveVersion, 8);
    const committedRyo = Number((committed?.character as Record<string, unknown>).ryo);
    assert.ok(committedRyo > 100);
    assert.equal(settlementMarkers(committed).length, 1);
    assert.notEqual((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
    assert.equal((await kv.get<{ status?: string }>(bindingKeyFor(seeded.runId)))?.status, 'active');

    const retry = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body?.alreadyReported, true);
    const paid = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(paid?._saveVersion, 8);
    assert.equal(Number((paid?.character as Record<string, unknown>).ryo), committedRyo);
    assert.equal((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
});

test('legacy v2 migration recovers a crash after marker commit but before cache upgrade', { concurrency: false }, async () => {
    const playerName = 'hollowlegacymigrationack';
    const seeded = await seedPetEncounter(playerName, 'legacymigrationack');
    const legacyReceipt = {
        version: 2,
        won: true,
        reward: { xp: 0, ryo: 37, auraDust: 0, honorSeals: 0, boneCharms: 0, fateShards: 0, hollowShards: 0, fragments: 0, veils: 0 },
        elementalShards: 0,
        settledAt: Date.now(),
    };
    const record = await kv.get<Record<string, unknown>>(seeded.saveKey);
    const character = structuredClone(record!.character as Record<string, unknown>);
    character.ryo = 137;
    character.settledHollowGateCombatIds = [seeded.runId];
    await kv.set(seeded.saveKey, { ...record, _saveVersion: 8, character });
    await kv.set(seeded.receiptKey, legacyReceipt, { ex: 60 });

    const originalCompareSet = kv.compareSet.bind(kv);
    let rejectUpgrade = true;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === seeded.receiptKey && rejectUpgrade && (value as { version?: number } | null)?.version === 3) {
            rejectUpgrade = false;
            return null as never;
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    let failed: Out;
    try {
        failed = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(failed.statusCode, 500);
    const markerCommitted = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(markerCommitted?._saveVersion, 9);
    assert.equal(Number((markerCommitted?.character as Record<string, unknown>).ryo), 137);
    assert.equal(settlementMarkers(markerCommitted).length, 1);
    assert.equal((await kv.get<{ version?: number }>(seeded.receiptKey))?.version, 2);
    assert.notEqual((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);

    const retry = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body?.alreadyReported, true);
    const final = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(final?._saveVersion, 9);
    assert.equal(Number((final?.character as Record<string, unknown>).ryo), 137);
    assert.equal((await kv.get<{ version?: number }>(seeded.receiptKey))?.version, 3);
    assert.equal((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
});

test('a wrong cache receipt without exact save proof cannot pay or advance the run', { concurrency: false }, async () => {
    const playerName = 'hollowwrongreceipt';
    const seeded = await seedPetEncounter(playerName, 'wrongreceipt');
    const wrong = {
        version: 3,
        won: true,
        reward: { xp: 999999, ryo: 999999, auraDust: 0, honorSeals: 0, boneCharms: 0, fateShards: 0, hollowShards: 0, fragments: 0, veils: 0 },
        elementalShards: 0,
        settledAt: Date.now(),
    };
    await kv.set(seeded.receiptKey, wrong, { ex: 60 });
    const rejected = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(rejected.statusCode, 409);
    const save = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(save?._saveVersion, 7);
    assert.equal(Number((save?.character as Record<string, unknown>).ryo), 100);
    assert.equal(settlementMarkers(save).length, 0);
    assert.notEqual((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
    assert.deepEqual(await kv.get(seeded.receiptKey), wrong);
});

test('a paused writer cannot overwrite the winner after both run and save locks expire', { concurrency: false }, async () => {
    const playerName = 'hollowpausedwriter';
    const seeded = await seedPetEncounter(playerName, 'pausedwriter');
    const originalCompareSet = kv.compareSet.bind(kv);
    let releasePaused!: () => void;
    let markPaused!: () => void;
    const paused = new Promise<void>((resolve) => { markPaused = resolve; });
    const release = new Promise<void>((resolve) => { releasePaused = resolve; });
    let intercepted = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === seeded.saveKey && !intercepted) {
            intercepted = true;
            markPaused();
            await release;
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    let first: Promise<Out>;
    let second: Out;
    try {
        first = post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
        await paused;
        await kv.del(`lock:${runKeyFor(playerName, seeded.token)}`, `lock:${seeded.saveKey}`);
        second = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
        releasePaused();
        const stale = await first;
        assert.equal(second.statusCode, 200);
        assert.equal(stale.statusCode, 200);
    } finally {
        releasePaused?.();
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    const save = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(save?._saveVersion, 8);
    assert.equal(settlementMarkers(save).length, 1);
    assert.ok(Number((save?.character as Record<string, unknown>).ryo) > 100);
    assert.equal((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
});

test('rolling old-first reservation makes v4 back off, then exact legacy save proof migrates without repaying', { concurrency: false }, async () => {
    const playerName = 'hollowrollingoldfirst';
    const seeded = await seedPetEncounter(playerName, 'rollingoldfirst');
    const originalCompareSet = kv.compareSet.bind(kv);
    let markPaused!: () => void;
    let releasePaused!: () => void;
    const paused = new Promise<void>((resolve) => { markPaused = resolve; });
    const release = new Promise<void>((resolve) => { releasePaused = resolve; });
    let intercepted = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === seeded.receiptKey && (value as { version?: number } | null)?.version === 4 && !intercepted) {
            intercepted = true;
            markPaused();
            await release;
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    const legacyReceipt = {
        version: 2,
        won: true,
        reward: { xp: 0, ryo: 37, auraDust: 0, honorSeals: 0, boneCharms: 0, fateShards: 0, hollowShards: 0, fragments: 0, veils: 0 },
        elementalShards: 0,
        settledAt: Date.now(),
    };
    let blocked: Out;
    try {
        const newWorker = post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
        await paused;
        assert.equal(await kv.set(seeded.receiptKey, legacyReceipt, { nx: true, ex: 60 }), 'OK');
        releasePaused();
        blocked = await newWorker;
    } finally {
        releasePaused?.();
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(blocked.statusCode, 409);
    const beforeLegacyCommit = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(beforeLegacyCommit?._saveVersion, 7);
    assert.equal(Number((beforeLegacyCommit?.character as Record<string, unknown>).ryo), 100);

    // Complete the already-reserved legacy worker exactly once.
    const legacyCharacter = structuredClone(beforeLegacyCommit!.character as Record<string, unknown>);
    legacyCharacter.ryo = 137;
    legacyCharacter.settledHollowGateCombatIds = [seeded.runId];
    const legacyPets = legacyCharacter.pets as Array<Record<string, unknown>>;
    legacyPets[0] = {
        ...legacyPets[0],
        loadout: { ...(legacyPets[0]!.loadout as Record<string, unknown>), consumable: undefined },
    };
    await kv.set(seeded.saveKey, { ...beforeLegacyCommit, _saveVersion: 8, character: legacyCharacter });

    const migrated = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(migrated.statusCode, 200);
    assert.equal(migrated.body?.alreadyReported, true);
    const final = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(final?._saveVersion, 9);
    assert.equal(Number((final?.character as Record<string, unknown>).ryo), 137);
    assert.equal(settlementMarkers(final).length, 1);
    assert.equal((await kv.get<{ version?: number }>(seeded.receiptKey))?.version, 3);
    assert.equal((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
});

test('an abandoned old-worker v2 reservation is taken over only after its liveness horizon', { concurrency: false }, async () => {
    const playerName = 'hollowrollingorphan';
    const seeded = await seedPetEncounter(playerName, 'rollingorphan');
    const legacyReceipt = {
        version: 2,
        won: true,
        reward: { xp: 0, ryo: 485, auraDust: 5, honorSeals: 0, boneCharms: 0, fateShards: 0, hollowShards: 0, fragments: 0, veils: 0 },
        elementalShards: 0,
        settledAt: Date.now() - 6 * 60 * 1_000,
    };
    await kv.set(seeded.receiptKey, legacyReceipt, { ex: 60 });

    const recovered = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(recovered.statusCode, 200);
    const save = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(save?._saveVersion, 8);
    assert.equal(Number((save?.character as Record<string, unknown>).ryo), 585);
    assert.equal(settlementMarkers(save).length, 1);
    assert.equal((await kv.get<{ version?: number }>(seeded.receiptKey))?.version, 3);
    assert.equal((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
});

test('an active projected run blocks a second Hollow Gate start without spending another key', { concurrency: false }, async () => {
    const playerName = 'hollowsecondstartblocked';
    const seeded = await seedPetEncounter(playerName, 'secondstartblocked');
    const before = await kv.get<Record<string, unknown>>(seeded.saveKey);
    const character = structuredClone(before!.character as Record<string, unknown>);
    character.itemStacks = [{ itemId: 'hollow-gate-key', count: 2 }];
    await kv.set(seeded.saveKey, { ...before, character });

    const blocked = await postStart(playerName, 'second-start-request-0001');
    assert.equal(blocked.statusCode, 409);
    const after = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.deepEqual((after?.character as Record<string, unknown>).itemStacks, [{ itemId: 'hollow-gate-key', count: 2 }]);
    assert.equal(((after?.character as Record<string, unknown>).hollowGateRun as Record<string, unknown>).runToken, seeded.token);
});

test('a paused Run A payout cannot overwrite a successor Run B save projection', { concurrency: false }, async () => {
    const playerName = 'hollowsuccessorfence';
    const seeded = await seedPetEncounter(playerName, 'successorfence');
    const originalCompareSet = kv.compareSet.bind(kv);
    let markPaused!: () => void;
    let releasePaused!: () => void;
    const paused = new Promise<void>((resolve) => { markPaused = resolve; });
    const release = new Promise<void>((resolve) => { releasePaused = resolve; });
    let intercepted = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const character = (value as { character?: Record<string, unknown> } | null)?.character;
        if (key === seeded.saveKey && Array.isArray(character?.hollowGateCombatSettlements) && !intercepted) {
            intercepted = true;
            markPaused();
            await release;
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    let first: Out;
    try {
        const settling = post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
        await paused;
        await kv.del(`lock:${runKeyFor(playerName, seeded.token)}`, `lock:${seeded.saveKey}`);
        const current = await kv.get<Record<string, unknown>>(seeded.saveKey);
        const successorToken = 'successorhollowtoken';
        const successorSeed = 'successor-hollow-seed';
        await kv.set(runKeyFor(playerName, successorToken), {
            playerName,
            mintedAt: Date.now(),
            floorDepth: 5,
            currentFloor: 1,
            seed: successorSeed,
            entryCurrencies: { ryo: 100 },
            offeredAugmentIds: [],
            chosenAugmentId: null,
            dailyRunOrdinal: 2,
            resolvedEncounterIds: [],
        });
        await kv.set(seeded.saveKey, {
            ...current,
            _saveVersion: Number(current?._saveVersion ?? 0) + 1,
            character: {
                ...(current?.character as Record<string, unknown>),
                hollowGateRun: { floor: 1, runToken: successorToken, serverSeed: successorSeed },
            },
        });
        releasePaused();
        first = await settling;
    } finally {
        releasePaused?.();
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(first.statusCode, 500);
    const retry = await post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
    assert.equal(retry.statusCode, 409);
    const final = await kv.get<Record<string, unknown>>(seeded.saveKey);
    const finalCharacter = final?.character as Record<string, unknown>;
    assert.equal((finalCharacter.hollowGateRun as Record<string, unknown>).runToken, 'successorhollowtoken');
    assert.equal(Number(finalCharacter.ryo), 100);
    assert.equal(settlementMarkers(final).length, 0);
});

test('rolling new-first preparation makes a paused v2 worker fail closed before response or downstream writes', { concurrency: false }, async () => {
    const playerName = 'hollowrollingnewfirst';
    const seeded = await seedPetEncounter(playerName, 'rollingnewfirst');
    const originalCompareSet = kv.compareSet.bind(kv);
    let markPaused!: () => void;
    let releasePaused!: () => void;
    const paused = new Promise<void>((resolve) => { markPaused = resolve; });
    const release = new Promise<void>((resolve) => { releasePaused = resolve; });
    let intercepted = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === seeded.saveKey && !intercepted) {
            intercepted = true;
            markPaused();
            await release;
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    let settled: Out;
    try {
        const newWorker = post(playerName, seeded.token, seeded.runId, seeded.petReceipt);
        await paused;
        const preparation = await kv.get<Record<string, unknown>>(seeded.receiptKey);
        assert.equal(preparation?.version, 4);
        assert.equal(preparation?.won, true);
        assert.equal(Object.hasOwn(preparation!, 'reward'), false);
        await kv.del(`lock:${runKeyFor(playerName, seeded.token)}`, `lock:${seeded.saveKey}`);
        await assert.rejects(
            legacyWorkerCachedReceiptAttempt(playerName, seeded.token, seeded.runId),
            TypeError,
        );
        const beforeResume = await kv.get<Record<string, unknown>>(seeded.saveKey);
        assert.equal(beforeResume?._saveVersion, 7);
        assert.notEqual((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
        assert.equal((await kv.get<{ status?: string }>(bindingKeyFor(seeded.runId)))?.status, 'active');
        releasePaused();
        settled = await newWorker;
    } finally {
        releasePaused?.();
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
    assert.equal(settled.statusCode, 200);
    const final = await kv.get<Record<string, unknown>>(seeded.saveKey);
    assert.equal(final?._saveVersion, 8);
    assert.ok(Number((final?.character as Record<string, unknown>).ryo) > 100);
    assert.equal(settlementMarkers(final).length, 1);
    assert.equal((await kv.get<{ version?: number }>(seeded.receiptKey))?.version, 3);
    assert.equal((await kv.get<{ activeEncounter?: unknown }>(runKeyFor(playerName, seeded.token)))?.activeEncounter, null);
});
