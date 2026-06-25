/*
 * pet-gauntlet-stats — pre-fight TEAM aggregation for the Gauntlet stat columns.
 *
 * Pure, presentational helpers that summarise a placed/effective squad so the
 * board view can show, side-by-side, how YOUR team stacks up against the enemy's
 * BEFORE you commit to the fight: the pooled stats, the element spread, and the
 * net elemental edge.
 *
 * Truthfulness: callers pass the EFFECTIVE pets (player = synergies + item/relic
 * buffs already applied; enemy = the round-scaled squad), and the elemental edge
 * reuses the board sim's own `elementMult`, so every number here matches what the
 * fight will actually use. No RNG, no React.
 */

import type { Pet } from "../types/pet";
import { elementMult } from "./pet-board-sim";

export interface TeamStatTotals {
    count: number;
    hp: number;        // pooled max HP (team health pool)
    attack: number;    // pooled attack (team damage output)
    defense: number;   // pooled defense (use defenseAvg for a per-pet read)
    speed: number;     // pooled speed
    defenseAvg: number; // mean defense (mitigation is a per-hit rate)
    speedAvg: number;   // mean speed (acting order is per-pet)
    /** Element spread, biggest group first (skips null/"None"). */
    elements: { element: string; count: number }[];
}

const round = (n: number) => Math.round(n);

/** Pool a squad's stats + element spread for the team stat column. */
export function teamStatTotals(pets: Pet[]): TeamStatTotals {
    const count = pets.length;
    let hp = 0, attack = 0, defense = 0, speed = 0;
    const elementCounts = new Map<string, number>();
    for (const p of pets) {
        hp += p.hp || 0;
        attack += p.attack || 0;
        defense += p.defense || 0;
        speed += p.speed || 0;
        const el = p.element;
        if (el && el !== "None") elementCounts.set(el, (elementCounts.get(el) ?? 0) + 1);
    }
    const elements = [...elementCounts.entries()]
        .map(([element, c]) => ({ element, count: c }))
        .sort((a, b) => b.count - a.count || a.element.localeCompare(b.element));
    return {
        count,
        hp: round(hp), attack: round(attack), defense: round(defense), speed: round(speed),
        defenseAvg: count ? round(defense / count) : 0,
        speedAvg: count ? round(speed / count) : 0,
        elements,
    };
}

/**
 * Net elemental edge of `attackers` against `defenders`: the mean outgoing
 * element multiplier across every attacker→defender pairing (mirrors the board
 * sim's per-hit `elementMult`). 1 = neutral, >1 = your elements counter theirs,
 * <1 = you're countered. Returns 1 when either side is empty.
 */
export function elementalEdge(attackers: Pet[], defenders: Pet[]): number {
    if (!attackers.length || !defenders.length) return 1;
    let sum = 0, pairs = 0;
    for (const a of attackers) {
        for (const d of defenders) { sum += elementMult(a.element, d.element); pairs++; }
    }
    return pairs ? sum / pairs : 1;
}
