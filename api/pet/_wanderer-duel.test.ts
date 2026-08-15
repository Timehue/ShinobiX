import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWandererBeast, wandererTierFor, WANDERER_TIERS } from './_wanderer-duel.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';
import { petJutsuPowerCeil } from '../_pet-stat-ceil.js';

test('natural wanderer tiers are server-rostered and follow the saved-level thresholds', () => {
    for (const tier of WANDERER_TIERS) assert.ok(SERVER_ARENA_PETS[tier.petId]);
    assert.equal(wandererTierFor(1), 'generic-ai-pet-sparrow');
    assert.equal(wandererTierFor(19), 'generic-ai-pet-sparrow');
    assert.equal(wandererTierFor(20), 'generic-ai-pet-guardhound');
    assert.equal(wandererTierFor(44), 'generic-ai-pet-guardhound');
    assert.equal(wandererTierFor(45), 'generic-ai-pet-emberlynx');
    assert.equal(wandererTierFor(10_000), 'generic-ai-pet-emberlynx');
});

test('natural wanderer beast scaling is deterministic and bounded', () => {
    const low = buildWandererBeast(1);
    const high = buildWandererBeast(100);
    assert.ok(low && high);
    assert.deepEqual(buildWandererBeast(37), buildWandererBeast(37));
    assert.equal(low.level, 1);
    assert.equal(high.level, 100);
    const sparrow = SERVER_ARENA_PETS['generic-ai-pet-sparrow'];
    assert.ok(Number(low.hp) >= Math.round(Number(sparrow.hp) * 0.7) - 1);
    const emberlynx = SERVER_ARENA_PETS['generic-ai-pet-emberlynx'];
    assert.ok(Number(high.speed) <= Math.round(Number(emberlynx.speed) * 1.5));
    const ceiling = petJutsuPowerCeil(high.rarity);
    for (const [index, jutsu] of high.jutsus.entries()) {
        assert.ok(Number(jutsu.power) <= ceiling);
        assert.equal(jutsu.currentCooldown, 0);
        if (Number(emberlynx.jutsus[index]?.power) === 0) assert.equal(jutsu.power, 0);
    }
});
