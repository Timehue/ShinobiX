import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LEGACY_DEFS, LEGACY_BY_ID, EXPECTED_RARITY_COUNTS, STAT_CATEGORY,
    type LegacyDef, type LegacyRarity, type LegacyCategory,
} from './_legacy-defs.js';

test('roster has exactly 100 legacies with the design rarity split', () => {
    assert.equal(LEGACY_DEFS.length, 100);
    const counts: Record<string, number> = {};
    for (const d of LEGACY_DEFS) counts[d.rarity] = (counts[d.rarity] ?? 0) + 1;
    assert.deepEqual(counts, EXPECTED_RARITY_COUNTS);
});

test('ids are unique kebab-case slugs and the map covers all of them', () => {
    const seen = new Set<string>();
    for (const d of LEGACY_DEFS) {
        assert.match(d.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug: ${d.id}`);
        assert.ok(!seen.has(d.id), `duplicate id: ${d.id}`);
        seen.add(d.id);
        assert.equal(LEGACY_BY_ID.get(d.id), d);
    }
});

test('names and titles are present, distinct enough, and flavored', () => {
    const names = new Set<string>();
    for (const d of LEGACY_DEFS) {
        assert.match(d.name, /^Legacy of the /, `name shape: ${d.name}`);
        assert.ok(!names.has(d.name), `duplicate name: ${d.name}`);
        names.add(d.name);
        assert.ok(d.title.length >= 3 && d.title.length <= 32, `title length: ${d.id}`);
        assert.ok(d.flavor.length >= 20, `flavor too thin: ${d.id}`);
    }
});

function reqCategories(d: LegacyDef): Set<LegacyCategory> {
    const cats = new Set<LegacyCategory>();
    for (const req of d.reqs) {
        if ('stat' in req) cats.add(STAT_CATEGORY[req.stat]);
        else for (const alt of req.anyOf) cats.add(STAT_CATEGORY[alt.stat]);
    }
    return cats;
}

// Multi-proof rule: high rarity cannot be farmed off a single number.
// Mythic: >= 5 requirements spanning >= 4 stat categories.
// Legendary: >= 3 requirements spanning >= 2 stat categories.
test('multi-proof rule holds per rarity', () => {
    for (const d of LEGACY_DEFS) {
        const cats = reqCategories(d);
        if (d.rarity === 'mythic') {
            assert.ok(d.reqs.length >= 5, `mythic ${d.id} needs >=5 reqs`);
            assert.ok(cats.size >= 4, `mythic ${d.id} spans ${cats.size} categories, needs >=4`);
        } else if (d.rarity === 'legendary') {
            assert.ok(d.reqs.length >= 3, `legendary ${d.id} needs >=3 reqs`);
            assert.ok(cats.size >= 2, `legendary ${d.id} spans ${cats.size} categories, needs >=2`);
        } else if (d.rarity === 'rare') {
            assert.ok(d.reqs.length >= 2, `rare ${d.id} needs >=2 reqs`);
        } else {
            assert.ok(d.reqs.length >= 1, `basic ${d.id} needs >=1 req`);
        }
    }
});

test('all requirement stats are known counters and thresholds are sane', () => {
    for (const d of LEGACY_DEFS) {
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const f of floors) {
                assert.ok(f.stat in STAT_CATEGORY, `${d.id}: unknown stat ${f.stat}`);
                assert.ok(Number.isFinite(f.atLeast) && f.atLeast > 0, `${d.id}: bad floor for ${f.stat}`);
            }
        }
    }
});

test('rarity thresholds escalate: a mythic is never cheaper than a basic on shared stats', () => {
    // For every stat used by both a basic and a mythic def, the mythic floor
    // must be strictly higher — guards against a fat-fingered "mythic for 10 kills".
    const floorByRarity = new Map<string, Map<LegacyRarity, number>>();
    for (const d of LEGACY_DEFS) {
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const f of floors) {
                let m = floorByRarity.get(f.stat);
                if (!m) floorByRarity.set(f.stat, (m = new Map()));
                const prev = m.get(d.rarity);
                m.set(d.rarity, prev === undefined ? f.atLeast : Math.min(prev, f.atLeast));
            }
        }
    }
    for (const [stat, m] of floorByRarity) {
        const basic = m.get('basic');
        const mythic = m.get('mythic');
        if (basic !== undefined && mythic !== undefined) {
            assert.ok(mythic > basic, `${stat}: mythic floor ${mythic} <= basic floor ${basic}`);
        }
    }
});

test('village affinities only reference real villages', () => {
    const VILLAGES = new Set(['Ashen Leaf', 'Stormveil', 'Frostfang', 'Moonshadow']);
    for (const d of LEGACY_DEFS) {
        if (d.villageAffinity) assert.ok(VILLAGES.has(d.villageAffinity), `${d.id}: ${d.villageAffinity}`);
    }
});
