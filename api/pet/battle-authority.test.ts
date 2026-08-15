import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-authority-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
let startHandler: Handler;
let resultHandler: Handler;
let rankedStartHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let token = '';
let opponentToken = '';
let rankedPairSequence = 0;
const PLAYER = 'petauthorityprobe';
const OPPONENT = 'petauthorityrival';

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

function request(body: Record<string, unknown>, authToken = token, remoteAddress = '127.0.0.1') {
    return {
        method: 'POST', body,
        headers: { 'content-type': 'application/json', 'x-player-token': authToken },
        socket: { remoteAddress },
    } as never;
}

function rankedLedgerEntry(character: Record<string, unknown>, matchToken: string): Record<string, unknown> | string | undefined {
    return (character.redeemedPetRankedMatchTokens as unknown[] | undefined)?.find((entry) => (
        entry === matchToken
        || (!!entry && typeof entry === 'object' && (entry as Record<string, unknown>).matchToken === matchToken)
    )) as Record<string, unknown> | string | undefined;
}

async function authorizeRankedQueuePair(initiator: string, opponent: string): Promise<string> {
    rankedPairSequence += 1;
    const pairId = `00000000-0000-4000-8000-${String(rankedPairSequence).padStart(12, '0')}`;
    const createdAt = Date.now();
    await Promise.all([
        kv.set(`pvp:pet-ranked-queue:match:${initiator}`, {
            opponent,
            opponentElo: 1000,
            opponentLevel: 1,
            initiator: true,
            createdAt,
            pairId,
        }, { ex: 30 }),
        kv.set(`pvp:pet-ranked-queue:match:${opponent}`, {
            opponent: initiator,
            opponentElo: 1000,
            opponentLevel: 1,
            initiator: false,
            createdAt,
            pairId,
        }, { ex: 30 }),
    ]);
    return pairId;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken(PLAYER)!;
    opponentToken = auth.issuePlayerToken(OPPONENT)!;
    startHandler = (await import('./battle-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
    rankedStartHandler = (await import('./ranked-start.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, level: 1, ryo: 0, professionRank: 0,
            pets: [{
                id: 'owned-pet', name: 'Owned Pet', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
                hp: 300, attack: 60, defense: 40, speed: 35,
                jutsus: [{ name: 'Strike', power: 50, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
            }],
        },
    });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('unauthenticated forged names cannot consume a victim settlement budget', async () => {
    const victim = 'petresultlimitvictim';
    const battleToken = 'LimitVictimBattle01';
    const reportKey = 'limit-victim-battle';
    const auth = await import('../_auth.js');
    const victimToken = auth.issuePlayerToken(victim)!;
    await kv.set(`save:${victim}`, {
        _saveVersion: 1,
        character: { name: victim, level: 1, ryo: 0, professionRank: 0, pets: [] },
    });
    await kv.set(`pet:battle-token:${victim}:${battleToken}`, {
        playerName: victim,
        reportKey,
        opponentLevel: 1,
        rewardRyo: 20,
        playerPetIds: [],
        authoritativeOutcome: 'draw',
        mode: '1v1',
    }, { ex: 15 * 60 });

    const body = { playerName: victim, outcome: 'win', reportKey, battleToken };
    for (let i = 0; i < 3; i += 1) {
        const forged = response();
        await resultHandler(request(body, '', '203.0.113.10'), forged.res);
        assert.equal(forged.out.statusCode, 401, 'pre-auth traffic must be rejected without charging a body-name bucket');
    }

    const valid = response();
    await resultHandler(request(body, victimToken, '203.0.113.11'), valid.res);
    assert.equal(valid.out.statusCode, 200, 'the authenticated victim keeps their full settlement budget');
    assert.equal(valid.out.body?.ok, true);
});

test('new user-picked AI starts fail closed while an already-issued receipt can resume and settle', async () => {
    const body = {
        playerName: PLAYER,
        playerPetIds: ['owned-pet'],
        opponentPetIds: ['generic-ai-pet-sparrow'],
        mode: '1v1',
        seed: 0,
        reportKey: 'caller-selected',
    };
    const rejected = response();
    await startHandler(request(body), rejected.res);
    assert.equal(rejected.out.statusCode, 410);
    assert.match(String(rejected.out.body?.error), /pick-your-opponent Pet Coliseum is retired/);
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null, 'rejected admission must not publish a proof');

    const [{ createCasualPveBattleSeal }, { replayCasualPetDuel }, { SERVER_ARENA_PETS }] = await Promise.all([
        import('./_casual-pve-seal.js'),
        import('./_duel-replay.js'),
        import('./_arena-ai.js'),
    ]);
    const saved = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    const savedPet = ((saved?.character as Record<string, unknown>).pets as unknown[])[0] as never;
    const aiPet = SERVER_ARENA_PETS['generic-ai-pet-sparrow'];
    const params = {
        mode: '1v1' as const, seed: 71, damageMult: 1, hpMult: 1,
        revive: false, applyItems: true, accuracy: true, terrain: null,
    };
    const casualPveSeal = createCasualPveBattleSeal([savedPet], [aiPet], params);
    const legacyToken = 'LegacyAiReceipt01';
    const legacyReportKey = `pet:${legacyToken}`;
    await kv.set(`pet:battle-token:${PLAYER}:${legacyToken}`, {
        playerName: PLAYER,
        reportKey: legacyReportKey,
        seed: params.seed,
        opponentLevel: aiPet.level,
        rewardRyo: 20,
        playerPetIds: ['owned-pet'],
        opponentPetIds: [aiPet.id],
        sealedParams: params,
        casualPveSeal,
        authoritativeOutcome: replayCasualPetDuel(casualPveSeal.playerPets, casualPveSeal.opponentPets, params, []).outcome,
        mode: '1v1',
        // Deliberately no settlementPolicy: this is a pre-cutover receipt.
    }, { ex: 15 * 60 });
    await kv.set(`pet:battle-active:${PLAYER}`, legacyToken, { ex: 15 * 60 });

    const first = response();
    await startHandler(request(body), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.equal(first.out.body?.resumed, true);
    assert.equal(first.out.body?.token, legacyToken);
    assert.equal(first.out.body?.reportKey, legacyReportKey);
    assert.equal(first.out.body?.seed, params.seed);

    const duplicate = response();
    await startHandler(request(body), duplicate.res);
    assert.equal(duplicate.out.statusCode, 200);
    assert.equal(duplicate.out.body?.token, first.out.body?.token);
    assert.equal(duplicate.out.body?.seed, first.out.body?.seed);

    const settled = response();
    await resultHandler(request({
        playerName: PLAYER,
        outcome: 'draw',
        reportKey: first.out.body?.reportKey,
        battleToken: first.out.body?.token,
    }), settled.res);
    assert.equal(settled.out.statusCode, 200);

    // The settlement deletes its one-use battle token before responding. A
    // response-lost retry must therefore recover through the receipt stored in
    // the player's authoritative save rather than degrading to "invalid token".
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6_000;
    try {
        const replayed = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'draw',
            reportKey: first.out.body?.reportKey,
            battleToken: first.out.body?.token,
        }), replayed.res);
        assert.equal(replayed.out.statusCode, 200);
        assert.equal(replayed.out.body?.replayed, true);
        assert.equal(replayed.out.body?.reason, 'already-recorded');
        assert.ok(replayed.out.body?.character);

        const rankedToken = '00000000-0000-4000-8000-000000000001';
        const prior = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
        const priorCharacter = prior?.character as Record<string, unknown>;
        await kv.set(`save:${PLAYER}`, {
            ...prior,
            character: {
                ...priorCharacter,
                petRankedRating: 1_245,
                redeemedPetRankedMatchTokens: [rankedToken],
            },
        });
        Date.now = () => realDateNow() + 12_000;
        const rankedReplay = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'win',
            ranked: true,
            reportKey: 'ranked-response-replay',
            matchToken: rankedToken,
        }), rankedReplay.res);
        assert.equal(rankedReplay.out.statusCode, 200);
        assert.equal(rankedReplay.out.body?.replayed, true);
        assert.equal((rankedReplay.out.body?.rating as Record<string, unknown>)?.value, 1_245);
    } finally {
        Date.now = realDateNow;
    }

    const next = response();
    await startHandler(request(body), next.res);
    assert.equal(next.out.statusCode, 410, 'settling an old receipt must not reopen legacy admission');
});

