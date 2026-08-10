import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pet } from '../_pet-sim/pet-types.js';
import { scoutedWarfrontDoctrine } from '../_pet-sim/pet-warfront-sim.js';
import { buildProgressionWarfrontAiTeam, warfrontAiWarband } from './_warfront-ai.js';
import { isWarfrontRewardEligible, settleCasualPetConsumables } from './battle-result.js';
import {
    authorizedWarfrontResponse,
    isRecoverableWarfrontAuthorization,
    preparedWarfrontResponse,
    scoutedWarfrontDoctrineOptions,
    sealWarfrontSlot,
    warfrontAiTacticalSetup,
    warfrontAuthorizationFingerprint,
    type PreparedWarfrontGrant,
    type SealedManualWarfront,
    type SealedWarfrontSlot,
    type WarfrontStartAuthorization,
} from './warfront-start.js';
import { DEFAULT_WARFRONT_AUTHORED_SETUP } from './_warfront-setup.js';
import {
    appendManualWarfrontRound,
    finalizeManualWarfrontAttemptState,
    parseManualWarfrontAttempt,
} from './_warfront-council.js';

test('Warfront settlement preserves selected loadout consumables the sim never applies', () => {
    const pets = [
        { id: 'selected', loadout: { collar: 'glow', consumable: 'battle-tonic' } },
        { id: 'reserve', loadout: { consumable: 'smoke-pill' } },
    ];
    const warfront = settleCasualPetConsumables(pets, ['selected'], 'warfront');
    assert.strictEqual(warfront, pets, 'Warfront must not rewrite the roster or consume an unused item');
    assert.equal((warfront[0].loadout as Record<string, unknown>).consumable, 'battle-tonic');

    const duel = settleCasualPetConsumables(pets, ['selected'], 'arena');
    assert.equal((duel[0].loadout as Record<string, unknown>).consumable, undefined,
        'ordinary pet battles retain their existing single-use settlement');
    assert.equal((duel[1].loadout as Record<string, unknown>).consumable, 'smoke-pill');
});

test('prepare reveals opaque partial doctrine intel; authorization reveals exact doctrine and seed after commitment', () => {
    const prepared: PreparedWarfrontGrant = {
        version: 1,
        playerName: 'Kakashi',
        seed: 424242,
        prepareToken: 'abcdef0123456789abcdef0123456789',
        createdAt: 1_800_000_000_000,
    };
    const preview = preparedWarfrontResponse(prepared);
    assert.equal('seed' in preview, false);
    assert.equal('reportKey' in preview, false);
    assert.equal('scoutedDoctrine' in preview, false);
    assert.deepEqual(preview.scoutedDoctrineOptions, scoutedWarfrontDoctrineOptions(prepared.seed));
    assert.equal(new Set(preview.scoutedDoctrineOptions).size, 2);
    assert.ok(preview.scoutedDoctrineOptions.includes(scoutedWarfrontDoctrine(prepared.seed, 'red') as 'vanguard' | 'bulwark' | 'zealot'));
    assert.deepEqual(preview.scoutedWarband, warfrontAiWarband(prepared.seed));

    const blue = sealedSlots('authorized-blue');
    const scaledOpponent = buildProgressionWarfrontAiTeam(
        4,
        prepared.seed,
        blue.map((slot) => slot.pet as unknown as Pet),
    );
    const red = scaledOpponent.pets.map((pet) => sealWarfrontSlot({ pet, role: pet.role! }));
    const setup = { stance: 'balanced', doctrine: 'vanguard', buyPolicy: 'balanced', ...DEFAULT_WARFRONT_AUTHORED_SETUP } as const;
    const redSetup = warfrontAiTacticalSetup(prepared.seed);
    const authorization: WarfrontStartAuthorization = {
        playerName: prepared.playerName,
        seed: prepared.seed,
        prepareToken: prepared.prepareToken,
        reportKey: `${prepared.seed}:tactical`,
        fingerprint: warfrontAuthorizationFingerprint(
            prepared.prepareToken,
            blue.map((slot) => slot.pet.id),
            setup,
            warfrontAiWarband(prepared.seed),
            redSetup,
        ),
        token: '0123456789abcdef0123456789abcdef',
        manual: false,
        outcome: 'win',
        blue,
        red,
        warband: warfrontAiWarband(prepared.seed),
        difficulty: scaledOpponent.difficulty,
        setup,
        redSetup,
        createdAt: prepared.createdAt,
        notBefore: prepared.createdAt + 1,
    };
    const committed = authorizedWarfrontResponse(authorization, [], false);
    assert.equal(committed.seed, prepared.seed);
    assert.equal(committed.reportKey, `${prepared.seed}:tactical`);
    assert.equal(committed.scoutedDoctrine, scoutedWarfrontDoctrine(prepared.seed, 'red'));
    assert.deepEqual(committed.warband, warfrontAiWarband(prepared.seed));
    assert.equal(committed.rewardEligible, true);
    assert.equal(authorizedWarfrontResponse({
        ...authorization,
        manual: true,
        setup: { ...authorization.setup, buyPolicy: 'off' },
    }, [], false).rewardEligible, false,
    'the server discloses Manual as unranked on the committed authorization');
    assert.equal(isRecoverableWarfrontAuthorization(authorization, prepared.playerName, prepared.prepareToken), true,
        'the opaque grant recovers its original authorization without reconstructing a custom squad fingerprint');
    assert.equal(isRecoverableWarfrontAuthorization({
        ...authorization,
        setup: { ...authorization.setup, buildPackage: 'blood-hunt' },
    }, prepared.playerName, prepared.prepareToken), false, 'authored setup divergence invalidates the sealed fingerprint');
    assert.equal(isRecoverableWarfrontAuthorization({
        ...authorization,
        red: authorization.red.map((slot, index) => index === 0
            ? { ...slot, pet: { ...slot.pet, id: 'forged-red' } }
            : slot),
    }, prepared.playerName, prepared.prepareToken), false, 'recovery never reselects or accepts a divergent red roster');
    assert.equal(isRecoverableWarfrontAuthorization({
        ...authorization,
        manual: true,
    }, prepared.playerName, prepared.prepareToken), false, 'manual/Auto reward mode is sealed with buy policy and outcome');

    const source = readFileSync(join(process.cwd(), 'api', 'pet', 'warfront-start.ts'), 'utf8');
    const recoveryLookup = source.indexOf('const existingAuthorization = await kv.get<unknown>(authorizationKey)');
    const rosterLoad = source.indexOf('const mySave = await kv.get<Record<string, unknown>>');
    assert.ok(recoveryLookup >= 0 && rosterLoad > recoveryLookup,
        'refresh recovery must return the first token before roster/default changes can mint a second one');
});

