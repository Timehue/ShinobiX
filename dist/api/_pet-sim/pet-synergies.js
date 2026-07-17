"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateSynergyBonus = aggregateSynergyBonus;
exports.applySynergiesToSquad = applySynergiesToSquad;
// Verbatim numeric tiers from the client SYNERGY_DEFS (display fields omitted).
const SYNERGY_DEFS = [
    { kind: 'element', match: 'Fire', tiers: [{ count: 2, bonus: { attack: 0.12 } }, { count: 4, bonus: { attack: 0.28 } }] },
    { kind: 'element', match: 'Water', tiers: [{ count: 2, bonus: { hp: 0.14 } }, { count: 4, bonus: { hp: 0.32 } }] },
    { kind: 'element', match: 'Wind', tiers: [{ count: 2, bonus: { speed: 0.16 } }, { count: 4, bonus: { speed: 0.36 } }] },
    { kind: 'element', match: 'Lightning', tiers: [{ count: 2, bonus: { attack: 0.10, speed: 0.08 } }, { count: 4, bonus: { attack: 0.22, speed: 0.18 } }] },
    { kind: 'element', match: 'Earth', tiers: [{ count: 2, bonus: { defense: 0.16 } }, { count: 4, bonus: { defense: 0.36 } }] },
    { kind: 'role', match: 'defender', tiers: [{ count: 2, bonus: { defense: 0.15, hp: 0.10 } }] },
    { kind: 'role', match: 'assassin', tiers: [{ count: 2, bonus: { attack: 0.16 } }] },
    { kind: 'role', match: 'sage', tiers: [{ count: 2, bonus: { hp: 0.13 } }] },
    { kind: 'role', match: 'tracker', tiers: [{ count: 2, bonus: { speed: 0.13 } }] },
];
function petElement(pet) {
    const e = pet.element;
    return e && e !== 'None' ? e : null;
}
/** The highest-tier bonus each definition activates for the squad, summed per stat. */
function aggregateSynergyBonus(squad) {
    const elementCounts = new Map();
    const roleCounts = new Map();
    for (const pet of squad) {
        const el = petElement(pet);
        if (el)
            elementCounts.set(el, (elementCounts.get(el) ?? 0) + 1);
        roleCounts.set(pet.role, (roleCounts.get(pet.role) ?? 0) + 1);
    }
    const total = { attack: 0, hp: 0, defense: 0, speed: 0 };
    for (const def of SYNERGY_DEFS) {
        const count = (def.kind === 'element' ? elementCounts : roleCounts).get(def.match) ?? 0;
        let tierIndex = -1;
        for (let i = 0; i < def.tiers.length; i++)
            if (count >= def.tiers[i].count)
                tierIndex = i;
        if (tierIndex < 0)
            continue;
        const bonus = def.tiers[tierIndex].bonus;
        for (const stat of Object.keys(bonus))
            total[stat] += bonus[stat] ?? 0;
    }
    return total;
}
/** Buffed COPIES of the squad — stats scale by (1 + bonus), integer, min-clamped.
 *  Byte-identical to the client applySynergiesToSquad. */
function applySynergiesToSquad(squad) {
    const b = aggregateSynergyBonus(squad);
    return squad.map((pet) => ({
        ...pet,
        hp: Math.max(1, Math.round(pet.hp * (1 + b.hp))),
        attack: Math.max(1, Math.round(pet.attack * (1 + b.attack))),
        defense: Math.max(0, Math.round(pet.defense * (1 + b.defense))),
        speed: Math.max(1, Math.round(pet.speed * (1 + b.speed))),
    }));
}
