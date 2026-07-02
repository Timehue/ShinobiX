/*
 * Definitions lint for the 100 Legacy specialty jutsu (the generated server
 * catalog api/pvp/_legacy-jutsu-catalog.ts ⇄ api/_legacy-defs.ts linkage).
 *
 * Locks the tier design so a mis-authored signature fails `npm test`:
 *   • every Legacy has exactly one signature and vice versa;
 *   • cooldown 10, element "None", AP ∈ {40, 60}, starter-convention costs;
 *   • capped-tag percents by rarity — mythic 40 / legendary one 40 + one 35 /
 *     rare 35 / basic 30; Wound uses its own ladder (35/35/30/25);
 *   • bloodlineRank carries the cap tier (S/S/A/absent);
 *   • no bloodline-unique control tags (bloodline STRENGTH, not CONTROL);
 *   • Increase Discipline only on discipline-typed jutsu, and every style-category
 *     Legacy's signature is typed to its own discipline;
 *   • non-style damage signatures use the adaptive "Any" marker (stamped to the
 *     owner's specialty at battle time — server getOffense has no "Any" branch);
 *   • shape contracts: AOE_CIRCLE ⇒ Move + EMPTY_GROUND; AOE_BURST/SINGLE ⇒
 *     OPPONENT; Wound/Siphon only where the cast can actually deal damage.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { LEGACY_JUTSU_CATALOG, LEGACY_JUTSU_ID_BY_LEGACY, type LegacyCatalogJutsu } from './pvp/_legacy-jutsu-catalog.js';
import { LEGACY_DEFS, LEGACY_BY_ID } from './_legacy-defs.js';
import { CANONICAL_TAG_NAMES, CAPPED_AMP_TAGS, OPPONENT_AFFECTING_TAGS } from './pvp/_tags.js';

const ALL = Object.values(LEGACY_JUTSU_CATALOG);
const DISCIPLINES = ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'];
const STYLE_CATEGORY_TO_TYPE: Record<string, string> = {
    taijutsu: 'Taijutsu', bukijutsu: 'Bukijutsu', genjutsu: 'Genjutsu', ninjutsu: 'Ninjutsu',
};
// Bloodline-unique tags — banned on legacy signatures (PvP-balance line: legacy
// jutsu reach bloodline STRENGTH via rank caps, never bloodline CONTROL).
const BLOODLINE_ONLY = new Set([
    'Stun', 'Bloodline Seal', 'Buff Prevent', 'Debuff Prevent', 'Elemental Seal',
    'Mirror', 'Copy', 'Lag', 'Overclock', 'Pierce',
]);
const WOUND_BY_RARITY: Record<string, number> = { mythic: 35, legendary: 35, rare: 30, basic: 25 };
const CAP_BY_RARITY: Record<string, number> = { mythic: 40, legendary: 40, rare: 35, basic: 30 };
const EP_BY_RARITY: Record<string, number> = { mythic: 40, legendary: 40, rare: 38, basic: 36 };

function rarityOf(j: LegacyCatalogJutsu): string {
    return LEGACY_BY_ID.get(j.legacyId)!.rarity;
}
// Percent-bearing tags the tier ladder governs (capped amp tags + Increase Heal,
// which is uncapped by rank but authored at tier value for coherence).
function tierPercentTags(j: LegacyCatalogJutsu) {
    return j.tags.filter((t) => CAPPED_AMP_TAGS.has(t.name) || t.name === 'Increase Heal');
}

describe('legacy jutsu ⇄ legacy defs linkage', () => {
    it('exactly 100 signatures with unique ids, each owned by a real Legacy', () => {
        assert.equal(ALL.length, 100);
        assert.equal(new Set(ALL.map((j) => j.id)).size, 100, 'duplicate jutsu id');
        assert.equal(new Set(ALL.map((j) => j.legacyId)).size, 100, 'two signatures claim the same Legacy');
        for (const j of ALL) assert.ok(LEGACY_BY_ID.has(j.legacyId), `${j.id}: unknown legacyId "${j.legacyId}"`);
    });

    it('every Legacy def resolves its specialtyJutsuId into the catalog', () => {
        for (const d of LEGACY_DEFS) {
            assert.ok(d.specialtyJutsuId, `${d.id}: missing specialtyJutsuId`);
            assert.ok(LEGACY_JUTSU_CATALOG[d.specialtyJutsuId!], `${d.id}: specialtyJutsuId "${d.specialtyJutsuId}" not in catalog`);
            assert.equal(LEGACY_JUTSU_ID_BY_LEGACY[d.id], d.specialtyJutsuId, `${d.id}: by-legacy map disagrees`);
        }
    });

    it('unique jutsu names and legacy-<slug> ids that never collide with built-ins', () => {
        assert.equal(new Set(ALL.map((j) => j.name)).size, 100, 'duplicate jutsu name');
        for (const j of ALL) assert.match(j.id, /^legacy-[a-z0-9-]+$/, `${j.id}: id must be legacy-<slug>`);
    });
});

describe('legacy jutsu tier rules (locked design)', () => {
    it('cooldown 10 and element "None" on all 100', () => {
        for (const j of ALL) {
            assert.equal(j.cooldown, 10, `${j.id}: legacy signatures all run cooldown 10`);
            assert.equal(j.element, 'None', `${j.id}: element must be "None" (never element-locked or weather-swung)`);
        }
    });

    it('AP tiers follow starter conventions (60 damage / 40 utility) with tiered EP', () => {
        for (const j of ALL) {
            const rarity = rarityOf(j);
            assert.ok(j.ap === 60 || j.ap === 40, `${j.id}: AP must be 60 or 40`);
            if (j.ap === 60) {
                assert.equal(j.effectPower, EP_BY_RARITY[rarity], `${j.id}: ${rarity} damage EP must be ${EP_BY_RARITY[rarity]}`);
                assert.equal(j.chakraCost, 250, `${j.id}: 60-AP costs 250/250`);
                assert.equal(j.staminaCost, 250, `${j.id}: 60-AP costs 250/250`);
            } else {
                assert.equal(j.effectPower, 0, `${j.id}: 40-AP utility must be zero-damage`);
                assert.equal(j.chakraCost, 125, `${j.id}: 40-AP costs 125/125`);
                assert.equal(j.staminaCost, 125, `${j.id}: 40-AP costs 125/125`);
                assert.equal(j.type, 'Any', `${j.id}: 40-AP utilities are type Any by convention`);
            }
            assert.ok(j.range >= 4 && j.range <= 6, `${j.id}: range ${j.range} outside 4-6`);
        }
    });

    it('bloodlineRank carries the cap tier: mythic/legendary S, rare A, basic none', () => {
        for (const j of ALL) {
            const rarity = rarityOf(j);
            const want = rarity === 'mythic' || rarity === 'legendary' ? 'S Rank' : rarity === 'rare' ? 'A Rank' : undefined;
            assert.equal(j.bloodlineRank, want, `${j.id}: ${rarity} must carry bloodlineRank ${want ?? '(none)'}`);
        }
    });

    it('capped-tag percents follow the tier ladder (M 40 / L 40+35 / R 35 / B 30)', () => {
        for (const j of ALL) {
            const rarity = rarityOf(j);
            const capped = tierPercentTags(j);
            if (rarity === 'legendary') {
                // One tag at 40; a second percent tag (capped or Wound) sits at 35.
                const at40 = capped.filter((t) => t.percent === 40).length;
                const at35 = capped.filter((t) => t.percent === 35).length;
                assert.equal(at40, 1, `${j.id}: legendary needs exactly one 40% tag (got ${at40})`);
                assert.equal(at40 + at35, capped.length, `${j.id}: legendary capped tags must be 40 or 35`);
                assert.ok(capped.length <= 2, `${j.id}: legendary carries at most two tier tags`);
            } else {
                const want = CAP_BY_RARITY[rarity];
                for (const t of capped) {
                    assert.equal(t.percent, want, `${j.id}: ${rarity} "${t.name}" must be ${want}% (got ${t.percent})`);
                }
            }
        }
    });

    it('Wound follows its own rank ladder (35/35/30/25) and only on damage casts', () => {
        for (const j of ALL) {
            const wound = j.tags.find((t) => t.name === 'Wound');
            if (!wound) continue;
            assert.equal(wound.percent, WOUND_BY_RARITY[rarityOf(j)], `${j.id}: Wound percent off-ladder`);
            assert.ok(j.ap === 60 && j.effectPower > 0, `${j.id}: Wound needs a damage-dealing cast (sanitizer strips it otherwise)`);
        }
        for (const j of ALL) {
            if (j.tags.some((t) => t.name === 'Siphon')) {
                assert.ok(j.ap === 60 && j.effectPower > 0, `${j.id}: Siphon needs a damage-dealing cast`);
            }
        }
    });

    it('tag vocabulary: canonical names only, no bloodline-unique control tags', () => {
        const canonical = new Set(CANONICAL_TAG_NAMES);
        for (const j of ALL) {
            assert.ok(j.tags.length >= 1 && j.tags.length <= 3, `${j.id}: 1-3 tags`);
            for (const t of j.tags) {
                assert.ok(canonical.has(t.name), `${j.id}: unknown/non-canonical tag "${t.name}"`);
                assert.ok(!BLOODLINE_ONLY.has(t.name), `${j.id}: "${t.name}" is bloodline-unique — banned on legacy signatures`);
            }
        }
    });

    it('Increase Discipline only on discipline-typed jutsu; style Legacies are typed to their own style', () => {
        for (const j of ALL) {
            if (j.tags.some((t) => t.name === 'Increase Discipline')) {
                assert.ok(DISCIPLINES.includes(j.type), `${j.id}: Increase Discipline needs a concrete discipline type (got "${j.type}")`);
            }
            const styleType = STYLE_CATEGORY_TO_TYPE[LEGACY_BY_ID.get(j.legacyId)!.category];
            if (styleType) {
                assert.equal(j.type, styleType, `${j.id}: style Legacy signature must be typed ${styleType}`);
                assert.ok(j.tags.some((t) => t.name === 'Increase Discipline'), `${j.id}: style signatures carry the discipline amp`);
            } else if (j.ap === 60) {
                // Non-style damage signature: adaptive marker, stamped at battle time.
                assert.equal(j.type, 'Any', `${j.id}: non-style damage signatures store type "Any" (adaptive)`);
            }
        }
    });

    it('shape contracts: methods, targets, and the Move pairing', () => {
        for (const j of ALL) {
            assert.ok(['SINGLE', 'AOE_BURST', 'AOE_CIRCLE'].includes(j.method), `${j.id}: unexpected method ${j.method}`);
            const hasMove = j.tags.some((t) => t.name === 'Move');
            if (j.method === 'AOE_CIRCLE') {
                assert.ok(hasMove, `${j.id}: AOE_CIRCLE signatures are movement nukes — Move tag required`);
                assert.equal(j.target, 'EMPTY_GROUND', `${j.id}: movement nukes target EMPTY_GROUND`);
                assert.equal(j.ap, 60, `${j.id}: movement nukes are 60-AP damage casts`);
            } else {
                assert.ok(!hasMove, `${j.id}: Move only belongs on AOE_CIRCLE movement nukes`);
                if (j.ap === 60) assert.equal(j.target, 'OPPONENT', `${j.id}: 60-AP strikes target OPPONENT`);
            }
            if (j.ap === 40) {
                const wantsOpponent = j.tags.some((t) => OPPONENT_AFFECTING_TAGS.has(t.name));
                assert.equal(j.target, wantsOpponent ? 'OPPONENT' : 'SELF',
                    `${j.id}: utility target must match its tags (${wantsOpponent ? 'debuffs need OPPONENT' : 'self-buffs use SELF'})`);
            }
        }
    });

    it('battle-log + card flavor present and token-free (rendered verbatim)', () => {
        for (const j of ALL) {
            assert.ok(j.battleDescription && j.battleDescription.length > 10, `${j.id}: missing battleDescription`);
            assert.ok(!/%user|%target/.test(j.battleDescription), `${j.id}: legacy flavor is token-free`);
        }
    });
});
