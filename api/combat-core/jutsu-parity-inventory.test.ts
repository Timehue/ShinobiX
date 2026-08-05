import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CANONICAL_TAG_NAMES } from '../pvp/_tags.js';
import {
    COMBAT_MODE_EXCEPTIONS,
    SHARED_JUTSU_FIELDS_EXCLUDED_FROM_MODE_EXCEPTIONS,
} from './mode-exceptions.js';
import { buildJutsuParityInventory, TAG_BEHAVIOR_FAMILIES } from './jutsu-parity-inventory.js';

describe('executable jutsu parity inventory', () => {
    test('derives the shipped census and classifies every executable jutsu', () => {
        const inventory = buildJutsuParityInventory();
        assert.equal(inventory.rows.length, 217, 'review baseline; count is still derived from executable catalogs');
        assert.deepEqual(inventory.sourceCounts, { 'built-in': 117, legacy: 100, 'admin-published': 0 });
        assert.deepEqual(inventory.targetCounts, { OPPONENT: 180, EMPTY_GROUND: 12, SELF: 25 });
        assert.deepEqual(inventory.methodCounts, { SINGLE: 171, AOE_BURST: 37, AOE_CIRCLE: 9 });
        assert.deepEqual(inventory.apCosts, [20, 40, 60]);
        assert.deepEqual(inventory.cooldowns, [2, 7, 10]);
        assert.deepEqual(inventory.ranges, [2, 3, 4, 5]);
        assert.deepEqual(inventory.unmappedCanonicalTags, []);
        assert.ok(inventory.rows.every((row) => row.families.length > 0), 'every executable jutsu needs a behavior family');
    });

    test('covers the closed canonical tag contract and all sealed AI references', () => {
        assert.deepEqual(
            Object.keys(TAG_BEHAVIOR_FAMILIES).sort(),
            [...CANONICAL_TAG_NAMES].sort(),
        );
        const inventory = buildJutsuParityInventory();
        assert.equal(inventory.aiReferencedJutsuIds.length, 30);
        assert.deepEqual(inventory.missingAiJutsuIds, []);
    });

    test('includes creator-published jutsu when the authoritative admin store supplies them', () => {
        const inventory = buildJutsuParityInventory([{
            id: 'admin-parity-specimen',
            name: 'Admin Parity Specimen',
            type: 'Ninjutsu',
            target: 'EMPTY_GROUND',
            method: 'AOE_SPIRAL',
            ap: 60,
            chakraCost: 25,
            staminaCost: 10,
            cooldown: 8,
            range: 6,
            tags: [{ name: 'Poison', percent: 12 }],
        }]);
        const row = inventory.rows.find((entry) => entry.id === 'admin-parity-specimen');
        assert.ok(row);
        assert.equal(row.source, 'admin-published');
        assert.deepEqual(row.families, ['damage-over-time', 'ground-zone']);
        assert.equal(inventory.sourceCounts['admin-published'], 1);
    });
});

describe('mode exception registry', () => {
    test('names every intentional Solo-only envelope without overriding shared cast fields', () => {
        assert.deepEqual(Object.keys(COMBAT_MODE_EXCEPTIONS).sort(), [
            'hollow-gate-director',
            'solo-difficulty-guard',
            'weekly-boss-score-attack',
        ]);
        assert.ok(SHARED_JUTSU_FIELDS_EXCLUDED_FROM_MODE_EXCEPTIONS.includes('cooldown'));
        assert.ok(SHARED_JUTSU_FIELDS_EXCLUDED_FROM_MODE_EXCEPTIONS.includes('groundFootprint'));
        assert.ok(SHARED_JUTSU_FIELDS_EXCLUDED_FROM_MODE_EXCEPTIONS.includes('vfxSemantic'));
        for (const exception of Object.values(COMBAT_MODE_EXCEPTIONS)) {
            const serialized = JSON.stringify(exception);
            for (const field of SHARED_JUTSU_FIELDS_EXCLUDED_FROM_MODE_EXCEPTIONS) {
                assert.ok(!serialized.includes(`\"${field}\"`), `${field} may not be overridden by a mode exception`);
            }
        }
    });
});
