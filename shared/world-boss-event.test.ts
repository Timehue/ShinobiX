import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    WORLD_BOSS_DEFINITIONS,
    WORLD_BOSS_EVENT_HOP_MS,
    WORLD_BOSS_EVENT_ROAM_MS,
    WORLD_BOSS_HOLLOW_SHARDS_PER_TIER,
    WORLD_BOSS_MAX_WEAKENING_TIERS,
    WORLD_BOSS_WEAKENING_PER_TIER,
    worldBossCrystalEffects,
    worldBossEventRoute,
    worldBossEventPosition,
    worldBossRoute,
} from './world-boss-event';
import { isPlayableWildSector, PLAYABLE_WILD_SECTOR_IDS, VILLAGE_OUTSKIRTS } from './sector-geo';
import { SECTOR_ROAD_PAIRS } from './sector-links';

test('every playable sector has a connected road route to every village gate', () => {
    for (const sector of PLAYABLE_WILD_SECTOR_IDS) {
        for (const [village, gate] of Object.entries(VILLAGE_OUTSKIRTS)) {
            const route = worldBossRoute(sector, village);
            assert(route, `missing route from ${sector} to ${village}`);
            assert.equal(route[0], sector);
            assert.equal(route.at(-1), gate);
            assert(route.every(isPlayableWildSector), `route enters a non-playable sector: ${route.join(' → ')}`);
            for (let index = 1; index < route.length; index += 1) {
                assert(SECTOR_ROAD_PAIRS.some(([a, b]) => (a === route[index - 1] && b === route[index])
                    || (b === route[index - 1] && a === route[index])), `route leaves the road graph: ${route.join(' → ')}`);
            }
        }
    }
    assert.equal(worldBossRoute(54, 'Stormveil Village'), null);
    assert.equal(worldBossRoute(42, 'Unknown Village'), null);
});

test('selected event itinerary roams the road network and reaches the chosen village near the end of the roam window', () => {
    const startedAt = 1_000_000;
    const targetVillage = 'Moonshadow Village';
    const shortest = worldBossRoute(42, targetVillage)!;
    const maxHops = Math.floor(WORLD_BOSS_EVENT_ROAM_MS / WORLD_BOSS_EVENT_HOP_MS);
    const route = worldBossEventRoute(42, targetVillage, 'selected-route', maxHops)!;
    assert.equal(route.length, maxHops + 1);
    assert(route.length > shortest.length + 100, 'the boss should keep roaming instead of reaching the gate in a few hours');
    assert.equal(route[0], 42);
    assert.equal(route.at(-1), VILLAGE_OUTSKIRTS[targetVillage]);
    assert(!route.slice(0, -1).includes(VILLAGE_OUTSKIRTS[targetVillage]), 'the boss should reach the gate only on its final route hop');
    assert(route.every(isPlayableWildSector));
    for (let index = 1; index < route.length; index += 1) {
        assert(SECTOR_ROAD_PAIRS.some(([a, b]) => (a === route[index - 1] && b === route[index])
            || (b === route[index - 1] && a === route[index])), `route leaves the road graph: ${route.join(' → ')}`);
    }
    const event = {
        eventId: 'selected-route',
        startedAt,
        roamEndsAt: startedAt + WORLD_BOSS_EVENT_ROAM_MS,
        endsAt: startedAt + 72 * 60 * 60 * 1000,
        spawnSector: 42,
        targetVillage,
    };

    const start = worldBossEventPosition(event, startedAt)!;
    assert.equal(start.currentSector, 42);
    assert.equal(start.nextSector, route[1] ?? 42);
    assert.equal(start.targetSector, VILLAGE_OUTSKIRTS[targetVillage]);

    const hop = worldBossEventPosition(event, startedAt + WORLD_BOSS_EVENT_HOP_MS)!;
    assert.equal(hop.currentSector, route[1] ?? 42);

    const arrivalAt = startedAt + WORLD_BOSS_EVENT_HOP_MS * (route.length - 1);
    const arrival = worldBossEventPosition(event, arrivalAt)!;
    assert.equal(arrival.currentSector, VILLAGE_OUTSKIRTS[targetVillage]);
    assert.equal(arrival.destinationReached, true);
    assert.equal(arrival.nextHopInMs, 0);

    const finale = worldBossEventPosition(event, event.roamEndsAt)!;
    assert.equal(finale.currentSector, VILLAGE_OUTSKIRTS[targetVillage]);
    assert.equal(finale.destinationReached, true);
});

