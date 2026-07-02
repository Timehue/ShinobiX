/*
 * Integration guard for the dedicated Legacy signature slot
 * (hydrateCharacterFromSave in api/pvp/session.ts).
 *
 * The slot's whole contract:
 *   • derived ONLY from the server-owned character.legacy — Stage 3 (Bound)
 *     puts the signature in the sealed loadout, below Stage 3 it doesn't exist;
 *   • the legacy catalog is SEPARATE from JUTSU_CATALOG, so a tampered save
 *     that stuffs a legacy jutsu id into equippedJutsuIds gets NOTHING;
 *   • mastery is stage-scaled (3→30, 4→40, 5→50) and overrides stray entries;
 *   • adaptive "Any" damage signatures are stamped with the owner's specialty
 *     (server getOffense has no "Any" branch), typed signatures pass through;
 *   • ENABLE_LEGACY off ⇒ byte-identical sealed loadouts (rollback safety).
 *
 * Battle Towers inherit all of this via sealTowerFighter → hydrateCharacterFromSave.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { hydrateCharacterFromSave } from './session.js';
import { LEGACY_JUTSU_CATALOG, LEGACY_JUTSU_ID_BY_LEGACY } from './_legacy-jutsu-catalog.js';

const PREV = process.env.ENABLE_LEGACY;
beforeEach(() => { process.env.ENABLE_LEGACY = '1'; });
afterEach(() => {
    if (PREV === undefined) delete process.env.ENABLE_LEGACY;
    else process.env.ENABLE_LEGACY = PREV;
});

// duel-king → legacy-throne-challenge: a non-style ("Any"-adaptive) 60-AP strike.
const ADAPTIVE_ID = LEGACY_JUTSU_ID_BY_LEGACY['duel-king'];
// iron-fist → legacy-break-stance: a Taijutsu-typed style signature.
const TYPED_ID = LEGACY_JUTSU_ID_BY_LEGACY['iron-fist'];
// last-bastion → a 40-AP utility (stays type "Any").
const UTILITY_ID = LEGACY_JUTSU_ID_BY_LEGACY['last-bastion'];

function saveChar(legacy: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: 'Tester', level: 60,
        stats: {}, jutsuMastery: [],
        equippedJutsuIds: ['starter-nin-fire-1'],
        maxHp: 5000, maxChakra: 2000, maxStamina: 2000,
        ...(legacy ? { legacy } : {}),
        ...extra,
    };
}
const clientChar = { name: 'Tester', jutsu: [] } as Record<string, unknown>;

function sealedJutsu(hydrated: Record<string, unknown>): Array<{ id: string; type: string }> {
    return (hydrated.jutsu as Array<{ id: string; type: string }>) ?? [];
}

describe('legacy signature slot — sealed loadout injection', () => {
    it('Stage 3 Bound injects the signature with stage-scaled mastery', () => {
        const h = hydrateCharacterFromSave(saveChar({ legacyId: 'duel-king', stage: 3, acceptedAt: 1, titles: [] }), clientChar, {});
        const sig = sealedJutsu(h).find((j) => j.id === ADAPTIVE_ID);
        assert.ok(sig, 'the signature should be sealed into the loadout at Stage 3');
        const mastery = (h.jutsuMastery as Array<{ jutsuId: string; level: number }>).find((m) => m.jutsuId === ADAPTIVE_ID);
        assert.equal(mastery?.level, 30, 'Stage 3 → mastery 30');
    });

    it('Stage 5 Mythic runs the signature at mastery 50', () => {
        const h = hydrateCharacterFromSave(saveChar({ legacyId: 'duel-king', stage: 5, acceptedAt: 1, titles: [] }), clientChar, {});
        const mastery = (h.jutsuMastery as Array<{ jutsuId: string; level: number }>).find((m) => m.jutsuId === ADAPTIVE_ID);
        assert.equal(mastery?.level, 50, 'Stage 5 → mastery 50');
    });

    it('below Stage 3 (and with no Legacy) there is no signature', () => {
        for (const legacy of [undefined, { legacyId: 'duel-king', stage: 1, acceptedAt: 1, titles: [] }, { legacyId: 'duel-king', stage: 2, acceptedAt: 1, titles: [] }]) {
            const h = hydrateCharacterFromSave(saveChar(legacy), clientChar, {});
            assert.ok(!sealedJutsu(h).some((j) => j.id === ADAPTIVE_ID), `stage ${String((legacy as { stage?: number } | undefined)?.stage)} must not grant the signature`);
        }
    });

    it('a tampered equippedJutsuIds entry can NOT resolve a legacy jutsu (separate catalog)', () => {
        // No legacy on the save, but the loadout claims the mythic signature id.
        const h = hydrateCharacterFromSave(saveChar(undefined, { equippedJutsuIds: [ADAPTIVE_ID, TYPED_ID, 'starter-nin-fire-1'] }), clientChar, {});
        const ids = sealedJutsu(h).map((j) => j.id);
        assert.ok(!ids.includes(ADAPTIVE_ID) && !ids.includes(TYPED_ID), 'legacy ids must be dropped from the 15-slot resolution');
    });

    it("adaptive 'Any' damage signatures are stamped with the owner's specialty", () => {
        const h = hydrateCharacterFromSave(saveChar({ legacyId: 'duel-king', stage: 3, acceptedAt: 1, titles: [] }, { specialty: 'Genjutsu' }), clientChar, {});
        const sig = sealedJutsu(h).find((j) => j.id === ADAPTIVE_ID);
        assert.equal(sig?.type, 'Genjutsu', 'the sealed signature adopts the trained specialty');
        // Unknown/missing specialty falls back to Taijutsu (matches towers' clamp default).
        const h2 = hydrateCharacterFromSave(saveChar({ legacyId: 'duel-king', stage: 3, acceptedAt: 1, titles: [] }), clientChar, {});
        assert.equal(sealedJutsu(h2).find((j) => j.id === ADAPTIVE_ID)?.type, 'Taijutsu');
    });

    it('typed style signatures and 40-AP utilities keep their stored type', () => {
        const typed = hydrateCharacterFromSave(saveChar({ legacyId: 'iron-fist', stage: 3, acceptedAt: 1, titles: [] }, { specialty: 'Genjutsu' }), clientChar, {});
        assert.equal(sealedJutsu(typed).find((j) => j.id === TYPED_ID)?.type, 'Taijutsu', 'style signatures never re-type');
        const util = hydrateCharacterFromSave(saveChar({ legacyId: 'last-bastion', stage: 3, acceptedAt: 1, titles: [] }, { specialty: 'Genjutsu' }), clientChar, {});
        assert.equal(sealedJutsu(util).find((j) => j.id === UTILITY_ID)?.type, 'Any', '40-AP utilities stay type Any');
    });

    it('the sealed signature carries its tier rank + cooldown 10 through sanitization', () => {
        const h = hydrateCharacterFromSave(saveChar({ legacyId: 'duel-king', stage: 3, acceptedAt: 1, titles: [] }), clientChar, {});
        const sig = sealedJutsu(h).find((j) => j.id === ADAPTIVE_ID) as { bloodlineRank?: string; cooldown?: number } | undefined;
        assert.equal(sig?.bloodlineRank, LEGACY_JUTSU_CATALOG[ADAPTIVE_ID].bloodlineRank, 'tier cap carrier survives sealing');
        assert.equal(sig?.cooldown, 10);
    });

    it('ENABLE_LEGACY off ⇒ no signature (rollback keeps sessions byte-identical)', () => {
        delete process.env.ENABLE_LEGACY;
        const h = hydrateCharacterFromSave(saveChar({ legacyId: 'duel-king', stage: 5, acceptedAt: 1, titles: [] }), clientChar, {});
        assert.ok(!sealedJutsu(h).some((j) => j.id === ADAPTIVE_ID), 'flag off must suppress the slot entirely');
    });
});