test('casual PvE settlement replays the kickoff snapshot after the saved pet mutates', async () => {
    const playerName = 'casualsnapshotprobe';
    const auth = await import('../_auth.js');
    const playerToken = auth.issuePlayerToken(playerName)!;
    const kickoffPet = {
        id: 'snapshot-pet', name: 'River Guardian', nickname: 'Original Mizu',
        element: 'Water', rarity: 'rare', level: 40, xp: 0, maxLevel: 100,
        hp: 10_000, attack: 10_000, defense: 10_000, speed: 200,
        chronicleArenaWins: 9,
        image: `data:image/png;base64,${'A'.repeat(8_192)}`,
        // Keep the field present so the seal still proves it is stripped, but
        // do not make the fixture combat-ineligible: training/unclaimed
        // training is now an authoritative busy state at battle start.
        training: null,
        jutsus: [{ name: 'Tidal Verdict', power: 500, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
        unlockedForPve: true,
    };
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        character: {
            name: playerName, level: 40, ryo: 0, professionRank: 0,
            starterCardsClaimed: true, tileCards: [], pets: [kickoffPet],
        },
    });

    // Model a receipt minted immediately before the single-owner cutover. The
    // kickoff snapshot remains redeemable even though no new generic-AI proof
    // can be created now.
    const [{ createCasualPveBattleSeal }, { replayCasualPetDuel }, { SERVER_ARENA_PETS }] = await Promise.all([
        import('./_casual-pve-seal.js'),
        import('./_duel-replay.js'),
        import('./_arena-ai.js'),
    ]);
    const aiPet = SERVER_ARENA_PETS['generic-ai-pet-sparrow'];
    const battleConfig = {
        mode: '1v1' as const, seed: 73, damageMult: 1, hpMult: 1,
        revive: false, applyItems: true, accuracy: true, terrain: null,
    };
    const casualPveSeal = createCasualPveBattleSeal([kickoffPet] as never, [aiPet], battleConfig);
    const legacyToken = 'LegacySnapshotReceipt01';
    const legacyReportKey = `pet:${legacyToken}`;
    const authoritativeOutcome = replayCasualPetDuel(
        casualPveSeal.playerPets,
        casualPveSeal.opponentPets,
        battleConfig,
        [],
    ).outcome;
    assert.equal(authoritativeOutcome, 'win');
    await kv.set(`pet:battle-token:${playerName}:${legacyToken}`, {
        playerName,
        reportKey: legacyReportKey,
        seed: battleConfig.seed,
        opponentLevel: aiPet.level,
        rewardRyo: 20,
        playerPetIds: [kickoffPet.id],
        opponentPetIds: [aiPet.id],
        sealedParams: battleConfig,
        casualPveSeal,
        authoritativeOutcome,
        mode: '1v1',
    }, { ex: 15 * 60 });
    await kv.set(`pet:battle-active:${playerName}`, legacyToken, { ex: 15 * 60 });

    const started = response();
    await startHandler(request({
        playerName,
        playerPetIds: [kickoffPet.id],
        opponentPetIds: ['generic-ai-pet-sparrow'],
        mode: '1v1',
    }, playerToken, '127.0.0.31'), started.res);
    assert.equal(started.out.statusCode, 200);

    const playerPets = started.out.body?.playerPets as never[];
    const opponentPets = started.out.body?.opponentPets as never[];
    const returnedBattleConfig = started.out.body?.battleConfig as never;
    assert.equal(playerPets.length, 1);
    assert.equal('image' in (playerPets[0] as object), false, 'the proof excludes save-owned inline art');
    assert.equal('training' in (playerPets[0] as object), false, 'the proof excludes mutable care state');

    const sealedOutcome = replayCasualPetDuel(playerPets as never, opponentPets as never, returnedBattleConfig, []).outcome;
    const mutatedPet = {
        ...kickoffPet,
        name: 'Rewritten Pet', nickname: 'Mutated Ember', element: 'Fire',
        hp: 1, attack: 1, defense: 0, speed: 1,
        image: 'replacement-art', training: undefined,
    };
    const mutableOutcome = replayCasualPetDuel([mutatedPet] as never, opponentPets as never, returnedBattleConfig, []).outcome;
    assert.equal(sealedOutcome, 'win');
    assert.equal(mutableOutcome, 'loss', 'the fixture must discriminate sealed from current-save replay');

    const current = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const currentCharacter = current?.character as Record<string, unknown>;
    await kv.set(`save:${playerName}`, {
        ...current,
        character: { ...currentCharacter, pets: [mutatedPet] },
    });

    const tokenValue = String(started.out.body?.token ?? '');
    const stored = await kv.get<{ rewardRyo?: number }>(`pet:battle-token:${playerName}:${tokenValue}`);
    const settled = response();
    await resultHandler(request({
        playerName,
        outcome: 'loss',
        reportKey: started.out.body?.reportKey,
        battleToken: tokenValue,
        inputLog: [],
    }, playerToken, '127.0.0.32'), settled.res);

    assert.equal(settled.out.statusCode, 200);
    assert.equal(settled.out.body?.outcome, sealedOutcome);
    assert.equal(settled.out.body?.reward, stored?.rewardRyo);
    assert.deepEqual(settled.out.body?.chronicleCards, ['pet-witness-water']);
    const witnesses = settled.out.body?.witnessedPets as Array<Record<string, unknown>>;
    assert.equal(witnesses[0]?.petName, 'Original Mizu');
    assert.equal(witnesses[0]?.element, 'Water');
    assert.deepEqual(settled.out.body?.livingWitnessProgress, [{
        sourceReceipt: `pet-casual:${tokenValue}`,
        petId: kickoffPet.id,
        petName: 'Original Mizu',
        cardId: 'pet-witness-water',
        wins: 10,
        threshold: 10,
        deedRecorded: true,
        cardPressed: true,
    }]);
    const settledCharacter = settled.out.body?.character as Record<string, unknown>;
    const settledPet = (settledCharacter.pets as Array<Record<string, unknown>>)[0];
    assert.equal(settledPet.attack, 1, 'settlement does not roll mutable save state back to the proof');
    assert.equal(settledPet.chronicleArenaWins, 10);
});