test('every admin-selectable spawn has a deterministic exact-length road itinerary to every village gate', () => {
    const hops = Math.floor(WORLD_BOSS_EVENT_ROAM_MS / WORLD_BOSS_EVENT_HOP_MS);
    for (const spawn of PLAYABLE_WILD_SECTOR_IDS) {
        for (const village of Object.keys(VILLAGE_OUTSKIRTS)) {
            const route = worldBossEventRoute(spawn, village, `${spawn}-${village}`, hops);
            assert(route, `missing paced route from ${spawn} to ${village}`);
            assert.equal(route.length, hops + 1);
            assert.equal(route[0], spawn);
            assert.equal(route.at(-1), VILLAGE_OUTSKIRTS[village]);
            assert(!route.slice(1, -1).includes(VILLAGE_OUTSKIRTS[village]), `route reaches ${village} early`);
            for (let index = 1; index < route.length; index += 1) {
                assert(SECTOR_ROAD_PAIRS.some(([a, b]) => (a === route[index - 1] && b === route[index])
                    || (b === route[index - 1] && a === route[index])), `route leaves the road graph: ${route.join(' → ')}`);
            }
        }
    }
});

test('an active matchmaking pause holds a selected route in its current sector', () => {
    const startedAt = 2_000_000;
    const event = {
        eventId: 'paused-selected-route',
        startedAt,
        roamEndsAt: startedAt + WORLD_BOSS_EVENT_ROAM_MS,
        endsAt: startedAt + 72 * 60 * 60 * 1000,
        spawnSector: 42,
        targetVillage: 'Frostfang Village',
        movementPausedAt: startedAt + WORLD_BOSS_EVENT_HOP_MS / 2,
        movementPausedTotalMs: 0,
    };
    const before = worldBossEventPosition(event, startedAt + WORLD_BOSS_EVENT_HOP_MS / 2)!;
    const held = worldBossEventPosition(event, startedAt + WORLD_BOSS_EVENT_HOP_MS * 2)!;
    assert.equal(held.currentSector, before.currentSector);
    assert.equal(held.movementPaused, true);
    const finalStand = worldBossEventPosition(event, event.roamEndsAt)!;
    assert.equal(finalStand.currentSector, VILLAGE_OUTSKIRTS[event.targetVillage]);
    assert.equal(finalStand.destinationReached, true);
});

test('the three world bosses have distinct defensive combat traits', () => {
    assert.deepEqual(new Set(WORLD_BOSS_DEFINITIONS.map(boss => boss.combatTrait)), new Set(['regen', 'bulwark', 'aegis']));
});

test('Hollow Shard tiers scale boss defense/offense in 5% steps and cap at 50%', () => {
    for (let tier = 0; tier <= WORLD_BOSS_MAX_WEAKENING_TIERS; tier += 1) {
        const effect = worldBossCrystalEffects(tier * WORLD_BOSS_HOLLOW_SHARDS_PER_TIER);
        const weakening = tier * WORLD_BOSS_WEAKENING_PER_TIER;
        assert.equal(effect.filledTiers, tier);
        assert.equal(effect.bossDamageDealtMultiplier, 1 - weakening);
        assert.equal(effect.bossDamageReceivedMultiplier, 1 + weakening);
    }
    assert.equal(worldBossCrystalEffects(10_000).depositedHollowShards, 60);
    assert.equal(worldBossCrystalEffects(60).bossDamageDealtMultiplier, 0.5);
    assert.equal(worldBossCrystalEffects(60).bossDamageReceivedMultiplier, 1.5);
});
