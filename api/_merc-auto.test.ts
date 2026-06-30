import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMercAutoDeploy } from './_merc-auto.js';

// Targeting (pickMercTarget) is unit-tested in _merc-roam.test.ts. These cover the
// cron's gating + dual-pass dispatch without touching kv (the deploy paths + the
// war/contest lists are all injected, and card/flipped/empty cases short-circuit
// before any kv read).

test('runMercAutoDeploy is a no-op unless ENABLE_VILLAGE_WAR=1', async () => {
    const prev = process.env.ENABLE_VILLAGE_WAR;
    delete process.env.ENABLE_VILLAGE_WAR;
    // listContests would throw if it ran — proves the gate short-circuits first.
    const r = await runMercAutoDeploy({ listContests: async () => { throw new Error('gate should short-circuit'); } });
    assert.equal(r.enabled, false);
    assert.equal(r.deployed, 0);
    if (prev !== undefined) process.env.ENABLE_VILLAGE_WAR = prev; else delete process.env.ENABLE_VILLAGE_WAR;
});

test('runMercAutoDeploy skips card/flipped sieges + empty village wars (nothing deployed)', async () => {
    const prev = process.env.ENABLE_VILLAGE_WAR;
    process.env.ENABLE_VILLAGE_WAR = '1';
    let sectorDeploys = 0;
    let villageDeploys = 0;
    const r = await runMercAutoDeploy({
        listContests: async () => [
            { id: 'x', sector: 5, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'card', flipped: false }, // not combat
            { id: 'y', sector: 6, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'combat', flipped: true },  // already flipped
        ],
        listVillageWars: async () => [],
        onlineNames: () => [],
        onlineAll: () => [],
        deploy: async () => { sectorDeploys++; return { winner: 'merc', captured: false, controlHp: 100, mercsRemaining: 1 }; },
        deployVillage: async () => { villageDeploys++; return { winner: 'merc', enemyWarHp: 100, mercsRemaining: 1 }; },
    });
    assert.equal(r.enabled, true);
    assert.equal(sectorDeploys, 0, 'a card/flipped contest is never sniped');
    assert.equal(villageDeploys, 0, 'no active village wars → no village-war deploys');
    if (prev !== undefined) process.env.ENABLE_VILLAGE_WAR = prev; else delete process.env.ENABLE_VILLAGE_WAR;
});
