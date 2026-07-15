import type { CombatMissionDef } from './missions/_mission-catalog.js';
import { sealTowerFighter, sealTowerItemCharges } from './towers/_seal.js';
import { buildTowerEncounter, type SquadMemberInput } from './towers/_encounter.js';
import type { EnemySpecialty, EnemyTemplate } from './towers/_enemy-templates.js';
import type { TowerFloor } from './towers/_floor-catalog.js';
import { startRound, runAiUntilHuman } from './towers/_engine.js';
import { makeRng } from './towers/_sim.js';
import { stampTurnClock } from './towers/_tower-mp.js';
import type { TowerSession } from './towers/_tower-session.js';

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

export function missionEnemyTemplate(def: CombatMissionDef): EnemyTemplate {
    const index = Math.max(0, ['combat-e-drill', 'combat-d-errand', 'combat-c-patrol', 'combat-b-escort', 'combat-a-hunt', 'combat-s-crisis'].indexOf(def.key));
    const level = MISSION_LEVELS[def.key] ?? Math.max(1, def.min);
    const specialty = specialtyForIndex(index);
    const offense = clampInt(150 + level * 27, 180, 2600, 500);
    const defense = clampInt(120 + level * 20, 140, 2100, 400);
    return {
        name: MISSION_NAMES[def.key] ?? 'Mission Opponent',
        specialty,
        level,
        hp: clampInt(240 + level * level * 1.05, 250, 8500, 1000),
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
        maxChakra: 120 + level * 4,
        maxStamina: 120 + level * 4,
        jutsu: genericEnemyJutsu(level, specialty, def.key),
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
    const prefix = params.kind === 'boss' ? 'Hollow Gate Warden' : params.kind === 'ambush' ? 'Hollow Gate Ambush' : params.kind === 'beast' ? 'Hollow Beast' : params.kind === 'elite' ? 'Elite Corrupted Shinobi' : 'Corrupted Shinobi';
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

export function dynamicBossFloor(params: {
    id: number;
    name: string;
    bossAiId: string;
    objective?: 'defeat-boss' | 'survive';
    roundBudget?: number;
    biome?: TowerFloor['biome'];
}): TowerFloor {
    return {
        id: params.id,
        name: params.name,
        biome: params.biome ?? 'central',
        objective: params.objective ?? 'defeat-boss',
        roundBudget: params.roundBudget ?? 20,
        map: { width: 12, height: 10 },
        fieldRule: { kind: 'none' },
        enemies: [],
        boss: { aiId: params.bossAiId },
        balanceFor: 1,
        firstClearReward: {},
    };
}

export function buildAuthoritativeSoloEncounter(params: {
    playerName: string;
    save: Record<string, unknown>;
    floor: TowerFloor;
    bossTemplate: EnemyTemplate;
    runId: string;
    seed: number;
    now: number;
    towerId: string;
    hostLoadout?: Record<string, unknown>;
}): TowerSession {
    const char = params.save.character as Record<string, unknown>;
    const squad: SquadMemberInput[] = [{
        id: 'sq-0',
        name: String(char.name ?? params.playerName),
        ownerSlug: params.playerName,
        ai: false,
        character: sealTowerFighter(char, params.save, params.hostLoadout ?? {}),
        itemCharges: sealTowerItemCharges(char),
    }];
    const session = buildTowerEncounter({
        floor: params.floor,
        squad,
        runId: params.runId,
        seed: params.seed,
        partySize: 1,
        now: params.now,
        bossTemplate: params.bossTemplate,
        embedFloor: true,
        towerId: params.towerId,
    });
    startRound(session);
    runAiUntilHuman(session, params.floor, makeRng(params.seed));
    stampTurnClock(session, params.now);
    return session;
}
