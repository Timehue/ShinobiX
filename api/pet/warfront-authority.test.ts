import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pet } from '../_pet-sim/pet-types.js';
import { derivePetRole } from '../_pet-sim/pet-roles.js';
import { WARFRONT_DEFAULT_DEPLOYMENT, isValidRitePlan, runWarfrontRite, type RitePlan } from '../_pet-sim/pet-warfront-rite.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-warfront-authority-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'warfrontauthorityprobe';
let authToken = '';
let startHandler: Handler;
let resultHandler: Handler;
let kv: typeof import('../_storage.js').kv;

function warfrontPet(index: number) {
    const elements = ['Water', 'Fire', 'Wind', 'Earth'] as const;
    return {
        id: `warfront-pet-${index}`, name: `Warfront Pet ${index}`, nickname: `Witness ${index}`,
        element: elements[index - 1], rarity: 'standard', level: 20,
        xp: 0, maxLevel: 100, hp: 10_000 + index, attack: 10_000, defense: 10_000, speed: 200,
        chronicleArenaWins: 9,
        image: `data:image/png;base64,portrait-${index}`,
        bodyImage: `data:image/png;base64,body-${index}`,
        unlockedForPve: true,
        jutsus: [{ name: 'Strike', power: 50, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
}

function winningWitnessPet(index: number) {
    return {
        ...warfrontPet(index),
        // This one test needs a deterministic win to exercise the Living
        // Witness reward path. A ranged one-shot avoids turning its authority
        // contract into a matchup or pathfinding test.
        hp: 100_000 + index,
        attack: 1_000_000,
        defense: 100_000,
        jutsus: [{ name: 'Witness Bolt', power: 10_000, cooldown: 1, currentCooldown: 0, kind: 'burn' }],
    };
}

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

function request(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': authToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    authToken = auth.issuePlayerToken(PLAYER)!;
    startHandler = (await import('./warfront-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER,
            village: 'Leaf Village',
            level: 20,
            ryo: 0,
            professionRank: 0,
            starterCardsClaimed: true,
            tileCards: [],
            activePetId: 'warfront-pet-1',
            pets: [1, 2, 3, 4].map(warfrontPet),
        },
    });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('Warfront authority rejects undersized and expedition-busy rosters', async () => {
    for (const size of [1, 2, 3]) {
        const rejected = response();
        await startHandler(request({
            playerName: PLAYER,
            playerPetIds: Array.from({ length: size }, (_, index) => `warfront-pet-${index + 1}`),
        }), rejected.res);
        assert.equal(rejected.out.statusCode, 400, `${size}-pet roster must not mint a reward seal`);
    }

    const save = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    assert.ok(save);
    const character = save?.character as Record<string, unknown>;
    const pets = character.pets as Array<Record<string, unknown>>;
    await kv.set(`save:${PLAYER}`, {
        ...save,
        character: {
            ...character,
            pets: pets.map((pet, index) => index === 0
                ? { ...pet, expedition: { endsAt: Date.now() + 60_000 } }
                : pet),
        },
    });
    const busy = response();
    await startHandler(request({
        playerName: PLAYER,
        playerPetIds: [1, 2, 3, 4].map((index) => `warfront-pet-${index}`),
    }), busy.res);
    assert.equal(busy.out.statusCode, 409);

    await kv.set(`save:${PLAYER}`, { ...save, character });
});

test('Warfront start CAS-clears an active pointer whose proof is missing', async () => {
    await kv.set(`pet:battle-active:${PLAYER}`, 'missing-warfront-proof');
    const rejected = response();
    await startHandler(request({ playerName: PLAYER, playerPetIds: [] }), rejected.res);
    assert.equal(rejected.out.statusCode, 400);
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
});

test('a resume-only Warfront probe ignores an unrelated active battle without weakening the start lock', async () => {
    const token = 'active-colosseum-proof';
    const activeKey = `pet:battle-active:${PLAYER}`;
    const tokenKey = `pet:battle-token:${PLAYER}:${token}`;
    await kv.set(tokenKey, { mode: '1v1', reportKey: 'colosseum-result' });
    await kv.set(activeKey, token);

    try {
        const probe = response();
        await startHandler(request({ playerName: PLAYER, resumeOnly: true }), probe.res);
        assert.equal(probe.out.statusCode, 204, 'another battle mode is not a broken Warfront recovery');
        assert.equal(await kv.get(activeKey), token, 'the read-only probe must not disturb the active battle lease');
        assert.ok(await kv.get(tokenKey), 'the read-only probe must not retire another mode\'s proof');

        const start = response();
        await startHandler(request({
            playerName: PLAYER,
            playerPetIds: [1, 2, 3, 4].map((index) => `warfront-pet-${index}`),
        }), start.res);
        assert.equal(start.out.statusCode, 409, 'an actual Warfront start remains blocked by the active battle');
        assert.equal(start.out.body?.error, 'Finish or settle your active Pet Colosseum battle first.');
        assert.equal(await kv.get(activeKey), token);

        await kv.set(tokenKey, { mode: 'warfront', reportKey: 'malformed-warfront-result' });
        const malformedWarfront = response();
        await startHandler(request({ playerName: PLAYER, resumeOnly: true }), malformedWarfront.res);
        assert.equal(malformedWarfront.out.statusCode, 409, 'a malformed Warfront proof must not masquerade as no active Warfront');
        assert.equal(malformedWarfront.out.body?.error, 'Finish or settle your active Pet Colosseum battle first.');
        assert.equal(await kv.get(activeKey), token, 'the malformed proof remains fail-closed for explicit recovery');
    } finally {
        await kv.del(tokenKey);
        await kv.delIfEqual(activeKey, token);
    }
});

test('Warfront start mints its own resumable seed and a battle-result-compatible reward seal', async (t) => {
    const originalSave = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    assert.ok(originalSave);
    t.after(async () => { await kv.set(`save:${PLAYER}`, originalSave); });
    const originalCharacter = originalSave.character as Record<string, unknown>;
    await kv.set(`save:${PLAYER}`, {
        ...originalSave,
        character: { ...originalCharacter, pets: [1, 2, 3, 4].map(winningWitnessPet) },
    });
    const startBody = {
        playerName: PLAYER,
        playerPetIds: [1, 2, 3, 4].map((index) => `warfront-pet-${index}`),
        // These attacker-controlled legacy fields must be ignored.
        seed: 0,
        reportKey: 'forged-report-key',
        stance: 'balanced',
        doctrine: 'none',
        buyPolicy: 'balanced',
    };
    const started = response();
    const concurrent = response();
    const crashedToken = 'crashed-provisional-warfront';
    await kv.set(`pet:battle-token:${PLAYER}:${crashedToken}`, {
        mode: 'warfront-initializing',
        createdAt: Date.now() - 121_000,
    });
    await kv.set(`pet:battle-active:${PLAYER}`, crashedToken);
    await Promise.all([
        startHandler(request(startBody), started.res),
        startHandler(request(startBody), concurrent.res),
    ]);
    assert.equal(started.out.statusCode, 200);
    assert.equal(concurrent.out.statusCode, 200);
    assert.equal(concurrent.out.body?.token, started.out.body?.token);
    assert.equal(concurrent.out.body?.seed, started.out.body?.seed);
    assert.equal(concurrent.out.body?.reportKey, started.out.body?.reportKey);
    assert.equal(
        [started.out.body?.resumed, concurrent.out.body?.resumed].filter(Boolean).length,
        1,
        'one concurrent request initializes and the other resumes its exact seal',
    );
    assert.equal(await kv.get(`pet:battle-token:${PLAYER}:${crashedToken}`), null, 'a crashed provisional seal is retired after its bounded lease');
    assert.equal(await kv.get(`pet:warfront-initializing:${PLAYER}`), null, 'the owner safely releases its initialization lease');

    const token = String(started.out.body?.token ?? '');
    const seed = Number(started.out.body?.seed);
    const reportKey = String(started.out.body?.reportKey ?? '');
    assert.match(token, /^[0-9a-f]{32}$/i);
    assert.ok(Number.isSafeInteger(seed) && seed > 0, 'the server must mint a positive seed');
    assert.equal(reportKey, `${seed}:tactical`);
    assert.notEqual(reportKey, startBody.reportKey);
    assert.equal(started.out.body?.outcome, undefined, 'the start response must not reveal the scored result');
    assert.equal(started.out.body?.opponentStance, 'balanced');
    assert.equal(started.out.body?.opponentDoctrine, 'vanguard');
    assert.equal(started.out.body?.opponentBuyPolicy, 'balanced');
    assert.equal(started.out.body?.stance, 'balanced');
    assert.equal(started.out.body?.doctrine, 'none');
    assert.equal(started.out.body?.buyPolicy, 'balanced');
    assert.equal(started.out.body?.theme, 'forest', 'the server must derive and seal the gameplay hazard theme from the saved village');
    assert.ok(Number(started.out.body?.safePlaybackForMs) >= Number(started.out.body?.matchDurationMs) + 10 * 60_000);
    assert.ok(Number(started.out.body?.safePlaybackForMs) > 29 * 60_000, 'fresh proofs retain a background-tab-safe thirty-minute budget');
    const responseBlue = started.out.body?.bluePets as Array<Record<string, unknown>>;
    const responseRed = started.out.body?.redPets as Array<Record<string, unknown>>;
    assert.equal(responseBlue.length, 4);
    assert.equal(responseRed.length, 4);
    assert.deepEqual(responseBlue.map((pet) => pet.id), startBody.playerPetIds);
    assert.ok(responseBlue.every((pet) => !('image' in pet) && !('bodyImage' in pet)), 'authority response must omit unbounded inline art');
    assert.ok(responseRed.every((pet) => !('image' in pet) && !('bodyImage' in pet)), 'sealed rivals must omit unbounded inline art');

    const seal = await kv.get<Record<string, unknown>>(`pet:battle-token:${PLAYER}:${token}`);
    assert.equal(seal?.settlementPolicy, 'warfront-reward', 'Warfront remains an explicit non-Coliseum reward authority');
    assert.equal(seal?.seed, seed);
    assert.equal(seal?.reportKey, reportKey);
    assert.equal(seal?.theme, 'forest');
    assert.equal(seal?.opponentStance, 'balanced');
    assert.equal(seal?.opponentDoctrine, 'vanguard');
    assert.equal(seal?.opponentBuyPolicy, 'balanced');
    const sealedBlue = seal?.bluePets as Array<Record<string, unknown>>;
    const sealedRed = seal?.redPets as Array<Record<string, unknown>>;
    assert.ok(sealedBlue.every((pet) => !('image' in pet) && !('bodyImage' in pet)), 'stored proof must remain bounded');
    assert.deepEqual(sealedRed, responseRed, 'the rendered rival squad must be the exact stored authority snapshot');
    const rewardRyo = Number(seal?.rewardRyo);
    assert.ok(Number.isSafeInteger(rewardRyo) && rewardRyo >= 20 && rewardRyo <= 250);
    const settleAfter = Number(seal?.settleAfter);
    const playbackStartedAt = Number(seal?.playbackStartedAt);
    const authorityBand = (pets: Array<Record<string, unknown>>) => pets as unknown as Pet[];
    const expectedBaseline = runWarfrontRite(
        authorityBand(sealedBlue), authorityBand(sealedRed), seed,
    );
    assert.equal(seal?.authoritativeOutcome, expectedBaseline.winner === 'blue' ? 'win' : expectedBaseline.winner === 'red' ? 'loss' : 'draw');
    assert.equal(Number(seal?.matchDurationMs), Math.ceil(expectedBaseline.totalSeconds * 1_000), 'the sealed clock must come from the same duel chain the player watches');
    assert.ok(Number.isSafeInteger(settleAfter) && settleAfter > Date.now() + 50_000);
    assert.ok(Number.isSafeInteger(playbackStartedAt) && playbackStartedAt > 0 && playbackStartedAt < settleAfter);

    const saveBeforeRecovery = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    assert.ok(saveBeforeRecovery);
    const recoveryCharacter = saveBeforeRecovery?.character as Record<string, unknown>;
    await kv.set(`save:${PLAYER}`, {
        ...saveBeforeRecovery,
        character: { ...recoveryCharacter, pets: [] },
    });
    const resumed = response();
    await startHandler(request({
        playerName: PLAYER,
        playerPetIds: [],
        resumeOnly: true,
        stance: 'siege',
        doctrine: 'bulwark',
        buyPolicy: 'offense',
    }), resumed.res);
    assert.equal(resumed.out.statusCode, 200);
    assert.equal(resumed.out.body?.resumed, true);
    assert.equal(resumed.out.body?.token, token);
    assert.equal(resumed.out.body?.seed, seed);
    assert.equal(resumed.out.body?.stance, 'balanced', 'resume must return its sealed config, not reload defaults');
    assert.equal(resumed.out.body?.theme, 'forest', 'resume must preserve the original hazard authority');
    assert.deepEqual((resumed.out.body?.bluePets as Array<Record<string, unknown>>).map((pet) => pet.id), startBody.playerPetIds);
    assert.equal(resumed.out.body?.outcome, undefined);
    await kv.set(`save:${PLAYER}`, saveBeforeRecovery);

    // A second tab may evolve or rename a pet while this long match is
    // playing. Settlement must preserve that current save state while using
    // kickoff provenance for the Living Witness deed.
    const mutableSave = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    const mutableCharacter = mutableSave?.character as Record<string, unknown>;
    const mutablePets = mutableCharacter.pets as Array<Record<string, unknown>>;
    await kv.set(`save:${PLAYER}`, {
        ...mutableSave,
        character: {
            ...mutableCharacter,
            pets: mutablePets.map((pet) => ({ ...pet, nickname: 'Later Name', element: 'Lightning' })),
        },
    });

    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6_000;
    try {
        const early = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'win',
            reportKey,
            battleToken: token,
        }), early.res);
        assert.equal(early.out.statusCode, 425, 'an instant loss/discard must not unlock a fresh seed');
        assert.ok(await kv.get(`pet:battle-token:${PLAYER}:${token}`));
        assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), token);

        Date.now = () => settleAfter + 1;
        const settled = response();
        const submittedPlan = { formation: [2, 0, 3, 1], reformAfterClash: null, reform: null };
        const expectedCommanded = runWarfrontRite(
            authorityBand(sealedBlue), authorityBand(sealedRed), seed, submittedPlan,
        );
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'loss', // deliberately forged; the server replay owns this value
            reportKey,
            battleToken: token,
            warfrontPlan: submittedPlan,
        }), settled.res);
        assert.equal(settled.out.statusCode, 200);
        assert.equal(settled.out.body?.outcome, expectedCommanded.winner === 'blue' ? 'win' : expectedCommanded.winner === 'red' ? 'loss' : 'draw', 'settlement must replay the committed batting order');
        const sealedOutcome = String(seal?.authoritativeOutcome ?? 'draw');
        assert.equal(sealedOutcome, 'win', 'the authoritative fixture must reach its witness settlement path');
        assert.equal(Number(settled.out.body?.reward ?? 0) > 0, true, 'forged reported loss cannot override the authoritative three-lane replay');
        assert.deepEqual(new Set(settled.out.body?.chronicleCards as string[]), new Set([
            'pet-witness-water', 'pet-witness-fire', 'pet-witness-wind', 'pet-witness-earth',
        ]));
        const witnesses = settled.out.body?.witnessedPets as Array<Record<string, unknown>>;
        assert.deepEqual(witnesses.map((entry) => entry.petName), ['Witness 1', 'Witness 2', 'Witness 3', 'Witness 4']);
        const settledCharacter = settled.out.body?.character as Record<string, unknown>;
        const settledPets = settledCharacter.pets as Array<Record<string, unknown>>;
        assert.ok(settledPets.every((pet) => pet.nickname === 'Later Name'), 'current pet identity is not rolled back to the proof');
        assert.ok(settledPets.every((pet) => pet.chronicleArenaWins === 10));
        assert.equal(await kv.get(`pet:battle-token:${PLAYER}:${token}`), null);
        assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
    } finally {
        Date.now = realDateNow;
    }

    const emptyProbe = response();
    await startHandler(request({ playerName: PLAYER, resumeOnly: true }), emptyProbe.res);
    assert.equal(emptyProbe.out.statusCode, 204, 'a resume-only probe must never mint a new seed when no proof exists');
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
});

