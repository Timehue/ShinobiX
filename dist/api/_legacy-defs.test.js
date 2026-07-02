"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _legacy_defs_js_1 = require("./_legacy-defs.js");
(0, node_test_1.test)('roster has exactly 100 legacies with the design rarity split', () => {
    strict_1.default.equal(_legacy_defs_js_1.LEGACY_DEFS.length, 100);
    const counts = {};
    for (const d of _legacy_defs_js_1.LEGACY_DEFS)
        counts[d.rarity] = (counts[d.rarity] ?? 0) + 1;
    strict_1.default.deepEqual(counts, _legacy_defs_js_1.EXPECTED_RARITY_COUNTS);
});
(0, node_test_1.test)('ids are unique kebab-case slugs and the map covers all of them', () => {
    const seen = new Set();
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        strict_1.default.match(d.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug: ${d.id}`);
        strict_1.default.ok(!seen.has(d.id), `duplicate id: ${d.id}`);
        seen.add(d.id);
        strict_1.default.equal(_legacy_defs_js_1.LEGACY_BY_ID.get(d.id), d);
    }
});
(0, node_test_1.test)('names and titles are present, distinct enough, and flavored', () => {
    const names = new Set();
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        strict_1.default.match(d.name, /^Legacy of the /, `name shape: ${d.name}`);
        strict_1.default.ok(!names.has(d.name), `duplicate name: ${d.name}`);
        names.add(d.name);
        strict_1.default.ok(d.title.length >= 3 && d.title.length <= 32, `title length: ${d.id}`);
        strict_1.default.ok(d.flavor.length >= 20, `flavor too thin: ${d.id}`);
    }
});
function reqCategories(d) {
    const cats = new Set();
    for (const req of d.reqs) {
        if ('stat' in req)
            cats.add(_legacy_defs_js_1.STAT_CATEGORY[req.stat]);
        else
            for (const alt of req.anyOf)
                cats.add(_legacy_defs_js_1.STAT_CATEGORY[alt.stat]);
    }
    return cats;
}
// Multi-proof rule: high rarity cannot be farmed off a single number.
// Mythic: >= 5 requirements spanning >= 4 stat categories.
// Legendary: >= 3 requirements spanning >= 2 stat categories.
(0, node_test_1.test)('multi-proof rule holds per rarity', () => {
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        const cats = reqCategories(d);
        if (d.rarity === 'mythic') {
            strict_1.default.ok(d.reqs.length >= 5, `mythic ${d.id} needs >=5 reqs`);
            strict_1.default.ok(cats.size >= 4, `mythic ${d.id} spans ${cats.size} categories, needs >=4`);
        }
        else if (d.rarity === 'legendary') {
            strict_1.default.ok(d.reqs.length >= 3, `legendary ${d.id} needs >=3 reqs`);
            strict_1.default.ok(cats.size >= 2, `legendary ${d.id} spans ${cats.size} categories, needs >=2`);
        }
        else if (d.rarity === 'rare') {
            strict_1.default.ok(d.reqs.length >= 2, `rare ${d.id} needs >=2 reqs`);
        }
        else {
            strict_1.default.ok(d.reqs.length >= 1, `basic ${d.id} needs >=1 req`);
        }
    }
});
(0, node_test_1.test)('all requirement stats are known counters and thresholds are sane', () => {
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const f of floors) {
                strict_1.default.ok(f.stat in _legacy_defs_js_1.STAT_CATEGORY, `${d.id}: unknown stat ${f.stat}`);
                strict_1.default.ok(Number.isFinite(f.atLeast) && f.atLeast > 0, `${d.id}: bad floor for ${f.stat}`);
            }
        }
    }
});
(0, node_test_1.test)('rarity thresholds escalate: a mythic is never cheaper than a basic on shared stats', () => {
    // For every stat used by both a basic and a mythic def, the mythic floor
    // must be strictly higher — guards against a fat-fingered "mythic for 10 kills".
    const floorByRarity = new Map();
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const f of floors) {
                let m = floorByRarity.get(f.stat);
                if (!m)
                    floorByRarity.set(f.stat, (m = new Map()));
                const prev = m.get(d.rarity);
                m.set(d.rarity, prev === undefined ? f.atLeast : Math.min(prev, f.atLeast));
            }
        }
    }
    for (const [stat, m] of floorByRarity) {
        const basic = m.get('basic');
        const mythic = m.get('mythic');
        if (basic !== undefined && mythic !== undefined) {
            strict_1.default.ok(mythic > basic, `${stat}: mythic floor ${mythic} <= basic floor ${basic}`);
        }
    }
});
(0, node_test_1.test)('village affinities only reference real villages', () => {
    const VILLAGES = new Set(['Ashen Leaf', 'Stormveil', 'Frostfang', 'Moonshadow']);
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        if (d.villageAffinity)
            strict_1.default.ok(VILLAGES.has(d.villageAffinity), `${d.id}: ${d.villageAffinity}`);
    }
});
