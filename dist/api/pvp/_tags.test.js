"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * Contract tests for the canonical PvP tag registry (api/pvp/_tags.ts).
 *
 * These pin the server-internal invariants: aliases resolve, the known-name set
 * is exactly canonical+aliases, every behavioural sub-set is a subset of the
 * canonical names, and every tag the committed jutsu catalog ships is a name the
 * engine actually knows. Cross-root parity with the client tag tables lives in
 * scripts/pvp-tags-parity.test.mjs.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _tags_js_1 = require("./_tags.js");
const _jutsu_catalog_js_1 = require("./_jutsu-catalog.js");
const canonical = new Set(_tags_js_1.CANONICAL_TAG_NAMES);
(0, node_test_1.describe)('PvP tag contract — aliases', () => {
    (0, node_test_1.it)('every alias resolves to a canonical tag', () => {
        for (const [alias, target] of Object.entries(_tags_js_1.TAG_ALIASES)) {
            node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)(alias), target, `${alias} must canonicalize to ${target}`);
            node_assert_1.strict.ok(canonical.has(target), `${target} (target of ${alias}) must be canonical`);
        }
    });
    (0, node_test_1.it)('pins the five documented aliases', () => {
        node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)('Seal'), 'Bloodline Seal');
        node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)('Afterburn'), 'Ignition');
        node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)('Time Compression'), 'Lag');
        node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)('Time Dilation'), 'Overclock');
        node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)('Vamp'), 'Siphon');
    });
    (0, node_test_1.it)('canonical names are not themselves aliases (idempotent)', () => {
        for (const name of _tags_js_1.CANONICAL_TAG_NAMES) {
            node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)(name), name, `${name} must canonicalize to itself`);
            node_assert_1.strict.ok(!(name in _tags_js_1.TAG_ALIASES), `${name} must not be an alias key`);
        }
    });
    (0, node_test_1.it)('tagNameMatches is alias-aware in both directions', () => {
        node_assert_1.strict.ok((0, _tags_js_1.tagNameMatches)('Vamp', 'Siphon'));
        node_assert_1.strict.ok((0, _tags_js_1.tagNameMatches)('Siphon', 'Siphon'));
        node_assert_1.strict.ok((0, _tags_js_1.tagNameMatches)('Seal', 'Bloodline Seal'));
        node_assert_1.strict.ok(!(0, _tags_js_1.tagNameMatches)('Siphon', 'Lifesteal'));
    });
});
(0, node_test_1.describe)('PvP tag contract — set membership', () => {
    (0, node_test_1.it)('KNOWN_TAG_NAMES is exactly canonical ∪ aliases', () => {
        const expected = new Set([..._tags_js_1.CANONICAL_TAG_NAMES, ...Object.keys(_tags_js_1.TAG_ALIASES)]);
        node_assert_1.strict.deepEqual([..._tags_js_1.KNOWN_TAG_NAMES].sort(), [...expected].sort());
    });
    (0, node_test_1.it)('canonical names are unique', () => {
        node_assert_1.strict.equal(_tags_js_1.CANONICAL_TAG_NAMES.length, canonical.size);
    });
    for (const [label, set] of [
        ['STACKABLE_STATUS', _tags_js_1.STACKABLE_STATUS],
        ['CAPPED_AMP_TAGS', _tags_js_1.CAPPED_AMP_TAGS],
        ['GROUND_EFFECT_TAGS', _tags_js_1.GROUND_EFFECT_TAGS],
        ['OPPONENT_AFFECTING_TAGS', _tags_js_1.OPPONENT_AFFECTING_TAGS],
        ['REQUIRES_DAMAGE_TAGS', _tags_js_1.REQUIRES_DAMAGE_TAGS],
        ['FIXED_EFFECT_POWER_TAGS', _tags_js_1.FIXED_EFFECT_POWER_TAGS],
    ]) {
        (0, node_test_1.it)(`${label} only contains canonical names`, () => {
            for (const name of set) {
                node_assert_1.strict.ok(canonical.has(name), `${label} member ${name} is not a canonical tag`);
            }
        });
    }
    (0, node_test_1.it)('REQUIRES_DAMAGE_TAGS are Wound + Siphon (post-damage resolvers)', () => {
        node_assert_1.strict.deepEqual([..._tags_js_1.REQUIRES_DAMAGE_TAGS].sort(), ['Siphon', 'Wound']);
    });
});
(0, node_test_1.describe)('PvP tag contract — fixed-effect power', () => {
    (0, node_test_1.it)('FIXED_EFFECT_STANDARD_EP is the standard 60-AP damage (40)', () => {
        node_assert_1.strict.equal(_tags_js_1.FIXED_EFFECT_STANDARD_EP, 40);
    });
    (0, node_test_1.it)('jutsuHasFixedEffectPower is true for a control tag, false for a pure-damage one', () => {
        node_assert_1.strict.ok((0, _tags_js_1.jutsuHasFixedEffectPower)([{ name: 'Stun' }]));
        node_assert_1.strict.ok((0, _tags_js_1.jutsuHasFixedEffectPower)([{ name: 'Copy' }]));
        node_assert_1.strict.ok((0, _tags_js_1.jutsuHasFixedEffectPower)([{ name: 'Push' }]));
        node_assert_1.strict.ok(!(0, _tags_js_1.jutsuHasFixedEffectPower)([{ name: 'Wound' }]));
        node_assert_1.strict.ok(!(0, _tags_js_1.jutsuHasFixedEffectPower)([{ name: 'Increase Damage Given' }]));
        node_assert_1.strict.ok(!(0, _tags_js_1.jutsuHasFixedEffectPower)([]));
        node_assert_1.strict.ok(!(0, _tags_js_1.jutsuHasFixedEffectPower)(undefined));
    });
    (0, node_test_1.it)('jutsuHasFixedEffectPower is alias-aware (Seal → Bloodline Seal)', () => {
        node_assert_1.strict.ok((0, _tags_js_1.jutsuHasFixedEffectPower)([{ name: 'Seal' }]));
        node_assert_1.strict.ok((0, _tags_js_1.jutsuHasFixedEffectPower)([{ name: 'Time Compression' }])); // → Lag
    });
});
(0, node_test_1.describe)('PvP tag contract — catalog coverage', () => {
    (0, node_test_1.it)('every tag on every built-in catalog jutsu is a known tag name', () => {
        for (const jutsu of Object.values(_jutsu_catalog_js_1.JUTSU_CATALOG)) {
            for (const tag of jutsu.tags ?? []) {
                node_assert_1.strict.ok(_tags_js_1.KNOWN_TAG_NAMES.has(tag.name), `catalog jutsu ${jutsu.id} carries unknown tag "${tag.name}"`);
            }
        }
    });
    (0, node_test_1.it)('catalog tags are already canonical (no aliases shipped in content)', () => {
        for (const jutsu of Object.values(_jutsu_catalog_js_1.JUTSU_CATALOG)) {
            for (const tag of jutsu.tags ?? []) {
                node_assert_1.strict.equal((0, _tags_js_1.canonicalTagName)(tag.name), tag.name, `catalog jutsu ${jutsu.id} ships alias "${tag.name}" — should be canonical`);
            }
        }
    });
});