test('Warfront settlement follows the commanded formation replay and its authoritative clock floor', async () => {
    const roles = ['defender', 'tracker', 'assassin', 'sage'] as const;
    const bluePets = roles.map((role, index) => {
        const { image: _image, bodyImage: _bodyImage, ...pet } = warfrontPet(index + 1);
        return { ...pet, role } as Pet & { role: typeof role };
    });
    const redPets = roles.map((role, index) => {
        const { image: _image, bodyImage: _bodyImage, ...pet } = warfrontPet(index + 1);
        return {
            ...pet,
            id: `settlement-rival-${index + 1}`,
            name: `Settlement Rival ${index + 1}`,
            nickname: `Settlement Rival ${index + 1}`,
            role,
        } as Pet & { role: typeof role };
    });
    const replaySeed = 42;
    const baseline = runWarfrontRite(bluePets, redPets, replaySeed);
    // Select the slowest legal formation for this fixed roster. Beastbound Warfront
    // makes all ten deployment cells role-agnostic, so authority must replay the
    // exact committed cells rather than infer a default formation.
    const candidates: RitePlan[] = [
        [0, 1, 2, 3], [4, 5, 6, 7], [6, 7, 8, 9], [0, 3, 6, 9],
    ].flatMap((deployment) => [[0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0]].map((formation) => ({
        formation, deployment, reformAfterClash: null, reform: null, reformDeployment: null,
    })));
    const [slowestPlan, commanded] = candidates
        .map((plan) => [plan, runWarfrontRite(bluePets, redPets, replaySeed, plan)] as const)
        .sort((a, b) => b[1].totalSeconds - a[1].totalSeconds)[0];
    assert.notDeepEqual(
        commanded.clashes.map((clash) => clash.result.events),
        baseline.clashes.map((clash) => clash.result.events),
        'fixture must expose a meaningfully different commanded formation replay',
    );

    // This suite intentionally advances Date.now to settlement timestamps. Use
    // a monotonic logical window so the shared in-memory rate limiter cannot see
    // time move backwards when 4v4 fights finish inside the 60s settlement floor.
    const playbackStartedAt = Date.now() + 120_000;
    const baselineDurationMs = Math.ceil(baseline.totalSeconds * 1_000);
    const commandedDurationMs = Math.ceil(commanded.totalSeconds * 1_000);
    const settleAfter = playbackStartedAt + Math.max(60_000, baselineDurationMs - 5_000);
    const commandedSettleAfter = playbackStartedAt + Math.max(60_000, baselineDurationMs - 5_000, commandedDurationMs - 5_000);
    assert.ok(commandedSettleAfter >= settleAfter,
        'a commanded replay must never shorten the authoritative settlement clock');

    const token = 'slowercommandedwarfront';
    const reportKey = `${replaySeed}:tactical-clock-regression`;
    await kv.set(`pet:battle-token:${PLAYER}:${token}`, {
        playerName: PLAYER,
        reportKey,
        opponentLevel: 20,
        rewardRyo: 20,
        playerPetIds: bluePets.map((pet) => pet.id),
        bluePets,
        redPets,
        seed: replaySeed,
        buyPolicy: 'balanced',
        opponentBuyPolicy: 'balanced',
        stance: 'balanced',
        opponentStance: 'balanced',
        doctrine: 'none',
        opponentDoctrine: 'vanguard',
        authoritativeOutcome: baseline.winner === 'blue' ? 'win' : baseline.winner === 'red' ? 'loss' : 'draw',
        mode: 'warfront',
        settlementPolicy: 'warfront-reward',
        matchDurationMs: baselineDurationMs,
        playbackStartedAt,
        settleAfter,
    });
    await kv.set(`pet:battle-active:${PLAYER}`, token);

    const realDateNow = Date.now;
    Date.now = () => playbackStartedAt + 30_000;
    try {
        const early = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'win',
            reportKey,
            battleToken: token,
            warfrontPlan: slowestPlan,
        }), early.res);
        assert.equal(early.out.statusCode, 425,
            'a commanded route must not settle before the authoritative playback floor');
        assert.ok(Number(early.out.body?.retryAfterMs) > 0,
            'the early response must expose the remaining authoritative playback time');
        assert.notEqual(await kv.get(`pet:battle-token:${PLAYER}:${token}`), null,
            'an early tactical replay must remain retryable');

        Date.now = () => commandedSettleAfter + 1;
        const settled = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'win',
            reportKey,
            battleToken: token,
            warfrontPlan: slowestPlan,
        }), settled.res);
        assert.equal(settled.out.statusCode, 200, `the actual commanded replay should settle on its own clock: ${JSON.stringify(settled.out.body)}`);
        assert.equal(settled.out.body?.outcome, commanded.winner === 'blue' ? 'win' : commanded.winner === 'red' ? 'loss' : 'draw');
        assert.equal(await kv.get(`pet:battle-token:${PLAYER}:${token}`), null);
    } finally {
        Date.now = realDateNow;
        await kv.delIfEqual(`pet:battle-active:${PLAYER}`, token);
        await kv.del(`pet:battle-token:${PLAYER}:${token}`);
    }
});

