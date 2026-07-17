/*
 * pet-synergies (server) — a FAITHFUL PORT of the numeric parts of
 * shinobij.client/src/lib/pet-synergies.ts, for the Gauntlet re-simulator. Only
 * the STAT effect matters for the outcome (label/icon/color/flavor are dropped);
 * applySynergiesToSquad must produce byte-identical buffed stats to the client so
 * the re-simulated fight matches the run the player played. Reads baked
 * element + role (GAUNTLET_POOL carries both), so no derivePetRole is needed.
 */
import type { GauntletPoolPet } from './_gauntlet-pool.js';

export type SynergyStat = 'attack' | 'hp' | 'defense' | 'speed';

interface SynergyTier { count: number; bonus: Partial<Record<SynergyStat, number>>; }
interface SynergyDef { kind: 'element' | 'role'; match: string; tiers: SynergyTier[]; }

// Verbatim numeric tiers from the client SYNERGY_DEFS (display fields omitted).
const SYNERGY_DEFS: SynergyDef[] = [
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

function petElement(pet: GauntletPoolPet): string | null {
    const e = pet.element;
    return e && e !== 'None' ? e : null;
}

/** The highest-tier bonus each definition activates for the squad, summed per stat. */
export function aggregateSynergyBonus(squad: GauntletPoolPet[]): Record<SynergyStat, number> {
    const elementCounts = new Map<string, number>();
    const roleCounts = new Map<string, number>();
    for (const pet of squad) {
        const el = petElement(pet);
        if (el) elementCounts.set(el, (elementCounts.get(el) ?? 0) + 1);
        roleCounts.set(pet.role, (roleCounts.get(pet.role) ?? 0) + 1);
    }
    const total: Record<SynergyStat, number> = { attack: 0, hp: 0, defense: 0, speed: 0 };
    for (const def of SYNERGY_DEFS) {
        const count = (def.kind === 'element' ? elementCounts : roleCounts).get(def.match) ?? 0;
        let tierIndex = -1;
        for (let i = 0; i < def.tiers.length; i++) if (count >= def.tiers[i].count) tierIndex = i;
        if (tierIndex < 0) continue;
        const bonus = def.tiers[tierIndex].bonus;
        for (const stat of Object.keys(bonus) as SynergyStat[]) total[stat] += bonus[stat] ?? 0;
    }
    return total;
}

/** Buffed COPIES of the squad — stats scale by (1 + bonus), integer, min-clamped.
 *  Byte-identical to the client applySynergiesToSquad. */
export function applySynergiesToSquad(squad: GauntletPoolPet[]): GauntletPoolPet[] {
    const b = aggregateSynergyBonus(squad);
    return squad.map((pet) => ({
        ...pet,
        hp: Math.max(1, Math.round(pet.hp * (1 + b.hp))),
        attack: Math.max(1, Math.round(pet.attack * (1 + b.attack))),
        defense: Math.max(0, Math.round(pet.defense * (1 + b.defense))),
        speed: Math.max(1, Math.round(pet.speed * (1 + b.speed))),
    }));
}
