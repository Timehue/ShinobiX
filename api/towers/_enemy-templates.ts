/*
 * Battle Towers — server-side enemy stat templates (Phase 1, P1.B).
 *
 * Pure data: an aiId → base combat stats for the floor catalog's enemy pods / bosses /
 * npcs. The encounter builder (_encounter.ts) instantiates + party-scales these into
 * TowerActors. v1 grunts fight with basic attacks (no jutsu kit); bosses are high-HP
 * bruisers. Phase 1b will resolve richer kits from the shared AI catalog; these hand-tuned
 * templates keep the encounter builder self-contained and deterministic for now.
 *
 * `visual` is an opaque sprite key the client maps to enemy art (BattleTowerFight); it
 * never affects combat. `boss: true` marks the big units the client renders larger.
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
    /**
     * Rank-band level for the per-rank STAT CAP (api/pvp/move.ts perRankStatCap):
     * tower combat routes through applyJutsu, which clamps each fighter's stats to
     * statCapForLevel(level). REQUIRED so a template's hand-tuned stats are never
     * silently gutted to the Academy ceiling (350) by a missing level. Set so the
     * band cap ≥ the template's biggest stat: grunts are Chunin (cap 1300 ≥ their
     * ≤850), bosses are Special Jonin (80+ = uncapped) for their ≤1500.
     */
    level: number;
    /** client sprite key (cosmetic; never touches combat math) */
    visual: string;
    /** the client renders bosses larger + with a phase ring */
    boss?: boolean;
};

const TEMPLATES: Record<string, EnemyTemplate> = {
    'grunt-bandit': {
        name: 'Bandit', specialty: 'Taijutsu', level: 40, hp: 500, visual: 'bandit',
        stats: { taijutsuOffense: 600, taijutsuDefense: 500, strength: 200, speed: 200 },
    },
    'grunt-archer': {
        name: 'Archer', specialty: 'Bukijutsu', level: 40, hp: 450, visual: 'archer',
        stats: { bukijutsuOffense: 650, bukijutsuDefense: 400, intelligence: 200, strength: 150 },
    },
    'grunt-blocker': {
        name: 'Shieldman', specialty: 'Taijutsu', level: 40, hp: 850, visual: 'blocker',
        stats: { taijutsuOffense: 400, taijutsuDefense: 850, strength: 300, speed: 100 },
    },
    'grunt-brute': {
        name: 'Brute', specialty: 'Taijutsu', level: 40, hp: 950, visual: 'brute',
        stats: { taijutsuOffense: 800, taijutsuDefense: 600, strength: 400, speed: 120 },
    },
    'grunt-acolyte': {
        name: 'Acolyte', specialty: 'Ninjutsu', level: 40, hp: 420, visual: 'acolyte',
        stats: { ninjutsuOffense: 750, ninjutsuDefense: 350, willpower: 250, intelligence: 200 },
    },
    'boss-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', level: 80, hp: 4200, visual: 'warden', boss: true,
        stats: { ninjutsuOffense: 1200, ninjutsuDefense: 950, willpower: 450, speed: 300 },
    },
    'boss-ravager': {
        name: 'Pit Ravager', specialty: 'Taijutsu', level: 80, hp: 4800, visual: 'ravager', boss: true,
        stats: { taijutsuOffense: 1300, taijutsuDefense: 1000, strength: 500, speed: 260 },
    },
    'boss-revenant': {
        name: 'Hollow Revenant', specialty: 'Genjutsu', level: 80, hp: 5200, visual: 'revenant', boss: true,
        stats: { genjutsuOffense: 1300, genjutsuDefense: 1050, willpower: 500, intelligence: 350 },
    },
    'boss-sovereign': {
        name: 'Spire Sovereign', specialty: 'Ninjutsu', level: 80, hp: 6200, visual: 'sovereign', boss: true,
        stats: { ninjutsuOffense: 1500, ninjutsuDefense: 1150, willpower: 550, speed: 350 },
    },
    'npc-genin': {
        name: 'Allied Genin', specialty: 'Taijutsu', level: 40, hp: 600, visual: 'genin',
        stats: { taijutsuOffense: 350, taijutsuDefense: 350 },
    },
};

// Defensive fallback so a misconfigured aiId yields a weak grunt rather than crashing
// the encounter build (the catalog validator + test are the real guard).
const FALLBACK: EnemyTemplate = {
    name: 'Shade', specialty: 'Taijutsu', level: 40, hp: 300, visual: 'bandit',
    stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
};

export function getEnemyTemplate(aiId: string): EnemyTemplate {
    return TEMPLATES[aiId] ?? FALLBACK;
}

export function hasEnemyTemplate(aiId: string): boolean {
    return Object.prototype.hasOwnProperty.call(TEMPLATES, aiId);
}

export const ENEMY_TEMPLATE_IDS: readonly string[] = Object.keys(TEMPLATES);