test('a mid-match re-form is settled from the server\u2019s own replay of that plan', async () => {
    // The re-form is a SECOND path into reward authority: the client watches
    // clash one, takes the player's decision, and posts a plan carrying it. The
    // server must accept that plan, replay it, and pay from ITS winner — and a
    // forged outcome alongside it must still be ignored.
    const roles = ['defender', 'tracker', 'assassin', 'sage'] as const;
    const bluePets = roles.map((role, index) => {
        const { image: _image, bodyImage: _bodyImage, ...pet } = warfrontPet(index + 1);
        return { ...pet, role } as Pet & { role: typeof role };
    });
    const redPets = roles.map((role, index) => {
        const { image: _image, bodyImage: _bodyImage, ...pet } = warfrontPet(index + 1);
        return {
            ...pet, id: `reform-rival-${index + 1}`, name: `Reform Rival ${index + 1}`,
            nickname: `Reform Rival ${index + 1}`, role,
        } as Pet & { role: typeof role };
    });

    const seed = 1;
    const reformPlan: RitePlan = {
        formation: [0, 1, 2, 3], deployment: [...WARFRONT_DEFAULT_DEPLOYMENT],
        reformAfterClash: null, reform: null, reformDeployment: null,
        reforms: [{ afterClash: 0, formation: [0, 1, 2, 3], deployment: [5, 4, 7, 8] }],
    };
    assert.ok(isValidRitePlan(reformPlan), 'authority fixture itself must be a legal one-pet re-form');
    const baseline = runWarfrontRite(bluePets, redPets, seed);
    const commanded = runWarfrontRite(bluePets, redPets, seed, reformPlan);

    // The client shows clash one BEFORE the player re-forms, then recomputes the
    // match around their answer. If a re-form could disturb that clash, the
    // player would settle a different fight than the one they watched.
    const opening = runWarfrontRite(bluePets, redPets, seed, {
        formation: [0, 1, 2, 3], deployment: [...WARFRONT_DEFAULT_DEPLOYMENT],
        reformAfterClash: null, reform: null, reformDeployment: null,
    });
    assert.deepEqual(commanded.clashes[0], opening.clashes[0], 'the re-form disturbed the clash already played');
    assert.deepEqual(
        Array.from({ length: 4 }, (_, slot) => commanded.clashes[1].blue.find((entry) => entry.slot === slot)?.node),
        [5, 4, 7, 8],
        'the server fixture did not actually apply its legal re-form',
    );
    assert.notEqual(commanded.winner, opening.winner, 'fixture must expose a settlement-changing re-form');

    const playbackStartedAt = Date.now() + 240_000;
    const baselineDurationMs = Math.ceil(baseline.totalSeconds * 1_000);
    const settleAfter = playbackStartedAt + Math.max(60_000, baselineDurationMs - 5_000);
    const commandedSettleAfter = playbackStartedAt + Math.max(60_000, Math.ceil(commanded.totalSeconds * 1_000) - 5_000);

    const token = 'reformedwarfrontproof';
    const reportKey = `${seed}:tactical-reform`;
    await kv.set(`pet:battle-token:${PLAYER}:${token}`, {
        playerName: PLAYER, reportKey, opponentLevel: 20, rewardRyo: 20,
        playerPetIds: bluePets.map((pet) => pet.id), bluePets, redPets, seed,
        buyPolicy: 'balanced', opponentBuyPolicy: 'balanced',
        stance: 'balanced', opponentStance: 'balanced',
        doctrine: 'none', opponentDoctrine: 'vanguard',
        authoritativeOutcome: baseline.winner === 'blue' ? 'win' : baseline.winner === 'red' ? 'loss' : 'draw',
        mode: 'warfront', settlementPolicy: 'warfront-reward',
        matchDurationMs: baselineDurationMs, playbackStartedAt, settleAfter,
    });
    await kv.set(`pet:battle-active:${PLAYER}`, token);

    const realDateNow = Date.now;
    const settlementNow = Math.max(settleAfter, commandedSettleAfter) + 1;
    Date.now = () => settlementNow;
    try {
        const malformed = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: 'win',
            reportKey,
            battleToken: token,
            warfrontPlan: {
                ...reformPlan,
                reforms: [{ afterClash: 0, formation: [0, 1, 2, 3], deployment: [0, 0, 7, 8] }],
            },
        }), malformed.res);
        assert.equal(malformed.out.statusCode, 400, 'a present malformed transcript must not silently settle the baseline');
        assert.ok(await kv.get(`pet:battle-token:${PLAYER}:${token}`), 'invalid input must leave the proof retryable');

        Date.now = () => settlementNow + 6_000;
        const settled = response();
        await resultHandler(request({
            playerName: PLAYER,
            outcome: commanded.winner === 'blue' ? 'loss' : 'win',   // forged; the replay owns this
            reportKey,
            battleToken: token,
            warfrontPlan: reformPlan,
        }), settled.res);
        assert.equal(settled.out.statusCode, 200, `re-formed settlement failed: ${JSON.stringify(settled.out.body)}`);
        assert.equal(
            settled.out.body?.outcome,
            commanded.winner === 'blue' ? 'win' : commanded.winner === 'red' ? 'loss' : 'draw',
            'settlement must replay the RE-FORMED plan, not the sealed baseline and not the reported outcome',
        );
        assert.equal(await kv.get(`pet:battle-token:${PLAYER}:${token}`), null, 'the single-use proof must be spent');
    } finally {
        Date.now = realDateNow;
        await kv.delIfEqual(`pet:battle-active:${PLAYER}`, token);
        await kv.del(`pet:battle-token:${PLAYER}:${token}`);
    }
});
