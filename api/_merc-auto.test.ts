import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSnipeTarget, runMercAutoDeploy, MERC_SNIPE_HP_FRACTION, type SnipeCandidate } from './_merc-auto.js';

test('pickSnipeTarget picks the LOWEST-HP defender at/under the snipe threshold', () => {
    const cands: SnipeCandidate[] = [
        { name: 'full', village: 'D Village', hp: 100, maxHp: 100 },   // full HP — safe
        { name: 'half', village: 'D Village', hp: 50, maxHp: 100 },    // exactly at threshold — eligible
        { name: 'low', village: 'D Village', hp: 12, maxHp: 100 },     // lowest — the prey
        { name: 'enemy', village: 'Other Village', hp: 5, maxHp: 100 },// wrong village — ignored
        { name: 'dead', village: 'D Village', hp: 0, maxHp: 100 },     // already down — ignored
    ];
    assert.equal(pickSnipeTarget(cands, 'D Village')?.name, 'low');
    assert.equal(MERC_SNIPE_HP_FRACTION, 0.5);
});

test('pickSnipeTarget returns null when nobody is low enough / no defenders', () => {
    assert.equal(pickSnipeTarget([{ name: 'a', village: 'D Village', hp: 90, maxHp: 100 }], 'D Village'), null);
    assert.equal(pickSnipeTarget([], 'D Village'), null);
    // a defender at exactly the threshold IS eligible
    assert.ok(pickSnipeTarget([{ name: 'a', village: 'D Village', hp: 50, maxHp: 100 }], 'D Village'));
});

test('pickSnipeTarget breaks ties by name (deterministic)', () => {
    const cands: SnipeCandidate[] = [
        { name: 'zed', village: 'D Village', hp: 10, maxHp: 100 },
        { name: 'amy', village: 'D Village', hp: 10, maxHp: 100 },
    ];
    assert.equal(pickSnipeTarget(cands, 'D Village')?.name, 'amy');
});

test('runMercAutoDeploy is a no-op unless ENABLE_VILLAGE_WAR=1', async () => {
    const prev = process.env.ENABLE_VILLAGE_WAR;
    delete process.env.ENABLE_VILLAGE_WAR;
    // listContests would throw if it ran — proves the gate short-circuits first.
    const r = await runMercAutoDeploy({ listContests: async () => { throw new Error('gate should short-circuit'); } });
    assert.equal(r.enabled, false);
    assert.equal(r.deployed, 0);
    if (prev !== undefined) process.env.ENABLE_VILLAGE_WAR = prev; else delete process.env.ENABLE_VILLAGE_WAR;
});

test('runMercAutoDeploy skips contests with no eligible target (deploy never called)', async () => {
    const prev = process.env.ENABLE_VILLAGE_WAR;
    process.env.ENABLE_VILLAGE_WAR = '1';
    let deployCalls = 0;
    const r = await runMercAutoDeploy({
        listContests: async () => [
            { id: 'x', sector: 5, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'card', flipped: false }, // not combat
            { id: 'y', sector: 6, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'combat', flipped: true },  // already flipped
        ],
        onlineNames: () => [],
        deploy: async () => { deployCalls++; return { winner: 'merc', captured: false, controlHp: 100, mercsRemaining: 1 }; },
    });
    assert.equal(r.enabled, true);
    assert.equal(deployCalls, 0, 'a card/flipped contest is never sniped');
    if (prev !== undefined) process.env.ENABLE_VILLAGE_WAR = prev; else delete process.env.ENABLE_VILLAGE_WAR;
});