test('deterministic Manual Council cannot reach outcome rewards but earns fixed Coach completion', () => {
    assert.equal(isWarfrontRewardEligible('warfront', true), false,
        'a revealed Manual seed must never authorize outcome rewards');
    assert.equal(isWarfrontRewardEligible('warfront', false), true,
        'server-complete Auto Council remains reward eligible');

    const source = readFileSync(join(process.cwd(), 'api', 'pet', 'battle-result.ts'), 'utf8');
    const manualGate = source.indexOf("if (casualMode === 'warfront' && !casualWarfrontRewardEligible)");
    const unrankedReceipt = source.indexOf('rewardEligible: false', manualGate);
    const coachReward = source.indexOf('warfrontBaseRyoReward(opponentLevel)', manualGate);
    const outcomeReward = source.indexOf('const baseReward = petArenaRyoReward', manualGate);
    assert.ok(manualGate >= 0 && coachReward > manualGate && unrankedReceipt > coachReward && outcomeReward > unrankedReceipt,
        'Manual must commit its capped fixed completion receipt and return before outcome reward calculation');
});

test('server-sealed rosters preserve authoritative visual identity without loadout or images', () => {
    const pet = {
        id: 'owned-1',
        name: 'Ember Cub',
        rarity: 'legendary',
        level: 30,
        xp: 0,
        maxLevel: 100,
        hp: 900,
        attack: 120,
        defense: 70,
        speed: 88,
        jutsus: [],
        unlockedForPve: true,
        element: 'Fire',
        templateId: 'starter-fire',
        evolutionStage: 2,
        paletteVariantId: 'cinder-gold',
        image: 'data:image/png;base64,not-in-token',
        loadout: { consumable: 'battle-tonic' },
    } satisfies Pet;
    const sealed = sealWarfrontSlot({ pet, role: 'assassin' });
    assert.deepEqual(sealed.pet, {
        id: pet.id,
        name: pet.name,
        rarity: pet.rarity,
        level: pet.level,
        hp: pet.hp,
        attack: pet.attack,
        defense: pet.defense,
        speed: pet.speed,
        element: pet.element,
        templateId: pet.templateId,
        evolutionStage: pet.evolutionStage,
        paletteVariantId: pet.paletteVariantId,
    });
    assert.equal('image' in sealed.pet, false);
    assert.equal('loadout' in sealed.pet, false);

    const source = readFileSync(join(process.cwd(), 'api', 'pet', 'warfront-start.ts'), 'utf8');
    assert.match(source, /const myPets = Array\.isArray\(myChar\?\.pets\)/,
        'visual identity must come from the authenticated save roster');
    assert.doesNotMatch(source, /body\.(templateId|evolutionStage|rarity|paletteVariantId)/,
        'the request body must never supply sealed visual identity');
});

