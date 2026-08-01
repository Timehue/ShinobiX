import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { passRankExam } from './exams/_pass.js';
import { effectiveStatsTrained } from './_xp-engine.js';
import { applyPetSummonCost } from './pet/_progress.js';
import { evolvePet, EVOLUTION_LINES } from './pet/_evolution.js';
import { sanitizeCharacterSave } from './save/[name].js';

/*
 * Regressions for the live bugs found by the STRICT_RAW_SAVE_LEDGER readiness
 * audit (2026-08-01). Each one was player-visible on main before this wave.
 */

describe('stats-trained gate matches the Logbook the player reads', () => {
    const base = {
        level: 20, elements: ['Fire'], totalMissionsCompleted: 20, totalAiKills: 20,
        totalTilesExplored: 50, jutsuMastery: [{ level: 3 }], examsPassed: [] as string[],
    };
    // 12 stats at base 10 → +400 allocated spread over two stats.
    const grownStats = { strength: 210, speed: 210 };

    it('counts points that arrived by allocation, not just idle training', () => {
        // The counter is only incremented by idle training, so a build grown by
        // spending the unspent pool (or PvP stat growth) read 0 to the exam while
        // the Logbook showed the requirement met.
        assert.equal(effectiveStatsTrained({ totalStatsTrained: 0, stats: grownStats }), 400);
        assert.equal(passRankExam({ ...base, totalStatsTrained: 0, stats: grownStats }, 'genin').ok, true);
    });

    it('still honors the idle-training counter on its own', () => {
        assert.equal(passRankExam({ ...base, totalStatsTrained: 400 }, 'genin').ok, true);
    });

    it('does not let an untrained character through', () => {
        assert.equal(passRankExam({ ...base, totalStatsTrained: 399 }, 'genin').ok, false);
        assert.equal(passRankExam({ ...base, totalStatsTrained: 0, stats: { strength: 12 } }, 'genin').ok, false);
    });

    it('takes the larger of the two measures, never the sum', () => {
        // Idle training raises BOTH the counter and the stats, so summing would
        // double-count it.
        assert.equal(effectiveStatsTrained({ totalStatsTrained: 400, stats: grownStats }), 400);
    });
});

describe('bloodline forge grants its jutsu a mastery row', () => {
    const bloodline = {
        id: 'bl-forged', name: 'Emberveil', rank: 'A Rank', specialElement: 'Emberveil',
        jutsus: [
            { id: 'emberveil-strike', name: 'Emberveil Strike', element: 'Emberveil', type: 'Ninjutsu', ap: 60, effectPower: 30, cooldown: 7, tags: [] },
            { id: 'emberveil-guard', name: 'Emberveil Guard', element: 'Emberveil', type: 'Any', ap: 40, effectPower: 0, cooldown: 7, tags: [] },
        ],
    };
    const stored = {
        character: { name: 'Forger', level: 20, jutsuMastery: [{ jutsuId: 'starter-buki-fire-2', level: 5, xp: 30 }] },
        savedBloodlines: [bloodline],
    };

    it('adds level-1 rows for the owned bloodline jutsu the save could not', () => {
        // The generic save can never ADD a mastery row, so the client-side grant
        // in BloodlineMaker was discarded and the freshly forged bloodline's
        // jutsu vanished from the loadout picker after a refresh.
        const out = sanitizeCharacterSave(
            { character: { ...stored.character }, savedBloodlines: [bloodline] },
            stored,
        );
        const mastery = (out.character as Record<string, unknown>).jutsuMastery as Array<Record<string, unknown>>;
        const byId = new Map(mastery.map((row) => [String(row.jutsuId), row]));
        assert.ok(byId.has('emberveil-strike'), 'forged bloodline jutsu must be learnable after a reload');
        assert.ok(byId.has('emberveil-guard'));
        assert.equal(byId.get('emberveil-strike')!.level, 1, 'granted at the free 0→1 level only');
    });

    it('never resets trained progress on a jutsu that already has a row', () => {
        const out = sanitizeCharacterSave(
            { character: { ...stored.character }, savedBloodlines: [bloodline] },
            stored,
        );
        const mastery = (out.character as Record<string, unknown>).jutsuMastery as Array<Record<string, unknown>>;
        const existing = mastery.find((row) => row.jutsuId === 'starter-buki-fire-2');
        assert.equal(existing?.level, 5, 'existing trained level is untouched');
        assert.equal(existing?.xp, 30);
    });

    it('grants nothing when the player owns no bloodlines', () => {
        const out = sanitizeCharacterSave(
            { character: { ...stored.character }, savedBloodlines: [] },
            { character: stored.character, savedBloodlines: [] },
        );
        const mastery = (out.character as Record<string, unknown>).jutsuMastery as Array<Record<string, unknown>>;
        assert.equal(mastery.length, 1);
    });
});

describe('PvE pet summon actually spends gear + consumable', () => {
    it('ticks PVE gear durability down by one', () => {
        const out = applyPetSummonCost({ id: 'p1', loadout: { pve: 'guardian-charm', pveDurability: 20 } });
        assert.equal((out.pet.loadout as Record<string, unknown>).pveDurability, 19);
        assert.equal(out.gearBroke, false);
    });

    it('breaks the gear once its durability is spent', () => {
        const out = applyPetSummonCost({ id: 'p1', loadout: { pve: 'guardian-charm', pveDurability: 0 } });
        const loadout = out.pet.loadout as Record<string, unknown>;
        assert.equal(loadout.pve, undefined, 'spent gear is removed');
        assert.equal(loadout.pveDurability, undefined);
        assert.equal(out.gearBroke, true);
    });

    it('consumes the battle consumable and reports which one', () => {
        const out = applyPetSummonCost({ id: 'p1', loadout: { consumable: 'pet-shield-tonic' } });
        assert.equal((out.pet.loadout as Record<string, unknown>).consumable, undefined);
        assert.equal(out.consumableSpent, 'pet-shield-tonic');
    });

    it('is a no-op for a pet with no gear or consumable', () => {
        const out = applyPetSummonCost({ id: 'p1', loadout: {} });
        assert.deepEqual(out.pet.loadout, {});
        assert.equal(out.gearBroke, false);
        assert.equal(out.consumableSpent, null);
    });
});

describe('evolution art is stamped server-side', () => {
    const line = EVOLUTION_LINES[Object.keys(EVOLUTION_LINES)[0]!]!;
    const petId = Object.keys(EVOLUTION_LINES)[0]!;

    it('stage 1 points at the "-r" art', () => {
        const out = evolvePet({ id: petId, rarity: 'standard', level: 30, hp: 100, attack: 10, defense: 10, speed: 10 }, 1, line);
        assert.equal(out.image, `/pet-evos/${petId}-r.webp`);
        assert.equal(out.bodyImage, `/pet-evos/${petId}-r.webp`);
    });

    it('stage 2 points at the "-l" art', () => {
        const out = evolvePet({ id: petId, rarity: 'rare', level: 60, hp: 100, attack: 10, defense: 10, speed: 10 }, 2, line);
        assert.equal(out.image, `/pet-evos/${petId}-l.webp`);
    });
});
