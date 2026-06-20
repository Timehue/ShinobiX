"use strict";
/**
 * Starter-pet evolution — the AUTHORITATIVE spec + pure stat math.
 *
 * The 5 starter companions evolve twice, climbing one rarity tier each time:
 *   Standard ──(Lv 50 + Awakening Stone)──▶ Rare ──(Lv 90 + Ascension Stone)──▶ Legendary
 *
 * This module is the single source of truth for: which pet evolves into what,
 * the level gate, the required item, and the stat bump. `api/pet/evolve.ts`
 * imports it; the client mirrors the display half in
 * `shinobij.client/src/data/pet-evolutions.ts` (keep the two in sync — same
 * pattern as professionLogic ⇄ api/missions/_progress).
 *
 * Design (see docs/pet-starter-evolution-plan.md):
 *  - The pet's persistent `id` NEVER changes across stages (so the client
 *    normalizer keeps ignoring `starter-*` and won't revert the new rarity).
 *    The stage is tracked by `evolutionStage` (0=standard, 1=rare, 2=legendary).
 *  - The one-time stat bump equals the gap between the rarity base templates
 *    (shinobij.client/src/data/pet-stats.ts), applied ON TOP of the pet's
 *    current stats, then clamped to the new rarity's caps. This makes an evolved
 *    starter equivalent to a native pet of that rarity — no balance outlier.
 *  - `element` is preserved verbatim (carried through the spread), so the
 *    Fire>Wind>Lightning>Earth>Water>Fire matchup wheel survives all 3 stages.
 *  - Jutsu kits are unchanged (kit upgrades are a deliberate, separate, balance-
 *    sensitive decision — not part of this mechanic).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVOLUTION_LINES = void 0;
exports.evolutionLineFor = evolutionLineFor;
exports.stageFromRarity = stageFromRarity;
exports.currentStage = currentStage;
exports.checkEvolve = checkEvolve;
exports.evolvePet = evolvePet;
// Tier-gap deltas (rare-base − standard-base, then legendary-base − rare-base).
// Identical across all 5 elements — only the names differ.
const RARE_DELTA = { hp: 50, attack: 8, defense: 6, speed: 6, moveRange: 0 };
const LEGENDARY_DELTA = { hp: 46, attack: 6, defense: 4, speed: 5, moveRange: 1 };
const AWAKENING_STONE = 'evo-stone-awakening';
const ASCENSION_STONE = 'evo-stone-ascension';
function line(baseId, element, rareName, legendaryName) {
    return {
        baseId,
        element,
        stages: {
            1: { stage: 1, name: rareName, rarity: 'rare', requiredLevel: 50, requiredItem: AWAKENING_STONE, delta: RARE_DELTA },
            2: { stage: 2, name: legendaryName, rarity: 'legendary', requiredLevel: 90, requiredItem: ASCENSION_STONE, delta: LEGENDARY_DELTA },
        },
    };
}
exports.EVOLUTION_LINES = {
    'starter-fire': line('starter-fire', 'Fire', 'Ember Wolf', 'Inferno Fenrir'),
    'starter-water': line('starter-water', 'Water', 'Tidal Selkie', 'Abyssal Leviathan'),
    'starter-wind': line('starter-wind', 'Wind', 'Storm Hawk', 'Tempest Roc'),
    'starter-lightning': line('starter-lightning', 'Lightning', 'Bolt Fang', 'Raijin Hound'),
    'starter-earth': line('starter-earth', 'Earth', 'Granite Tortoise', 'Mountain Genbu'),
};
/** Look up the evolution line for a pet by its persistent base id. */
function evolutionLineFor(petId) {
    return exports.EVOLUTION_LINES[petId] ?? null;
}
/** Map a rarity string to the evolution stage it represents (starters only). */
function stageFromRarity(rarity) {
    if (rarity === 'legendary')
        return 2;
    if (rarity === 'rare')
        return 1;
    return 0;
}
/** The pet's current evolution stage — explicit field wins, else inferred. */
function currentStage(pet) {
    const explicit = Number(pet.evolutionStage);
    if (explicit === 0 || explicit === 1 || explicit === 2)
        return explicit;
    return stageFromRarity(pet.rarity);
}
/**
 * Validate whether `pet` can perform its next evolution given an inventory.
 * Pure — no I/O. The endpoint calls this inside the save lock, then applies
 * `evolvePet` only when ok.
 */
function checkEvolve(pet, inventory) {
    const id = String(pet.id ?? '');
    const evoLine = evolutionLineFor(id);
    if (!evoLine)
        return { ok: false, code: 'not-evolvable', message: 'This pet cannot evolve.' };
    const stage = currentStage(pet);
    if (stage >= 2)
        return { ok: false, code: 'max-evolved', message: 'This pet is already fully evolved.' };
    const nextStage = (stage + 1);
    const spec = evoLine.stages[nextStage];
    const level = Math.floor(Number(pet.level ?? 1));
    if (level < spec.requiredLevel) {
        return { ok: false, code: 'level-too-low', message: `Requires level ${spec.requiredLevel}.`, nextStage, spec, line: evoLine };
    }
    // Belt-and-suspenders: the pre-evolution rarity must match the stage we
    // think we're at (guards a tampered save where rarity and stage disagree).
    const expectedRarity = nextStage === 1 ? 'standard' : 'rare';
    if (String(pet.rarity ?? 'standard') !== expectedRarity) {
        return { ok: false, code: 'wrong-tier', message: 'Pet is not at the expected evolution tier.', nextStage, spec, line: evoLine };
    }
    if (!inventory.includes(spec.requiredItem)) {
        return { ok: false, code: 'missing-item', message: `Missing required item (${spec.requiredItem}).`, nextStage, spec, line: evoLine };
    }
    return { ok: true, nextStage, spec, line: evoLine };
}
const addStat = (value, delta) => Math.max(1, Math.round(value + delta));
/**
 * Pure evolution transform. Returns a NEW pet object with the next stage's
 * name/rarity/stage and the stat bump ADDED (no cap clamp — HP/ATK/DEF/SPD are
 * uncapped now that training builds them to the level-100 ceiling; evolving raises
 * the rarity, which raises the jutsu-power cap, the higher tier's edge). id,
 * element, xp, happiness, loadout, jutsus and everything else are carried verbatim.
 *
 * Callers must validate with `checkEvolve` first — this does no gating.
 */
function evolvePet(pet, nextStage, evoLine) {
    const spec = evoLine.stages[nextStage];
    return {
        ...pet,
        name: spec.name,
        rarity: spec.rarity,
        evolutionStage: nextStage,
        hp: addStat(Number(pet.hp) || 0, spec.delta.hp),
        attack: addStat(Number(pet.attack) || 0, spec.delta.attack),
        defense: addStat(Number(pet.defense) || 0, spec.delta.defense),
        speed: addStat(Number(pet.speed) || 0, spec.delta.speed),
        moveRange: Math.max(2, Math.min(5, (Number(pet.moveRange) || 3) + spec.delta.moveRange)),
        unlockedForPve: true,
    };
}
