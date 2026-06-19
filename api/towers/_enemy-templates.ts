/*
 * Battle Towers — server-side enemy stat templates (Phase 1, P1.B).
 *
 * Pure data: an aiId → base combat stats for the floor catalog's enemy pods / bosses /
 * npcs. The encounter builder (_encounter.ts) instantiates + party-scales these into
 * TowerActors. v1 grunts fight with basic attacks (no jutsu kit); the boss is a high-HP
 * bruiser. Phase 1b will resolve richer kits from the shared AI catalog; these hand-tuned
 * templates keep the encounter builder self-contained and deterministic for now.
 *
 * Every aiId referenced by api/towers/_floor-catalog.ts MUST have a template here — the
 * catalog test cross-checks this so a floor can't reference a missing enemy.
 */
export type EnemySpecialty = 'Taijutsu' | 'Bukijutsu' | 'Genjutsu' | 'Ninjutsu';

export type EnemyTemplate = {
    name: string;
    specialty: EnemySpecialty;
    hp: number;
    stats: Record<string, number>;
};

const TEMPLATES: Record<string, EnemyTemplate> = {
    'grunt-bandit': {
        name: 'Bandit', specialty: 'Taijutsu', hp: 500,
        stats: { taijutsuOffense: 600, taijutsuDefense: 500, strength: 200, speed: 200 },
    },
    'grunt-archer': {
        name: 'Archer', specialty: 'Bukijutsu', hp: 450,
        stats: { bukijutsuOffense: 650, bukijutsuDefense: 400, intelligence: 200, strength: 150 },
    },
    'grunt-blocker': {
        name: 'Blocker', specialty: 'Taijutsu', hp: 800,
        stats: { taijutsuOffense: 400, taijutsuDefense: 800, strength: 300, speed: 100 },
    },
    'boss-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', hp: 3000,
        stats: { ninjutsuOffense: 1200, ninjutsuDefense: 900, willpower: 400, speed: 300 },
    },
    'npc-genin': {
        name: 'Allied Genin', specialty: 'Taijutsu', hp: 400,
        stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
    },
};

// Defensive fallback so a misconfigured aiId yields a weak grunt rather than crashing
// the encounter build (the catalog validator + test are the real guard).
const FALLBACK: EnemyTemplate = {
    name: 'Shade', specialty: 'Taijutsu', hp: 300,
    stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
};

export function getEnemyTemplate(aiId: string): EnemyTemplate {
    return TEMPLATES[aiId] ?? FALLBACK;
}

export function hasEnemyTemplate(aiId: string): boolean {
    return Object.prototype.hasOwnProperty.call(TEMPLATES, aiId);
}

export const ENEMY_TEMPLATE_IDS: readonly string[] = Object.keys(TEMPLATES);