test('ranked proof is retired after both authoritative saves and a lost response replays from the receipt', async () => {
    const rivalPet = {
        id: 'rival-pet', name: 'Rival Pet', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 300, attack: 58, defense: 42, speed: 34, unlockedForPve: true,
        jutsus: [{ name: 'Strike', power: 50, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
    await kv.set(`save:${OPPONENT}`, {
        _saveVersion: 1,
        character: {
            name: OPPONENT, level: 1, ryo: 0, professionRank: 0,
            activePetId: rivalPet.id,
            pets: [rivalPet],
        },
    });

    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 120_000;
    try {
        const started = response();
        await authorizeRankedQueuePair(PLAYER, OPPONENT);
        await rankedStartHandler(request({ opponentName: OPPONENT, petId: 'owned-pet' }), started.res);
        assert.equal(started.out.statusCode, 200);
        const matchToken = String(started.out.body?.matchToken ?? '');
        assert.match(matchToken, /^[0-9a-f-]{36}$/i);
        const rankedSeal = await kv.get<Record<string, unknown>>(`pet:ranked-token:${matchToken}`);
        assert.ok(rankedSeal);
        const versionsBefore = new Map<string, number>();
        for (const slug of [PLAYER, OPPONENT]) {
            const save = await kv.get<Record<string, unknown>>(`save:${slug}`);
            versionsBefore.set(slug, Number(save?._saveVersion ?? 0));
        }

        Date.now = () => realDateNow() + 126_000;
        const settledByPlayer = response();
        const settledByOpponent = response();
        const report = {
            playerName: PLAYER,
            outcome: 'win',
            ranked: true,
            reportKey: `ranked:${matchToken}`,
            matchToken,
        };
        await Promise.all([
            resultHandler(request(report), settledByPlayer.res),
            resultHandler(request({ ...report, playerName: OPPONENT }, opponentToken), settledByOpponent.res),
        ]);
        assert.equal(settledByPlayer.out.statusCode, 200);
        assert.equal(settledByOpponent.out.statusCode, 200);
        assert.ok(
            settledByPlayer.out.body?.replayed === true || settledByOpponent.out.body?.replayed === true,
            'one concurrent reporter must reconcile from the committed receipt after proof retirement',
        );
        assert.equal(await kv.get(`pet:ranked-token:${matchToken}`), null, 'live ranked proof must be retired');
        assert.ok(await kv.get(`pet:ranked-result:${matchToken}`), 'a durable response-replay receipt must precede proof retirement');

        for (const slug of [PLAYER, OPPONENT]) {
            const save = await kv.get<Record<string, unknown>>(`save:${slug}`);
            const character = save?.character as Record<string, unknown>;
            assert.equal(
                Number(save?._saveVersion),
                Number(versionsBefore.get(slug)) + 1,
                `${slug} must be settled exactly once under concurrent reports`,
            );
            const ledgerEntry = rankedLedgerEntry(character, matchToken);
            assert.ok(ledgerEntry, `${slug} must commit the receipt in the same authoritative save as rating settlement`);
            assert.equal(typeof ledgerEntry, 'object', 'new ranked settlements retain durable outcome evidence');
            assert.equal((ledgerEntry as Record<string, unknown>).outcome === 'win'
                || (ledgerEntry as Record<string, unknown>).outcome === 'loss', true);
        }

        // Simulate aggressive rolling-ledger compaction from many inbound
        // challenges. Lost-response recovery must use the dedicated result
        // receipt, not depend on this token remaining in the save array.
        const compactedSave = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
        const compactedCharacter = compactedSave?.character as Record<string, unknown>;
        await kv.set(`save:${PLAYER}`, {
            ...compactedSave,
            character: {
                ...compactedCharacter,
                redeemedPetRankedMatchTokens: Array.from(
                    { length: 300 },
                    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
                ),
            },
        });
        // Simulate both proof-cleanup operations failing after the result receipt
        // committed. The result receipt must outrank this still-live proof.
        await kv.set(`pet:ranked-token:${matchToken}`, rankedSeal, { ex: 15 * 60 });

        Date.now = () => realDateNow() + 132_000;
        const replayed = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'loss',
            ranked: true,
            reportKey: `ranked:${matchToken}`,
            matchToken,
        }), replayed.res);
        assert.equal(replayed.out.statusCode, 200);
        assert.equal(replayed.out.body?.replayed, true);
        assert.ok(replayed.out.body?.character, 'lost-response replay must return the current authoritative character');
        assert.equal(await kv.get(`pet:ranked-token:${matchToken}`), null, 'replay should finish best-effort proof cleanup');
        const afterReplay = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
        assert.equal(Number(afterReplay?._saveVersion), Number(versionsBefore.get(PLAYER)) + 1, 'replay must not write the save again');
    } finally {
        Date.now = realDateNow;
    }
});

