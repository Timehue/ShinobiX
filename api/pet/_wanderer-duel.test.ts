/*
 * The sector wanderer beast — built by the SERVER, from the caller's own level.
 *
 * The client used to pick which of three arena templates the beast fielded and
 * scale it. The payout scales with the opponent fought, so "which tier" was a
 * client-chosen input to a reward. These pin that it no longer is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWandererBeast, wandererTierFor, WANDERER_TIERS } from './_wanderer-duel.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';
import { petJutsuPowerCeil } from '../_pet-stat-ceil.js';

test('every tier names a pet the server roster actually has', () => {
    // A tier that named an unknown id would field nothing and 409 the duel.
    for (const tier of WANDERER_TIERS) {
        assert.ok(SERVER_ARENA_PETS[tier.petId], `missing arena template: ${tier.petId}`);
    }
});

test('the tier comes from the level, at the same thresholds the World Map used', () => {
    // WorldMap.tsx: `< 20` sparrow, `< 45` guardhound, else emberlynx.
    assert.equal(wandererTierFor(1), 'generic-ai-pet-sparrow');
    assert.equal(wandererTierFor(19), 'generic-ai-pet-sparrow');
    assert.equal(wandererTierFor(20), 'generic-ai-pet-guardhound');
    assert.equal(wandererTierFor(44), 'generic-ai-pet-guardhound');
    assert.equal(wandererTierFor(45), 'generic-ai-pet-emberlynx');
    assert.equal(wandererTierFor(100), 'generic-ai-pet-emberlynx');
});

test('an out-of-range level cannot reach past its tier', () => {
    // The payout scales with the opponent fought, so a level that clamps UP
    // would be a way to buy a bigger purse with a junk number.
    assert.equal(wandererTierFor(0), 'generic-ai-pet-sparrow');
    assert.equal(wandererTierFor(-999), 'generic-ai-pet-sparrow');
    assert.equal(wandererTierFor(Number.NaN), 'generic-ai-pet-sparrow');
    assert.equal(wandererTierFor(10_000), 'generic-ai-pet-emberlynx');
});

test('the beast is scaled to the player and never below 0.7x or above 4x', () => {
    const low = buildWandererBeast(1);
    const high = buildWandererBeast(100);
    assert.ok(low && high);
    assert.equal(low!.level, 1);
    assert.equal(high!.level, 100);

    // Level 1 vs a level-8 template: the ratio is 0.125, so the 0.7 floor holds
    // and the beast stays a real fight rather than a stat-less pushover.
    const sparrow = SERVER_ARENA_PETS['generic-ai-pet-sparrow'];
    assert.ok(Number(low!.hp) >= Math.round(Number(sparrow.hp) * 0.7) - 1, 'floor holds');

    // Speed is held to 1.5x even when the rest scales further, so a scaled
    // beast cannot simply outrun everything it meets.
    const emberlynx = SERVER_ARENA_PETS['generic-ai-pet-emberlynx'];
    assert.ok(
        Number(high!.speed) <= Math.round(Number(emberlynx.speed) * 1.5),
        'speed is capped at 1.5x however far the rest scales',
    );
});

test('scaled jutsu power is clamped to the rarity ceiling and utility moves stay 0', () => {
    const beast = buildWandererBeast(100);
    assert.ok(beast);
    const ceiling = petJutsuPowerCeil(beast!.rarity);
    const base = SERVER_ARENA_PETS[wandererTierFor(100)];
    for (const [index, jutsu] of beast!.jutsus.entries()) {
        assert.ok(Number(jutsu.power) <= ceiling, `${jutsu.name} exceeds the rarity ceiling`);
        assert.equal(jutsu.currentCooldown, 0, 'a fresh beast has nothing on cooldown');
        if (Number(base.jutsus[index]?.power) === 0) {
            assert.equal(jutsu.power, 0, 'a utility move stays a utility move');
        }
    }
});

test('the same level always builds the same beast', () => {
    // Nothing here may read a clock or a random source: the fight is resolved
    // once at mint, and a beast that drifted between the build and the resolve
    // would be a different opponent than the one the reward was sealed from.
    assert.deepEqual(buildWandererBeast(37), buildWandererBeast(37));
});