test('server-only Warfront validation disables presentation snapshot capture', () => {
    const callers = [
        {
            path: ['api', 'pet', 'warfront-start.ts'],
            marker: 'const result = runWarfrontMatch(',
            reason: 'auto minting reads only winner and ticks',
        },
        {
            path: ['api', 'pet', 'battle-result.ts'],
            marker: 'const ctl = startWarfrontMatch(',
            reason: 'manual settlement reads only rounds, choiceLog, winner, and ticks',
        },
        {
            path: ['api', 'pet', '_warfront-council.ts'],
            marker: 'const ctl = startWarfrontMatch(',
            reason: 'Council validation reads only rounds and choiceLog',
        },
        {
            path: ['api', 'pet-ladder', '_core.ts'],
            marker: 'return runWarfrontMatch(',
            reason: 'ranked tactical resolution reads only the winner',
        },
    ] as const;

    for (const caller of callers) {
        const file = caller.path.join('/');
        const source = readFileSync(join(process.cwd(), ...caller.path), 'utf8');
        const callStart = source.indexOf(caller.marker);
        const callEnd = source.indexOf(';', callStart);
        assert.ok(callStart >= 0 && callEnd > callStart, `${file} must retain its Warfront simulation call`);
        assert.match(
            source.slice(callStart, callEnd + 2),
            /captureSnapshots:\s*false/,
            `${file}: ${caller.reason}`,
        );
        assert.doesNotMatch(
            source,
            /\.snapshots\b/,
            `${file} must not disable frames while consuming them later`,
        );
    }
});

const roles = ['defender', 'tracker', 'assassin', 'sage'] as const;
function sealedSlots(prefix: string): SealedWarfrontSlot[] {
    return roles.map((role, index) => ({
        role,
        pet: {
            id: `${prefix}-${index}`,
            name: `${prefix}${index}`,
            rarity: 'rare',
            level: 18,
            hp: 5_000,
            attack: 10,
            defense: 100,
            speed: 50,
            element: 'Earth',
        },
    }));
}

test('one token has one append-only Manual Council path across exploit attempts and reload retries', () => {
    const sealed: SealedManualWarfront = {
        version: 1,
        seed: 98765,
        blue: sealedSlots('blue'),
        red: sealedSlots('red'),
        options: {
            bluePolicy: 'off',
            redPolicy: 'balanced',
            blueStance: 'balanced',
            blueDoctrine: 'vanguard',
            adaptStances: true,
        },
    };
    const binding = { playerName: 'Kakashi', battleToken: 'token1234567890123456', reportKey: '98765:tactical' };
    const first = { round: 1, choices: [], stance: 'balanced' as const };
    const accepted = appendManualWarfrontRound(null, binding, sealed, first, 100);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;

    const retried = appendManualWarfrontRound(accepted.attempt, binding, sealed, first, 101);
    assert.equal(retried.ok && retried.idempotent, true, 'lost-response retry returns the same round without duplication');
    const branched = appendManualWarfrontRound(accepted.attempt, binding, sealed, { ...first, stance: 'siege' }, 102);
    assert.deepEqual(branched, { ok: false, code: 'path-conflict' }, 'a second branch at an accepted round is burned');
    const skipped = appendManualWarfrontRound(accepted.attempt, binding, sealed, { round: 3, choices: [], stance: 'balanced' }, 103);
    assert.deepEqual(skipped, { ok: false, code: 'round-order' });

    const second = appendManualWarfrontRound(accepted.attempt, binding, sealed, { round: 2, choices: [], stance: 'balanced' }, 104);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const recovered = parseManualWarfrontAttempt(JSON.parse(JSON.stringify(second.attempt)), binding.playerName, binding.battleToken, binding.reportKey);
    assert.deepEqual(recovered, second.attempt, 'reload recovery preserves the exact accepted prefix');

    const finalized = finalizeManualWarfrontAttemptState(second.attempt, binding, second.attempt.choices, 105);
    assert.equal(finalized.ok, true);
    if (!finalized.ok) return;
    const postFinal = appendManualWarfrontRound(finalized.attempt, binding, sealed, { round: 3, choices: [], stance: 'balanced' }, 106);
    assert.deepEqual(postFinal, { ok: false, code: 'path-finalized' });
    const changedFinal = finalizeManualWarfrontAttemptState(finalized.attempt, binding, [first], 107);
    assert.deepEqual(changedFinal, { ok: false, code: 'path-conflict' });
});

test('security-sensitive Warfront keys bypass the process-local read cache', () => {
    const source = readFileSync(join(process.cwd(), 'api', '_storage.ts'), 'utf8');
    for (const prefix of [
        'save:',
        'pet:warfront-prepared:',
        'pet:warfront-active:',
        'pet:warfront-authorization:',
        'pet:warfront-council:',
        'pet:battle-token:',
    ]) assert.match(source, new RegExp(`['\"]${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`));
});
