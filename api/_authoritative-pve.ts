import type { CombatMissionDef } from './missions/_mission-catalog.js';
import type { EnemySpecialty, EnemyTemplate } from './towers/_enemy-templates.js';
import type { TowerFloor } from './towers/_floor-catalog.js';
import type { ServerAiRule } from './combat-core/ai-authoring.js';
import { AUTHORED_MISSION_KITS } from './missions/_authored-mission-kits.js';

/**
 * A mission template that carries an AUTHORED kit instead of the generic
 * signature: real starter-catalog jutsu ids (resolved by
 * api/_ai-opponent-loadout.ts) plus a rule program for the shared authored-AI
 * runner. `buildEnemy` (api/solo-pve/_ai-encounter.ts) prefers an embedded
 * `jutsu` list, so a kit template deliberately leaves `jutsu` undefined.
 */
export type MissionEnemyTemplate = EnemyTemplate & {
    jutsuIds?: string[];
    rules?: ServerAiRule[];
    missionTactics?: true;
    missionJutsuDescriptions?: Record<string, string>;
};

const MISSION_NAMES: Record<string, string> = {
    'combat-e-drill': 'Academy Sparring Partner',
    'combat-d-errand': 'Mist Sentinel',
    'combat-c-patrol': 'Ember Duelist',
    'combat-b-escort': 'Frost Sealer',
    'combat-a-hunt': 'Shadow Weaver',
    'combat-s-crisis': 'Central Champion',
};

