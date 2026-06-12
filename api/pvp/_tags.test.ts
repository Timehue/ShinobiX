/*
 * Contract tests for the canonical PvP tag registry (api/pvp/_tags.ts).
 *
 * These pin the server-internal invariants: aliases resolve, the known-name set
 * is exactly canonical+aliases, every behavioural sub-set is a subset of the
 * canonical names, and every tag the committed jutsu catalog ships is a name the
 * engine actually knows. Cross-root parity with the client tag tables lives in
 * scripts/pvp-tags-parity.test.mjs.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    TAG_ALIASES,
    CANONICAL_TAG_NAMES,
    KNOWN_TAG_NAMES,
    STACKABLE_STATUS,
    CAPPED_AMP_TAGS,
    GROUND_EFFECT_TAGS,
    OPPONENT_AFFECTING_TAGS,
    REQUIRES_DAMAGE_TAGS,
    FIXED_EFFECT_POWER_TAGS,
    FIXED_EFFECT_STANDARD_EP,
    jutsuHasFixedEffectPower,
    canonicalTagName,
    tagNameMatches,
} from './_tags.js';
import { JUTSU_CATALOG } from './_jutsu-catalog.js';

const canonical = new Set(CANONICAL_TAG_NAMES);

describe('PvP tag contract — aliases', () => {
    it('every alias resolves to a canonical tag', () => {
        for (const [alias, target] of Object.entries(TAG_ALIASES)) {
            assert.equal(canonicalTagName(alias), target, `${alias} must canonicalize to ${target}`);
            assert.ok(canonical.has(target), `${target} (target of ${alias}) must be canonical`);
        }
    });

    it('pins the five documented aliases', () => {
        assert.equal(canonicalTagName('Seal'), 'Bloodline Seal');
        assert.equal(canonicalTagName('Afterburn'), 'Ignition');
        assert.equal(canonicalTagName('Time Compression'), 'Lag');
        assert.equal(canonicalTagName('Time Dilation'), 'Overclock');
        assert.equal(canonicalTagName('Vamp'), 'Siphon');
    });

    it('canonical names are not themselves aliases (idempotent)', () => {
        for (const name of CANONICAL_TAG_NAMES) {
            assert.equal(canonicalTagName(name), name, `${name} must canonicalize to itself`);
            assert.ok(!(name in TAG_ALIASES), `${name} must not be an alias key`);
        }
    });

    it('tagNameMatches is alias-aware in both directions', () => {
        assert.ok(tagNameMatches('Vamp', 'Siphon'));
        assert.ok(tagNameMatches('Siphon', 'Siphon'));
        assert.ok(tagNameMatches('Seal', 'Bloodline Seal'));
        assert.ok(!tagNameMatches('Siphon', 'Lifesteal'));
    });
});

describe('PvP tag contract — set membership', () => {
    it('KNOWN_TAG_NAMES is exactly canonical ∪ aliases', () => {
        const expected = new Set<string>([...CANONICAL_TAG_NAMES, ...Object.keys(TAG_ALIASES)]);
        assert.deepEqual([...KNOWN_TAG_NAMES].sort(), [...expected].sort());
    });

    it('canonical names are unique', () => {
        assert.equal(CANONICAL_TAG_NAMES.length, canonical.size);
    });

    for (const [label, set] of [
        ['STACKABLE_STATUS', STACKABLE_STATUS],
        ['CAPPED_AMP_TAGS', CAPPED_AMP_TAGS],
        ['GROUND_EFFECT_TAGS', GROUND_EFFECT_TAGS],
        ['OPPONENT_AFFECTING_TAGS', OPPONENT_AFFECTING_TAGS],
        ['REQUIRES_DAMAGE_TAGS', REQUIRES_DAMAGE_TAGS],
        ['FIXED_EFFECT_POWER_TAGS', FIXED_EFFECT_POWER_TAGS],
    ] as const) {
        it(`${label} only contains canonical names`, () => {
            for (const name of set) {
                assert.ok(canonical.has(name), `${label} member ${name} is not a canonical tag`);
            }
        });
    }

    it('REQUIRES_DAMAGE_TAGS are Wound + Siphon (post-damage resolvers)', () => {
        assert.deepEqual([...REQUIRES_DAMAGE_TAGS].sort(), ['Siphon', 'Wound']);
    });
});

describe('PvP tag contract — fixed-effect power', () => {
    it('FIXED_EFFECT_STANDARD_EP is the standard 60-AP damage (40)', () => {
        assert.equal(FIXED_EFFECT_STANDARD_EP, 40);
    });

    it('jutsuHasFixedEffectPower is true for a control tag, false for a pure-damage one', () => {
        assert.ok(jutsuHasFixedEffectPower([{ name: 'Stun' }]));
        assert.ok(jutsuHasFixedEffectPower([{ name: 'Copy' }]));
        assert.ok(jutsuHasFixedEffectPower([{ name: 'Push' }]));
        assert.ok(!jutsuHasFixedEffectPower([{ name: 'Wound' }]));
        assert.ok(!jutsuHasFixedEffectPower([{ name: 'Increase Damage Given' }]));
        assert.ok(!jutsuHasFixedEffectPower([]));
        assert.ok(!jutsuHasFixedEffectPower(undefined));
    });

    it('jutsuHasFixedEffectPower is alias-aware (Seal → Bloodline Seal)', () => {
        assert.ok(jutsuHasFixedEffectPower([{ name: 'Seal' }]));
        assert.ok(jutsuHasFixedEffectPower([{ name: 'Time Compression' }])); // → Lag
    });
});

describe('PvP tag contract — catalog coverage', () => {
    it('every tag on every built-in catalog jutsu is a known tag name', () => {
        for (const jutsu of Object.values(JUTSU_CATALOG)) {
            for (const tag of jutsu.tags ?? []) {
                assert.ok(
                    KNOWN_TAG_NAMES.has(tag.name),
                    `catalog jutsu ${jutsu.id} carries unknown tag "${tag.name}"`,
                );
            }
        }
    });

    it('catalog tags are already canonical (no aliases shipped in content)', () => {
        for (const jutsu of Object.values(JUTSU_CATALOG)) {
            for (const tag of jutsu.tags ?? []) {
                assert.equal(
                    canonicalTagName(tag.name), tag.name,
                    `catalog jutsu ${jutsu.id} ships alias "${tag.name}" — should be canonical`,
                );
            }
        }
    });
});
