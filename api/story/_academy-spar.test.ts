import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TowerSession } from '../towers/_tower-session.js';
import {
    ACADEMY_SPAR_OPPONENT_ID,
    academySparEligibility,
    academySparRunId,
    createAcademySparBinding,
    validateCompletedAcademySparSession,
} from './_academy-spar.js';
import {
    createStoryCombatBinding,
    validateCompletedStoryCombatSession,
    type StoryCombatBinding,
} from './_authoritative-story-combat.js';
import { applyAcademySparSettlement } from './_settle.js';
import type { AiFightToken } from '../missions/_ai-fight-token.js';

/*
 * Step 5 of the AI-fight migration: the Academy spar's sealed channel.
 *
 * The two things worth testing are the two things that can pay a reward twice
 * or pay it to the wrong person: what the START will accept, and what the
 * SETTLE will accept. They are deliberately the same gate — a session the
 * settle would refuse must never have been opened, because /api/pve/fight-outcome
 * charges the player for a run whether or not it can be redeemed.
 */

const NOW = 1_700_000_000_000;

function makeCharacter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { name: 'Hero', village: 'Stormveil Village', level: 1, storyProgress: 0, onboardingStep: 'academySpar', ...overrides };
}

function makeBinding(overrides: Partial<StoryCombatBinding> = {}): StoryCombatBinding {
    return { ...createAcademySparBinding({ runId: 'spar-run-1', playerName: 'hero', now: NOW }), ...overrides };
}

function makeSession(overrides: Partial<TowerSession> = {}): TowerSession {
    return {
        runId: 'spar-run-1',
        status: 'done',
        winner: 'squad',
        actors: [
            { side: 'squad', ownerSlug: 'hero', hp: 88 } as unknown as TowerSession['actors'][number],
            { side: 'tower', ownerSlug: null, hp: 0 } as unknown as TowerSession['actors'][number],
        ],
        ...overrides,
    } as TowerSession;
}

function validate(params: {
    binding?: StoryCombatBinding | null;
    session?: TowerSession | null;
    playerName?: string;
    character?: Record<string, unknown>;
} = {}) {
    return validateCompletedAcademySparSession({
        binding: params.binding === undefined ? makeBinding() : params.binding,
        session: params.session === undefined ? makeSession() : params.session,
        playerName: params.playerName ?? 'hero',
        character: params.character ?? makeCharacter(),
        now: NOW + 1000,
    });
}

test('eligibility: the spar is startable exactly while it is owed', () => {
    assert.equal(academySparEligibility(makeCharacter()).ok, true);
    assert.equal(academySparEligibility(makeCharacter({ onboardingStep: 'spar' })).ok, true, 'the legacy step name still counts');
    assert.equal(academySparEligibility(makeCharacter({ onboardingStep: 'cafeteria' })).ok, false);
    assert.equal(academySparEligibility(makeCharacter({ academySparClaimed: true })).ok, false);
});

test('eligibility matches what the settlement demands, so a sealed spar is always redeemable', () => {
    // The pairing that matters: if these two ever disagree, a player opens a
    // fight, pays its HP cost through the outcome report, and cannot be paid.
    for (const overrides of [{}, { onboardingStep: 'spar' }, { onboardingStep: 'cafeteria' }, { academySparClaimed: true }]) {
        const character = makeCharacter(overrides);
        const startable = academySparEligibility(character).ok;
        const settleable = applyAcademySparSettlement(character, { opponentId: ACADEMY_SPAR_OPPONENT_ID } as AiFightToken).ok;
        assert.equal(startable, settleable, `start/settle disagree for ${JSON.stringify(overrides)}`);
    }
});

test('a completed winning spar run validates', () => {
    assert.equal(validate().ok, true);
});

test('a spar run is refused unless it was won, complete, unexpired and ours', () => {
    assert.equal(validate({ session: makeSession({ winner: 'enemy' }) }).ok, false, 'a loss must not settle');
    assert.equal(validate({ session: makeSession({ status: 'active' }) }).ok, false, 'an unfinished run must not settle');
    assert.equal(validate({ playerName: 'someone-else' }).ok, false, "another player's binding must not settle");
    assert.equal(validate({ session: null }).ok, false);
    assert.equal(validate({ binding: null }).ok, false);
    assert.equal(validate({ binding: makeBinding({ expiresAt: NOW - 1 }) }).ok, false, 'an expired binding must not settle');
    assert.equal(validate({ binding: makeBinding({ settledAt: NOW }) }).ok, false, 'a spent binding must not settle');
    assert.equal(
        validate({ session: makeSession({ actors: [{ side: 'squad', ownerSlug: 'someone-else', hp: 9 } as unknown as TowerSession['actors'][number]] }) }).ok,
        false,
        "a stranger's winning session must not settle onto our save",
    );
});

test('the spar re-checks the save at settle time, not just at start', () => {
    // A start-time-only gate would let two sessions opened back to back both pay.
    assert.equal(validate({ character: makeCharacter({ academySparClaimed: true }) }).ok, false);
    assert.equal(validate({ character: makeCharacter({ onboardingStep: 'cafeteria' }) }).ok, false);
});

test('spar and milestone bindings cannot be swapped', () => {
    const bossBinding = createStoryCombatBinding({ runId: 'spar-run-1', playerName: 'hero', village: 'Stormveil Village', progressIndex: 0, now: NOW });
    // A milestone binding cannot buy the spar reward...
    assert.equal(validate({ binding: bossBinding }).ok, false);
    // ...and a spar binding cannot buy a chapter reward, which is the expensive
    // direction (story milestones pay stat points, ryo, Aura Dust and a title).
    const asMilestone = validateCompletedStoryCombatSession({
        binding: makeBinding(),
        session: makeSession(),
        playerName: 'hero',
        character: makeCharacter(),
        now: NOW + 1000,
    });
    assert.equal(asMilestone.ok, false);
});

test('a spar binding carries no milestone and names the sealed dummy', () => {
    const binding = makeBinding();
    assert.equal(binding.kind, 'spar');
    assert.equal(binding.opponentId, ACADEMY_SPAR_OPPONENT_ID);
    assert.equal(binding.village, '', 'a spar has no village catalog row');
    assert.equal(binding.progressIndex, -1, 'a spar has no chapter');
    assert.equal(binding.rewardFingerprint, '', 'a spar has no reward-table row to fingerprint');
});

test('spar run ids are unique and namespaced', () => {
    const ids = new Set(Array.from({ length: 50 }, () => academySparRunId()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^spar-[0-9a-f]{32}$/);
});
