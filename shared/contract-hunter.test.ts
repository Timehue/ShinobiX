import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    deriveContractHunter, contractHunterIdFor, contractHunterLevel, contractHunterPower, bountyTargets,
} from './contract-hunter.js';

// The Contract Hunter is derived ONCE, here, for every client in the sector AND
// the server that settles the fight. These pin the derivation so the id/level a
// bystander sees, the target fights, and the server seals can never disagree.

const bounty = { target: 'Rill', amount: 250_000, updatedAt: 1_700_000_000_000 };

test('deriveContractHunter: deterministic from the bounty record + target roster facts', () => {
    const a = deriveContractHunter(bounty, { name: 'Rill', level: 30, currentSector: 12 });
    const b = deriveContractHunter({ ...bounty }, { name: 'Rill', level: 30, currentSector: 12 });
    assert.deepEqual(a, b);
    assert.ok(a);
    assert.equal(a.id, 'bounty-hunter-rill-1700000000000');
    assert.equal(a.name, 'Contract Hunter');
    assert.equal(a.sector, 12);
    assert.equal(a.level, 30 + 4 + 3, '+1 per 75k ryo → 250k = +3');
    assert.equal(a.power, 8 + 2, '+1 per 100k ryo → 250k = +2');
    assert.equal(a.targetName, 'Rill');
    assert.equal(a.bountyAmount, 250_000);
});

test('deriveContractHunter: the level comes from the TARGET level + bounty pressure, never a client field', () => {
    assert.equal(contractHunterLevel(10, 0), 14);
    assert.equal(contractHunterLevel(10, 75_000 * 20), 10 + 4 + 12, 'pressure caps at +12');
    assert.equal(contractHunterLevel(99, 10_000_000), 100, 'level caps at 100');
    assert.equal(contractHunterPower(10_000_000), 18, 'power caps at 18');
    assert.equal(contractHunterPower(-5), 8, 'negative amounts are clamped, not exploited');
});

test('deriveContractHunter: no hunter in a safe zone or for an empty pool', () => {
    assert.equal(deriveContractHunter(bounty, { name: 'Rill', level: 30, currentSector: 0 }), null, 'village / Central');
    assert.equal(deriveContractHunter(bounty, { name: 'Rill', level: 30 }), null, 'unknown sector');
    assert.equal(deriveContractHunter({ ...bounty, amount: 0 }, { name: 'Rill', level: 30, currentSector: 3 }), null);
});

test('contractHunterIdFor rotates with the bounty updatedAt and slugs the name the way the server expects', () => {
    assert.equal(contractHunterIdFor('Shadow Fox!', { updatedAt: 42.9 }), 'bounty-hunter-shadow-fox--42');
    assert.notEqual(contractHunterIdFor('Rill', { updatedAt: 1 }), contractHunterIdFor('Rill', { updatedAt: 2 }));
    assert.equal(contractHunterIdFor('', { updatedAt: 1 }), 'bounty-hunter-target-1');
});

test('bountyTargets matches the display name case-insensitively', () => {
    assert.equal(bountyTargets(bounty, 'rill'), true);
    assert.equal(bountyTargets(bounty, ' RILL '), true);
    assert.equal(bountyTargets(bounty, 'rillt'), false);
});