const MISSION_LEVELS: Record<string, number> = {
    'combat-e-drill': 3,
    'combat-d-errand': 8,
    'combat-c-patrol': 18,
    'combat-b-escort': 35,
    'combat-a-hunt': 55,
    'combat-s-crisis': 75,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function specialtyForIndex(index: number): EnemySpecialty {
    return (['Taijutsu', 'Bukijutsu', 'Ninjutsu', 'Genjutsu'] as const)[Math.abs(index) % 4]!;
}

function genericEnemyJutsu(level: number, specialty: EnemySpecialty, prefix: string) {
    const power = clampInt(22 + level * 0.55, 24, 72, 35);
    return [{
        id: `${prefix}-signature`,
        name: `${specialty} Signature`,
        type: specialty,
        element: 'None',
        ap: 60,
        range: specialty === 'Taijutsu' ? 1 : 3,
        effectPower: power,
        chakraCost: specialty === 'Taijutsu' || specialty === 'Bukijutsu' ? 0 : 18,
        staminaCost: specialty === 'Taijutsu' || specialty === 'Bukijutsu' ? 18 : 0,
        cooldown: 2,
        method: 'SINGLE',
    }];
}

/*
 * ── First-fight teaching kits ──────────────────────────────────────────────
 * The E-Rank Drill and D-Rank Errand are a brand-new shinobi's second and
 * fourth authored fights (docs/first-five-fights-onboarding.md). The generic
 * one-move template dies to a single 60 AP cast (measured ~395 damage from a
 * fresh level-1 kit against its ~190 banded HP), so it could not show the
 * player anything. These two keys instead carry REAL starter-catalog jutsu and
 * a program for the shared authored-AI runner, each built around ONE idea:
 *
 *   - combat-e-drill: a kunai thrower who holds at four tiles, hexes the
 *     player's strikes with a 40 AP move (Decrease Damage Given), and only
 *     commits its 60 once the easy band releases burst moves (round 3).
 *     Teaches range, positioning, and that a cheap move can change a fight.
 *   - combat-d-errand: a sentinel whose 40 AP net poisons the player before
 *     its heavy cast. Under combatResourcesV2 poison taxes chakra spend, so the
 *     player's own heavy casts bite back: a status worth reading, and one that
 *     Cleanse answers. Teaches that a turn is not only about damage.
 *
 * Both stand off at range and answer with a basic attack only when the player
 * closes to melee, so walking in is a real trade rather than free. HP is set so
 * a fresh rookie needs two rounds after the approach (and the stat-10 express
 * e2e fixture, seeded at 450 of its normalized 500 HP, still wins on basic
 * attacks alone with 150 HP to spare). The easy-band hit caps and mercy floor (api/_pve-difficulty.ts)
 * keep both fights unloseable from full HP. C-Rank and above have separate
 * mission-local programs in missions/_authored-mission-kits.ts.
 *
 * Kit enemies also get a level-1-player-sized resource pool (1,000): starter
 * jutsu cost 125/250, and the generic template's 120 + level x 4 pool could
 * afford the opener once and never the heavy cast (its own signature costs 18).
 */
const FIRST_FIGHT_KIT_POOL = 1_000;
const STANDOFF_RULES = (opener: { jutsuId: string; status: string; side: 'player' | 'self' }): ServerAiRule[] => [
    // Open with the teaching move, and reapply it whenever its mark has lapsed
    // (its 7-round cooldown means at most twice in a typical fight).
    { condition: opener.side === 'self' ? 'self_status_absent' : 'player_status_absent', value: 0, status: opener.status, action: 'use_specific_jutsu', jutsuId: opener.jutsuId },
    // The heavy cast, once the easy band lets it out (round 3) and it is in range.
    { condition: 'always', value: 0, action: 'use_highest_power_jutsu' },
    // Only a player standing next to it gets punched.
    { condition: 'distance_lower_than', value: 2, action: 'use_basic_attack' },
    // Close to casting range, then hold there.
    { condition: 'distance_higher_than', value: 4, action: 'move_towards_opponent' },
    { condition: 'always', value: 0, action: 'end_turn' },
    // Required unconditional fallback (validateServerAiRules); unreachable in
    // practice because the hold above ends the turn first.
    { condition: 'always', value: 0, action: 'use_basic_attack' },
];

export const FIRST_FIGHT_MISSION_KITS: Record<string, { specialty: EnemySpecialty; hp: number; jutsuIds: string[]; rules: ServerAiRule[] }> = {
    'combat-e-drill': {
        specialty: 'Bukijutsu',
        // x0.75 easy band -> 600 effective: two rookie rounds after the approach.
        hp: 800,
        // Stone Kunai Rain (40 AP: Increase Heal on self + Decrease Damage Given
        // on the player) and Torrent Chain Slash (60 AP, Siphon), both range 4.
        jutsuIds: ['starter-buki-earth-1', 'starter-buki-water-2'],
        rules: STANDOFF_RULES({ jutsuId: 'starter-buki-earth-1', status: 'Decrease Damage Given', side: 'player' }),
    },
    'combat-d-errand': {
        specialty: 'Genjutsu',
        // x0.75 -> 1050 effective: about three rookie rounds at level 5.
        hp: 1400,
        // Gale Net Snare (40 AP: Poison + Increase Damage Taken on the player)
        // and Buried Memory Field (60 AP, Siphon), both range 4.
        jutsuIds: ['starter-nin-wind-3', 'starter-gen-earth-2'],
        rules: STANDOFF_RULES({ jutsuId: 'starter-nin-wind-3', status: 'Poison', side: 'player' }),
    },
};

export function missionEnemyTemplate(def: CombatMissionDef): MissionEnemyTemplate {
    const index = Math.max(0, ['combat-e-drill', 'combat-d-errand', 'combat-c-patrol', 'combat-b-escort', 'combat-a-hunt', 'combat-s-crisis'].indexOf(def.key));
    const level = MISSION_LEVELS[def.key] ?? Math.max(1, def.min);
    const kit = FIRST_FIGHT_MISSION_KITS[def.key];
    const authored = AUTHORED_MISSION_KITS[def.key];
    const specialty = kit?.specialty ?? specialtyForIndex(index);
    const offense = clampInt(150 + level * 27, 180, 2600, 500);
    const defense = clampInt(120 + level * 20, 140, 2100, 400);
    return {
        name: MISSION_NAMES[def.key] ?? 'Mission Opponent',
        specialty,
        level,
        hp: kit?.hp ?? clampInt(240 + level * level * 1.05, 250, 8500, 1000),
        stats: {
            [`${specialty.toLowerCase()}Offense`]: offense,
            [`${specialty.toLowerCase()}Defense`]: defense,
            strength: clampInt(80 + level * 8, 80, 900, 200),
            speed: clampInt(80 + level * 7, 80, 850, 200),
            intelligence: clampInt(80 + level * 7, 80, 850, 200),
            willpower: clampInt(80 + level * 7, 80, 850, 200),
        },
        visual: def.aiProfileId,
        boss: true,
        armorRawDR: index >= 4 ? 0.15 : index >= 2 ? 0.08 : 0,
        maxChakra: authored?.maxChakra ?? (kit ? FIRST_FIGHT_KIT_POOL : 120 + level * 4),
        maxStamina: authored?.maxStamina ?? (kit ? FIRST_FIGHT_KIT_POOL : 120 + level * 4),
        ...(authored
            ? { jutsuIds: [...authored.jutsuIds], rules: authored.rules.map(rule => ({ ...rule })), missionTactics: true as const, missionJutsuDescriptions: { ...authored.descriptions } }
            : kit
            ? { jutsuIds: [...kit.jutsuIds], rules: kit.rules.map((rule) => ({ ...rule })) }
            : { jutsu: genericEnemyJutsu(level, specialty, def.key) }),
    };
}

export function hollowGateEnemyTemplate(params: {
    playerLevel: number;
    floor: number;
    maxFloor?: number;
    kind: 'battle' | 'elite' | 'ambush' | 'beast' | 'boss';
    profileId: string;
    displayName?: string;
    combatEffect?: { kind?: string; value?: number };
    petLevel?: number;
    gentleNonBoss?: boolean;
}): EnemyTemplate {
    const floor = clampInt(params.floor, 1, 9, 1);
    const maxFloor = clampInt(params.maxFloor, 1, 9, 5);
    const boss = params.kind === 'boss';
    const elite = params.kind === 'elite';
    const bossProgress = maxFloor <= 1 ? 1 : Math.max(0, Math.min(1, (floor - 1) / (maxFloor - 1)));
    const levelOffset = boss ? Math.round(-5 + bossProgress * 20) : 0;
    const level = clampInt(params.playerLevel + levelOffset, 1, 100, params.playerLevel);
    const specialty = specialtyForIndex(floor + ['battle', 'elite', 'ambush', 'beast', 'boss'].indexOf(params.kind));
    const effectKind = String(params.combatEffect?.kind ?? '');
    const effectValue = Math.max(0, Math.min(1, Number(params.combatEffect?.value) || 0));
    const augmentHpMult = effectKind === 'enemyPower' ? 1 + effectValue : 1;
    const augmentStatMult = effectKind === 'enemyPower' ? 1 + effectValue : effectKind === 'roleShield' ? Math.max(0.5, 1 - effectValue) : 1;
    const augmentShave = effectKind === 'damageBonus' ? effectValue / (1 + effectValue)
        : effectKind === 'chainHit' ? 0.15
            : effectKind === 'lifesteal' ? effectValue : 0;
    const petBond = params.petLevel == null ? 0 : Math.min(1.5, Math.max(0.5, Number(params.petLevel) / 10));
    const petShave = petBond * (boss ? 0.10 : 0.15);
    const totalHpShave = Math.min(0.9, augmentShave + petShave);
    const gentleMult = params.gentleNonBoss && !boss ? 0.9 : 1;
    const depthHp = boss ? 1 + bossProgress * 0.4 : 1 + Math.max(0, floor - 1) * 0.06;
    const depthStats = boss ? 1.18 : 1 + Math.max(0, floor - 1) * 0.035;
    const kindHp = elite ? 1.3 : params.kind === 'ambush' ? 1.08 : params.kind === 'beast' ? 1.15 : 1;
    const kindStats = elite ? 1.1 : params.kind === 'ambush' ? 1.04 : params.kind === 'beast' ? 1.06 : 1;
    const offense = clampInt((150 + level * 27) * depthStats * kindStats * augmentStatMult * gentleMult, 180, 3600, 500);
    const defense = clampInt((120 + level * 20) * depthStats * kindStats * augmentStatMult * gentleMult, 140, 3000, 400);
    const prefix = params.kind === 'boss' ? 'Hollow Hound Alpha' : params.kind === 'elite' ? 'Elite Hollow Hound' : params.kind === 'ambush' ? 'Ambushing Hollow Hound' : 'Hollow Hound';
    return {
        name: params.displayName || prefix,
        specialty,
        level,
        hp: clampInt((240 + level * level * 1.05) * depthHp * kindHp * augmentHpMult * gentleMult * (1 - totalHpShave), 1, 18_000, 1000),
        stats: {
            [`${specialty.toLowerCase()}Offense`]: offense,
            [`${specialty.toLowerCase()}Defense`]: defense,
            strength: clampInt((80 + level * 8) * depthStats * augmentStatMult * gentleMult, 80, 1500, 200),
            speed: clampInt((80 + level * 7) * depthStats * augmentStatMult * gentleMult, 80, 1400, 200),
            intelligence: clampInt((80 + level * 7) * depthStats * augmentStatMult * gentleMult, 80, 1400, 200),
            willpower: clampInt((80 + level * 7) * depthStats * augmentStatMult * gentleMult, 80, 1400, 200),
        },
        visual: params.profileId,
        boss: true,
        armorRawDR: boss ? 0.18 : elite ? 0.1 : 0.04,
        maxChakra: 120 + level * 4,
        maxStamina: 120 + level * 4,
        jutsu: genericEnemyJutsu(level, specialty, params.profileId),
    };
}

export function weeklyBossEnemyTemplate(profile: Record<string, unknown> | null | undefined, fallback: { id: string; name?: string }): EnemyTemplate {
    const level = clampInt(profile?.level, 30, 100, 70);
    const stats = profile?.stats && typeof profile.stats === 'object' ? profile.stats as Record<string, unknown> : {};
    const axes: Array<[EnemySpecialty, string]> = [
        ['Taijutsu', 'taijutsuOffense'],
        ['Bukijutsu', 'bukijutsuOffense'],
        ['Ninjutsu', 'ninjutsuOffense'],
        ['Genjutsu', 'genjutsuOffense'],
    ];
    const specialty = axes.sort((a, b) => Number(stats[b[1]] ?? 0) - Number(stats[a[1]] ?? 0))[0]?.[0] ?? 'Ninjutsu';
    const offense = clampInt(stats[`${specialty.toLowerCase()}Offense`], 700, 3200, 1700);
    const defense = clampInt(stats[`${specialty.toLowerCase()}Defense`], 500, 2800, 1400);
    return {
        name: typeof profile?.name === 'string' ? profile.name.slice(0, 80) : (fallback.name ?? 'Weekly Boss'),
        specialty,
        level,
        // This is a score attack. The boss survives until the server round cap or player wipe.
        hp: 99_999_999,
        stats: {
            [`${specialty.toLowerCase()}Offense`]: offense,
            [`${specialty.toLowerCase()}Defense`]: defense,
            strength: clampInt(stats.strength, 300, 1400, 700),
            speed: clampInt(stats.speed, 250, 1200, 600),
            intelligence: clampInt(stats.intelligence, 300, 1400, 700),
            willpower: clampInt(stats.willpower, 300, 1400, 700),
        },
        visual: fallback.id,
        boss: true,
        armorRawDR: Math.max(0.12, Math.min(0.35, Number(profile?.armorRawDR ?? 0.18))),
        maxChakra: 1200,
        maxStamina: 1200,
        jutsu: genericEnemyJutsu(level, specialty, `weekly-${fallback.id}`),
    };
}

// Per-mission battlefield theme: the biome drives the board art AND the shared
// +10% school-vs-biome terrain buff (already wired in the resolver); the optional
// weather adds the ±element outgoing-damage term via the engine's wMult junction.
// Themed to each mission's home (Ember Duelist → volcano, Frost Sealer → snow, …).
// Both apply symmetrically to player and foe, exactly like the Arena's terrain.
const MISSION_BIOME: Record<string, TowerFloor['biome']> = {
    'combat-e-drill': 'central',
    'combat-d-errand': 'forest',
    'combat-c-patrol': 'volcano',
    'combat-b-escort': 'snow',
    'combat-a-hunt': 'shadow',
    'combat-s-crisis': 'central',
};
const MISSION_WEATHER: Record<string, { positiveElement: string; negativeElement: string }> = {
    'combat-d-errand': { positiveElement: 'Wind', negativeElement: 'Lightning' },
    'combat-c-patrol': { positiveElement: 'Fire', negativeElement: 'Water' },
    'combat-b-escort': { positiveElement: 'Water', negativeElement: 'Fire' },
    'combat-a-hunt': { positiveElement: 'Lightning', negativeElement: 'Earth' },
    // e-drill (training grounds) and s-crisis (central arena) stay clear.
};

export function missionEnvironment(missionKey: string): {
    biome: TowerFloor['biome'];
    weather?: { positiveElement: string; negativeElement: string };
} {
    return { biome: MISSION_BIOME[missionKey] ?? 'central', weather: MISSION_WEATHER[missionKey] };
}