test('ranked save evidence recovers winner Legacy credit after receipt outage, initial Legacy outage, and proof expiry', async () => {
    const alpha = 'rankedledgeralpha';
    const omega = 'rankedledgeromega';
    const matchToken = '00000000-0000-4000-8000-000000900001';
    const alphaPet = {
        id: 'alpha-pet', name: 'Alpha Pet', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 4_000, attack: 900, defense: 900, speed: 900,
        jutsus: [{ name: 'Decisive Strike', power: 900, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
    const omegaPet = {
        id: 'omega-pet', name: 'Omega Pet', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 1, attack: 1, defense: 1, speed: 1,
        jutsus: [{ name: 'Tap', power: 1, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
    const { runPetDuel } = await import('../_pet-sim/pet-duel-sim.js');
    assert.equal(runPetDuel(alphaPet as never, omegaPet as never, 73, 1, 1, false).result, 'win');

    const auth = await import('../_auth.js');
    const alphaToken = auth.issuePlayerToken(alpha)!;
    const omegaToken = auth.issuePlayerToken(omega)!;
    for (const [slug, pet] of [[alpha, alphaPet], [omega, omegaPet]] as const) {
        await kv.set(`save:${slug}`, {
            _saveVersion: 1,
            character: {
                name: slug,
                level: 1,
                ryo: 0,
                professionRank: 0,
                petRankedRating: 1_000,
                activePetId: pet.id,
                pets: [pet],
            },
        });
    }

    const realDateNow = Date.now;
    const previousLegacyFlag = process.env.ENABLE_LEGACY;
    const originalSet = kv.set;
    const baseNow = realDateNow() + 600_000;
    Date.now = () => baseNow;
    process.env.ENABLE_LEGACY = '1';
    await kv.set(`pet:ranked-token:${matchToken}`, {
        authority: 'pet-ranked-queue-v1',
        pairId: '00000000-0000-4000-8000-000000900001',
        a: alpha,
        b: omega,
        aRating: 1_000,
        bRating: 1_000,
        aPet: alphaPet,
        bPet: omegaPet,
        seed: 73,
        createdAt: baseNow,
    }, { ex: 15 * 60 });

    const resultKey = `pet:ranked-result:${matchToken}`;
    let receiptWriteAttempts = 0;
    let legacyWriteAttempts = 0;
    try {
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (key === resultKey) {
            receiptWriteAttempts += 1;
            throw new Error('injected ranked result receipt outage');
        }
        if (key === `legacy:stats:${alpha}`) {
            legacyWriteAttempts += 1;
            throw new Error('injected ranked Legacy receipt outage');
        }
        return originalSet(key, value, options);
    };

    try {
        Date.now = () => baseNow + 6_000;
        const failed = response();
        await resultHandler(request({
            playerName: alpha,
            outcome: 'loss',
            ranked: true,
            reportKey: `ranked:${matchToken}`,
            matchToken,
        }, alphaToken, '203.0.113.21'), failed.res);
        assert.equal(failed.out.statusCode, 503, 'participant saves commit but the shared receipt outage remains retryable');
        assert.equal(receiptWriteAttempts, 1);
        assert.ok(legacyWriteAttempts >= 1, 'the eager idempotent Legacy attempt ran before the shared receipt write');
        assert.equal(await kv.get(resultKey), null);

        for (const [slug, expectedOutcome] of [[alpha, 'win'], [omega, 'loss']] as const) {
            const save = await kv.get<Record<string, unknown>>(`save:${slug}`);
            const character = save?.character as Record<string, unknown>;
            const entry = rankedLedgerEntry(character, matchToken);
            assert.equal(typeof entry, 'object');
            assert.equal((entry as Record<string, unknown>).outcome, expectedOutcome);
            assert.equal((entry as Record<string, unknown>).winnerName, alpha);
            assert.equal(Number(save?._saveVersion), 2, 'rating and durable evidence commit together exactly once');
        }
        assert.equal(await kv.get(`legacy:stats:${alpha}`), null, 'the simultaneous Legacy outage leaves the save ledger responsible for recovery');

        // Keep the injected result-receipt outage active until after the original
        // 15-minute proof has genuinely expired.
        Date.now = () => baseNow + (16 * 60 * 1_000);
        assert.equal(await kv.get(`pet:ranked-token:${matchToken}`), null);
    } finally {
        kv.set = originalSet;
    }

        Date.now = () => baseNow + (16 * 60 * 1_000) + 6_000;
        const replayed = response();
        await resultHandler(request({
            playerName: omega,
            outcome: 'win',
            ranked: true,
            reportKey: `ranked:${matchToken}`,
            matchToken,
        }, omegaToken, '203.0.113.22'), replayed.res);
        assert.equal(replayed.out.statusCode, 200);
        assert.equal(replayed.out.body?.replayed, true);
        assert.equal(replayed.out.body?.outcome, 'loss', 'the protected save receipt, not the forged report, recovers the outcome');
        assert.ok(await kv.get(resultKey), 'ledger replay heals the shared response receipt');

        const credited = await kv.get<Record<string, unknown>>(`legacy:stats:${alpha}`);
        assert.equal(credited?.petDuelWins, 1, 'winner-only Legacy credit resumes after proof expiry');
        assert.ok((credited?.activityReceipts as unknown[]).includes(`pet-ranked:${matchToken}`));

        Date.now = () => baseNow + (16 * 60 * 1_000) + 12_000;
        const duplicate = response();
        await resultHandler(request({
            playerName: alpha,
            outcome: 'draw',
            ranked: true,
            reportKey: `ranked:${matchToken}`,
            matchToken,
        }, alphaToken, '203.0.113.21'), duplicate.res);
        assert.equal(duplicate.out.statusCode, 200);
        assert.equal(duplicate.out.body?.outcome, 'win');
        const afterDuplicate = await kv.get<Record<string, unknown>>(`legacy:stats:${alpha}`);
        assert.equal(afterDuplicate?.petDuelWins, 1, 'the stable Legacy receipt prevents a double grant');
        for (const slug of [alpha, omega]) {
            const save = await kv.get<Record<string, unknown>>(`save:${slug}`);
            assert.equal(Number(save?._saveVersion), 2, 'replay never reapplies either participant rating');
        }
    } finally {
        kv.set = originalSet;
        Date.now = realDateNow;
        if (previousLegacyFlag === undefined) delete process.env.ENABLE_LEGACY;
        else process.env.ENABLE_LEGACY = previousLegacyFlag;
    }
});

test('ranked settlement keeps its proof and writes neither participant when one authoritative save is missing', async () => {
    const missingOpponent = 'petauthoritymissing';
    const pet = {
        id: 'missing-rival-pet', name: 'Missing Rival Pet', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 300, attack: 55, defense: 45, speed: 33, unlockedForPve: true,
        jutsus: [{ name: 'Strike', power: 50, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
    await kv.set(`save:${missingOpponent}`, {
        _saveVersion: 1,
        character: { name: missingOpponent, level: 1, activePetId: pet.id, pets: [pet] },
    });

    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 300_000;
    let matchToken = '';
    try {
        const started = response();
        await authorizeRankedQueuePair(PLAYER, missingOpponent);
        await rankedStartHandler(request({ opponentName: missingOpponent, petId: 'owned-pet' }), started.res);
        assert.equal(started.out.statusCode, 200);
        matchToken = String(started.out.body?.matchToken ?? '');
        const playerBefore = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);

        await kv.del(`save:${missingOpponent}`);
        Date.now = () => realDateNow() + 306_000;
        const failed = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'win',
            ranked: true,
            reportKey: `ranked:${matchToken}`,
            matchToken,
        }), failed.res);

        assert.equal(failed.out.statusCode, 503);
        assert.ok(await kv.get(`pet:ranked-token:${matchToken}`), 'retryable proof must remain live');
        assert.equal(await kv.get(`pet:ranked-result:${matchToken}`), null, 'no final receipt may exist before both saves settle');
        const playerAfter = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
        assert.equal(playerAfter?._saveVersion, playerBefore?._saveVersion, 'preflight must prevent one-sided settlement');
    } finally {
        Date.now = realDateNow;
        if (matchToken) {
            await Promise.all([
                kv.del(`pet:ranked-token:${matchToken}`),
                kv.del(`pet:ranked-result:${matchToken}`),
            ]);
        }
    }
});

test('durable ranked intent heals a second-save win failure after the live proof expires', async () => {
    const alpha = 'rankedpartialwinalpha';
    const bravo = 'rankedpartialwinbravo';
    const matchToken = '00000000-0000-4000-8000-000000910001';
    const pairId = '00000000-0000-4000-8000-000000910002';
    const alphaPet = {
        id: 'partial-win-alpha-pet', name: 'Alpha', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 5_000, attack: 1_000, defense: 1_000, speed: 1_000,
        jutsus: [{ name: 'Verdict', power: 1_000, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
    const bravoPet = {
        id: 'partial-win-bravo-pet', name: 'Bravo', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 1, attack: 1, defense: 1, speed: 1,
        jutsus: [{ name: 'Tap', power: 1, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
    const { runPetDuel } = await import('../_pet-sim/pet-duel-sim.js');
    assert.equal(runPetDuel(alphaPet as never, bravoPet as never, 73, 1, 1, false).result, 'win');
    const auth = await import('../_auth.js');
    const alphaToken = auth.issuePlayerToken(alpha)!;
    const bravoToken = auth.issuePlayerToken(bravo)!;
    for (const [name, pet] of [[alpha, alphaPet], [bravo, bravoPet]] as const) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: { name, level: 20, petRankedRating: 1000, activePetId: pet.id, pets: [pet] },
        });
    }

    const realNow = Date.now;
    const originalSet = kv.set;
    const baseNow = realNow() + 1_200_000;
    Date.now = () => baseNow;
    const proof = {
        authority: 'pet-ranked-queue-v1', pairId,
        a: alpha, b: bravo, aRating: 1000, bRating: 1000,
        aPet: alphaPet, bPet: bravoPet, seed: 73, createdAt: baseNow,
    };
    await kv.set(`pet:ranked-token:${matchToken}`, proof, { ex: 15 * 60 });
    try {
        let failBravoOnce = true;
        kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (key === `save:${bravo}` && failBravoOnce) {
                failBravoOnce = false;
                throw new Error('injected second participant save failure');
            }
            return originalSet(key, value, options);
        };
        Date.now = () => baseNow + 6_000;
        const failed = response();
        await resultHandler(request({
            playerName: alpha, outcome: 'loss', ranked: true,
            reportKey: `ranked:${matchToken}`, matchToken,
        }, alphaToken, '203.0.113.31'), failed.res);
        assert.equal(failed.out.statusCode, 503);
        assert.ok(await kv.get(`pet:ranked-intent:${matchToken}`), 'write-ahead pair authority must precede the first save');
        const alphaAfterFailure = await kv.get<Record<string, unknown>>(`save:${alpha}`);
        const bravoAfterFailure = await kv.get<Record<string, unknown>>(`save:${bravo}`);
        assert.ok(rankedLedgerEntry(alphaAfterFailure?.character as Record<string, unknown>, matchToken));
        assert.equal(rankedLedgerEntry(bravoAfterFailure?.character as Record<string, unknown>, matchToken), undefined);
        assert.equal(await kv.get(`pet:ranked-result:${matchToken}`), null);
        kv.set = originalSet;

        Date.now = () => baseNow + (16 * 60 * 1_000);
        assert.equal(await kv.get(`pet:ranked-token:${matchToken}`), null, 'the short live proof genuinely expired');
        const repaired = response();
        await resultHandler(request({
            playerName: bravo, outcome: 'win', ranked: true,
            reportKey: `ranked:${matchToken}`, matchToken,
        }, bravoToken, '203.0.113.32'), repaired.res);
        assert.equal(repaired.out.statusCode, 200);
        assert.equal(repaired.out.body?.outcome, 'loss');
        for (const name of [alpha, bravo]) {
            const save = await kv.get<Record<string, unknown>>(`save:${name}`);
            assert.equal(save?._saveVersion, 2, `${name} settles exactly once`);
            assert.ok(rankedLedgerEntry(save?.character as Record<string, unknown>, matchToken));
        }
        assert.ok(await kv.get(`pet:ranked-result:${matchToken}`));
        assert.equal(await kv.get(`pet:ranked-intent:${matchToken}`), null);
    } finally {
        kv.set = originalSet;
        Date.now = realNow;
        await Promise.all([
            kv.del(`pet:ranked-token:${matchToken}`),
            kv.del(`pet:ranked-result:${matchToken}`),
            kv.del(`pet:ranked-intent:${matchToken}`),
        ]);
    }
});

test('durable ranked intent heals a second-save draw failure after the live proof expires', async () => {
    const alpha = 'rankedpartialdrawalpha';
    const bravo = 'rankedpartialdrawbravo';
    const matchToken = '00000000-0000-4000-8000-000000920001';
    const pairId = '00000000-0000-4000-8000-000000920002';
    const drawPet = (id: string) => ({
        id, name: id, rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 1_000_000_000, attack: 0, defense: 1_000_000_000, speed: 1, jutsus: [],
    });
    const alphaPet = drawPet('partial-draw-alpha-pet');
    const bravoPet = drawPet('partial-draw-bravo-pet');
    const { runPetDuel } = await import('../_pet-sim/pet-duel-sim.js');
    assert.equal(runPetDuel(alphaPet as never, bravoPet as never, 1, 1, 1, false).result, 'draw');
    const auth = await import('../_auth.js');
    const alphaToken = auth.issuePlayerToken(alpha)!;
    const bravoToken = auth.issuePlayerToken(bravo)!;
    for (const [name, pet] of [[alpha, alphaPet], [bravo, bravoPet]] as const) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: { name, level: 20, petRankedRating: 1000, activePetId: pet.id, pets: [pet] },
        });
    }

    const realNow = Date.now;
    const originalSet = kv.set;
    const baseNow = realNow() + 2_400_000;
    Date.now = () => baseNow;
    const proof = {
        authority: 'pet-ranked-queue-v1', pairId,
        a: alpha, b: bravo, aRating: 1000, bRating: 1000,
        aPet: alphaPet, bPet: bravoPet, seed: 1, createdAt: baseNow,
    };
    await kv.set(`pet:ranked-token:${matchToken}`, proof, { ex: 15 * 60 });
    try {
        let failBravoOnce = true;
        kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (key === `save:${bravo}` && failBravoOnce) {
                failBravoOnce = false;
                throw new Error('injected draw second participant save failure');
            }
            return originalSet(key, value, options);
        };
        Date.now = () => baseNow + 6_000;
        const failed = response();
        await resultHandler(request({
            playerName: alpha, outcome: 'win', ranked: true,
            reportKey: `ranked:${matchToken}`, matchToken,
        }, alphaToken, '203.0.113.41'), failed.res);
        assert.equal(failed.out.statusCode, 503);
        assert.ok(await kv.get(`pet:ranked-intent:${matchToken}`));
        const alphaAfterFailure = await kv.get<Record<string, unknown>>(`save:${alpha}`);
        const bravoAfterFailure = await kv.get<Record<string, unknown>>(`save:${bravo}`);
        assert.ok(rankedLedgerEntry(alphaAfterFailure?.character as Record<string, unknown>, matchToken));
        assert.equal(rankedLedgerEntry(bravoAfterFailure?.character as Record<string, unknown>, matchToken), undefined);
        assert.equal(await kv.get(`pet:ranked-result:${matchToken}`), null);
        kv.set = originalSet;

        Date.now = () => baseNow + (16 * 60 * 1_000);
        assert.equal(await kv.get(`pet:ranked-token:${matchToken}`), null);
        const repaired = response();
        await resultHandler(request({
            playerName: bravo, outcome: 'loss', ranked: true,
            reportKey: `ranked:${matchToken}`, matchToken,
        }, bravoToken, '203.0.113.42'), repaired.res);
        assert.equal(repaired.out.statusCode, 200);
        assert.equal(repaired.out.body?.outcome, 'draw');
        for (const name of [alpha, bravo]) {
            const save = await kv.get<Record<string, unknown>>(`save:${name}`);
            const character = save?.character as Record<string, unknown>;
            assert.equal(save?._saveVersion, 2, `${name} draw settles exactly once`);
            assert.equal(character.petRankedRating, 1000, 'draw does not move rating');
            assert.ok(rankedLedgerEntry(character, matchToken));
        }
        assert.ok(await kv.get(`pet:ranked-result:${matchToken}`));
        assert.equal(await kv.get(`pet:ranked-intent:${matchToken}`), null);
    } finally {
        kv.set = originalSet;
        Date.now = realNow;
        await Promise.all([
            kv.del(`pet:ranked-token:${matchToken}`),
            kv.del(`pet:ranked-result:${matchToken}`),
            kv.del(`pet:ranked-intent:${matchToken}`),
        ]);
    }
});
