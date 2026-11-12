import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CINDERHOLD_SECTORS, VILLAGE_OUTSKIRTS } from './sector-geo';
import { rollNightWanderer, rollWanderers } from './wanderer-roster';
import { roadNemesisPresentIn } from './road-nemesis';
import { isWorldBossRoamSector, worldBossRoute } from './world-boss-event';
import { sectorExploreReward } from '../api/world/_explore';

/** Cinderhold's land (67-74), the NPC village's home (owner plan, 2026-11-08). */

test('only beasts roam Cinderhold by day, and nothing hunts it at night', () => {
    let rolled = 0;
    for (const sector of CINDERHOLD_SECTORS) for (let bucket = 0; bucket < 400; bucket++) {
        for (const w of rollWanderers(sector, bucket)) { rolled++; assert.equal(w.archetype, 'beast', `${sector}/${bucket}: ${w.archetype}`); }
        for (let night = 0; night < 4; night++) assert.equal(rollNightWanderer(sector, night, bucket), null);
        assert.equal(roadNemesisPresentIn('Rill', sector, bucket), false);
    }
    assert.ok(rolled > 100, 'beasts still roam there');
    // Elsewhere the ordinary cast is unchanged: bandits still appear on the Lavafront.
    const lavafront = Array.from({ length: 400 }, (_, bucket) => rollWanderers(66, bucket)).flat();
    assert.ok(lavafront.some((w) => w.archetype === 'bandit'));
});

test('the world boss never spawns in or walks through Cinderhold', () => {
    for (const sector of CINDERHOLD_SECTORS) {
        assert.equal(isWorldBossRoamSector(sector), false);
        for (const village of Object.keys(VILLAGE_OUTSKIRTS)) assert.equal(worldBossRoute(sector, village), null);
    }
    for (let spawn = 1; spawn <= 66; spawn++) for (const village of Object.keys(VILLAGE_OUTSKIRTS)) {
        const route = worldBossRoute(spawn, village);
        assert.ok(!route?.some((sector) => CINDERHOLD_SECTORS.includes(sector)), `${spawn} -> ${village}: ${route}`);
    }
});

test('exploring Cinderhold pays as sector 66, and sectors 1-66 are unchanged', () => {
    for (const sector of CINDERHOLD_SECTORS) assert.equal(sectorExploreReward(sector)!.ryo, sectorExploreReward(66)!.ryo);
    for (let sector = 1; sector <= 66; sector++) {
        const reward = sectorExploreReward(sector);
        if (reward) assert.equal(reward.ryo, 10 + Math.floor(sector / 4) + 10 + Math.floor(sector / 10));
    }
});
