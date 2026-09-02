/**
 * Level-aware PvP balance certification.
 *
 * Unlike the older formula sandbox, this runner delegates damage, tags,
 * status timing, mastery caps, rank caps, DoTs, shields, and timeout scoring to
 * the live PvP implementation.  It builds creator-legal A/B bloodlines, fills
 * the normal 12-slot technique entitlement, equips level-legal gear, allocates
 * the player's earned stat budget, and runs every unordered build pairing in
 * both seat assignments and with both possible round openers.
 *
 * Run: node --import tsx scripts/pvp-level-balance-sim.ts
 */

import { basename } from 'node:path';
import { normalizePlayerBloodlineJutsus } from '../api/bloodlines/_jutsu-schema.js';
import { bloodlinePoints, pointBudgetForRank } from '../api/_jutsu-points.js';
import { COMBAT_RESOURCES_V2, v2JutsuCosts, v2PoisonOnSpend, v2ResourceRegen } from '../api/_combat-resources.js';
import { LOADOUT_CAP_BASE, LOADOUT_CAP_SUB } from '../api/_entitlements.js';
import {
    earnedForLevel,
    maxChakraForLevel,
    maxHpForLevel,
    maxStaminaForLevel,
    MAX_LEVEL,
    MAX_STAT,
    STAT_KEYS,
} from '../api/_xp-engine.js';
import {
    JUTSU_MAX_LEVEL,
    STUN_AP_PENALTY,
    jutsuLevelCapForLevel,
    statCapForLevel,
} from '../api/combat-core/formulas.js';
import { GRID_H, GRID_W, MAX_ACTIONS, MAX_ROUNDS } from '../api/combat-core/constants.js';
import { tickCombatCooldowns } from '../api/combat-core/cooldowns.js';
import { adjustedApCost } from '../api/combat-core/resources.js';
import { hexDistance, hexNeighbors, nextStepToward } from '../api/combat-core/grid.js';
import {
    activeCombatStatuses,
    removeActiveCombatStatusesByKind,
    removeActiveCombatStatusesByName,
    sumActiveCombatStatusPercent,
} from '../api/combat-core/statuses.js';
import {
    createCanonicalGroundEffect,
    resolveJutsuActionPlan,
    type JutsuActionPlan,
} from '../api/combat-core/resolve-jutsu-action.js';
import type { CombatJutsu, CombatStatus, CombatTag } from '../api/combat-core/types.js';
import {
    CANONICAL_TAG_NAMES,
    canonicalTagName,
    COPY_EXCLUDED_BUFFS,
    OPPONENT_AFFECTING_TAGS,
    REQUIRES_DAMAGE_TAGS,
    STACKABLE_STATUS,
} from '../api/pvp/_tags.js';
import { ITEM_CATALOG, type CatalogItem } from '../api/pvp/_item-catalog.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { deriveCombatMultipliers, deriveEquipmentStatBonuses } from '../api/pvp/_multipliers.js';
import { pvpSessionHp } from '../api/pvp/_low-level-hp.js';
import {
    applyDoTs,
    applyGroundEffectToFighter,
    applyJutsu,
    pvpNormalizedEffectiveHealth,
    tickGroundEffects,
    tickStatuses,
} from '../api/pvp/move.js';
import {
    normalizeHumanPvpLoadout,
    P1_START,
    P2_START,
    type PvpFighter,
    type PvpGroundEffect,
} from '../api/pvp/session.js';
import { effectiveItemLevelReq, meetsItemLevelReq } from '../shared/item-level-gate.js';

export type BloodlineRank = 'A Rank' | 'B Rank';
export type Seat = 'p1' | 'p2';
export type Archetype =
    | 'Burst'
    | 'Sustain'
    | 'Control'
    | 'Prevention'
    | 'Tempo'
    | 'Disruption'
    | 'Counter'
    | 'Ground';
export type Discipline = 'Ninjutsu' | 'Genjutsu' | 'Taijutsu' | 'Bukijutsu';

export const ARCHETYPES: readonly Archetype[] = [
    'Burst', 'Sustain', 'Control', 'Prevention',
    'Tempo', 'Disruption', 'Counter', 'Ground',
];
export const BLOODLINE_RANKS: readonly BloodlineRank[] = ['A Rank', 'B Rank'];
export const TEST_LEVELS = [10, 25, 50, 80, 100] as const;

const FULL_LOADOUT_SIZE = LOADOUT_CAP_BASE;
const AP_PER_TURN = 100;
const BASIC_HEAL_COOLDOWN = 5;
const CLEANUP_COOLDOWN = 10;
const FAIR_ARCHETYPE_LOW = 0.40;
const FAIR_ARCHETYPE_HIGH = 0.60;
const FAIR_INITIATIVE_LOW = 0.45;
const FAIR_INITIATIVE_HIGH = 0.55;

const PROFILE: Record<Archetype, { discipline: Discipline; element: string; set: string; namedSpecial: string; weaponTags: CombatTag[] }> = {
    Burst:      { discipline: 'Ninjutsu',  element: 'Fire',      set: 'legendary', namedSpecial: 'damagePercent',    weaponTags: [{ name: 'Increase Damage Given', percent: 40 }] },
    Sustain:    { discipline: 'Genjutsu',  element: 'Water',     set: 'crimson',   namedSpecial: 'lifeStealPercent', weaponTags: [{ name: 'Siphon', percent: 40 }] },
    Control:    { discipline: 'Genjutsu',  element: 'Lightning', set: 'ironwall',  namedSpecial: 'shield',           weaponTags: [{ name: 'Drain', percent: 40 }] },
    Prevention: { discipline: 'Taijutsu',  element: 'Earth',     set: 'bulwark',   namedSpecial: 'absorbPercent',    weaponTags: [{ name: 'Decrease Damage Taken', percent: 40 }] },
    Tempo:      { discipline: 'Taijutsu',  element: 'Wind',      set: 'legendary', namedSpecial: 'damagePercent',    weaponTags: [{ name: 'Increase Generals', percent: 40 }] },
    // Elemental Cores can attune weapons only to the five awakened base
    // elements. Using Shadow here made the simulator synthesize an impossible
    // bloodline-boosted weapon, so Disruption uses a legal Lightning profile.
    Disruption: { discipline: 'Bukijutsu', element: 'Lightning', set: 'mirror',    namedSpecial: 'reflectPercent',   weaponTags: [{ name: 'Ignition', percent: 40 }] },
    Counter:    { discipline: 'Bukijutsu', element: 'Water',     set: 'bulwark',   namedSpecial: 'absorbPercent',    weaponTags: [{ name: 'Reflect', percent: 40 }] },
    Ground:     { discipline: 'Ninjutsu',  element: 'Earth',     set: 'legendary', namedSpecial: 'damagePercent',    weaponTags: [{ name: 'Poison', percent: 40 }] },
};

type SimJutsu = CombatJutsu & {
    id: string;
    name: string;
    type: string;
    tags: CombatTag[];
    /** Live weapon-only resolver input; ordinary jutsu leave it undefined. */
    suppressBloodline?: boolean;
};

export type BuildTemplate = {
    id: string;
    name: string;
    archetype: Archetype;
    /** Legal gear/stat/discipline construction, independent of bloodline role. */
    profileArchetype: Archetype;
    bloodlineRank: BloodlineRank;
    level: number;
    fullyCapped: boolean;
    namedGear: boolean;
    loadoutSize: number;
    earnedStats: number | 'all-capped';
    discipline: Discipline;
    jutsu: SimJutsu[];
    weapon: CatalogItem;
    equipmentIds: string[];
    fighter: PvpFighter;
};

type BattleState = {
    p1: PvpFighter;
    p2: PvpFighter;
    cooldowns: Record<Seat, Record<string, number>>;
    groundEffects: PvpGroundEffect[];
    round: number;
    opener: Seat;
    tagAttempts: Record<string, number>;
    tagApplied: Record<string, number>;
    tagBlockedOrEmpty: Record<string, number>;
    groundTagPending: Record<string, string[]>;
    actionCounts: Record<string, number>;
};

type SimAction =
    | { kind: 'jutsu'; jutsu: SimJutsu; plan: JutsuActionPlan }
    | { kind: 'weapon'; jutsu: SimJutsu; apCost: number; cooldownKey: string; cooldown: number }
    | { kind: 'cleanse'; apCost: number }
    | { kind: 'clear'; apCost: number }
    | { kind: 'basicHeal'; apCost: number }
    | { kind: 'basicAttack'; jutsu: SimJutsu; apCost: number }
    | { kind: 'move'; tile: number; apCost: number }
    | { kind: 'pass' };

export type FightResult = {
    winner: Seat | 'draw';
    rounds: number;
    timeout: boolean;
    opener: Seat;
    p1Health: number;
    p2Health: number;
    p1Chakra: number;
    p1Stamina: number;
    p2Chakra: number;
    p2Stamina: number;
    tagAttempts: Record<string, number>;
    tagApplied: Record<string, number>;
    tagBlockedOrEmpty: Record<string, number>;
    actionCounts: Record<string, number>;
};

export type Tally = { wins: number; losses: number; draws: number; games: number };
export type LevelBalanceReport = {
    level: number;
    label: string;
    rosterSize: number;
    totalFights: number;
    draws: number;
    timeouts: number;
    totalRounds: number;
    roundP10: number;
    roundMedian: number;
    roundP90: number;
    earlyKos: number;
    seats: Record<Seat, Tally>;
    opener: Tally;
    ranks: Record<BloodlineRank, Tally>;
    rankCross: Record<BloodlineRank, Tally>;
    archetypes: Record<Archetype, Tally>;
    matchups: Record<Archetype, Record<Archetype, Tally>>;
    builds: Record<string, Tally>;
    tagCasts: Record<string, number>;
    tagAttempts: Record<string, number>;
    tagApplied: Record<string, number>;
    tagBlockedOrEmpty: Record<string, number>;
    availableTags: string[];
    uncastAvailableTags: string[];
    unappliedAvailableTags: string[];
    actionCounts: Record<string, number>;
    gearSummary: string;
    statCap: number;
    masteryCap: number;
    earnedStats: number | 'all-capped';
    loadoutSize: number;
    namedGear: boolean;
    resources: {
        meanChakra: number;
        meanStamina: number;
        chakraBelowTenPct: number;
        staminaBelowTenPct: number;
    };
    issues: string[];
};

export type BalanceCertification = {
    generatedAt: string;
    engine: string;
    levels: LevelBalanceReport[];
    issues: string[];
};

export type CompetitiveProfileRotationLevelReport = {
    level: number;
    label: string;
    profiles: Array<{ profile: Archetype; report: LevelBalanceReport }>;
    totalFights: number;
    totalRounds: number;
    earlyKos: number;
    timeouts: number;
    draws: number;
    medianRoundLow: number;
    medianRoundHigh: number;
    opener: Tally;
    /** A-rank result when both ranks receive the exact same 12 buttons. */
    rankIsolationA: Tally;
    rankCross: Record<BloodlineRank, Tally>;
    archetypes: Record<Archetype, Tally>;
    tagAttempts: Record<string, number>;
    tagApplied: Record<string, number>;
    availableTags: string[];
    uncastAvailableTags: string[];
    issues: string[];
};

export type CompetitiveProfileRotationCertification = {
    generatedAt: string;
    engine: string;
    levels: CompetitiveProfileRotationLevelReport[];
    issues: string[];
};

export type BuildOptions = {
    fullyCapped?: boolean;
    namedGear?: boolean;
    loadoutSize?: number;
    earnedStats?: number;
};

export type TournamentOptions = BuildOptions & {
    label?: string;
    /** Optional prebuilt roster for competitive-template and sensitivity runs. */
    roster?: BuildTemplate[];
};

export type EntitlementBalanceReport = {
    level: number;
    fights: number;
    supporter: Tally;
    base: Tally;
    issues: string[];
};

function otherSeat(seat: Seat): Seat {
    return seat === 'p1' ? 'p2' : 'p1';
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function emptyTally(): Tally {
    return { wins: 0, losses: 0, draws: 0, games: 0 };
}

function record(tally: Tally, outcome: 'win' | 'loss' | 'draw'): void {
    tally.games += 1;
    if (outcome === 'win') tally.wins += 1;
    else if (outcome === 'loss') tally.losses += 1;
    else tally.draws += 1;
}

function mergeTally(target: Tally, source: Tally): void {
    target.wins += source.wins;
    target.losses += source.losses;
    target.draws += source.draws;
    target.games += source.games;
}

export function scoredRate(tally: Tally): number {
    return tally.games > 0 ? (tally.wins + tally.draws * 0.5) / tally.games : 0.5;
}

function increment(target: Record<string, number>, key: string, amount = 1): void {
    target[key] = (target[key] ?? 0) + amount;
}

function draftJutsu(
    archetype: Archetype,
    discipline: Discipline,
    id: string,
    tags: CombatTag[] = [],
    options: Partial<SimJutsu> = {},
): SimJutsu {
    const ap = Number(options.ap ?? 60);
    return {
        id: `${archetype.toLowerCase()}-${id}`,
        name: id.replace(/-/g, ' '),
        type: ap === 40 ? 'Any' : discipline,
        element: PROFILE[archetype].element,
        weatherElement: 'None',
        ap,
        range: Number(options.range ?? 4),
        effectPower: Number(options.effectPower ?? (ap === 40 ? 0 : 40)),
        cooldown: 7,
        target: String(options.target ?? 'OPPONENT'),
        method: String(options.method ?? 'SINGLE'),
        chakraCost: 100,
        staminaCost: 100,
        isUtility: ap === 40,
        tags,
    };
}

function playerBloodlineDraft(archetype: Archetype, rank: BloodlineRank): SimJutsu[] {
    const discipline = PROFILE[archetype].discipline;
    const d = (id: string, tags: CombatTag[] = [], options: Partial<SimJutsu> = {}) => draftJutsu(archetype, discipline, id, tags, options);
    const util = (id: string, tags: CombatTag[]) => d(id, tags, { ap: 40, effectPower: 0 });
    const nuke = (id: string, tags: CombatTag[]) => d(id, tags, { effectPower: 50 });
    const r5 = (id: string, tags: CombatTag[], options: Partial<SimJutsu> = {}) => d(id, tags, { ...options, range: 5 });

    if (rank === 'A Rank') {
        switch (archetype) {
            case 'Burst': return [
                nuke('Nuke-Wound', [{ name: 'Wound', percent: 30 }]),
                d('Pierce', [{ name: 'Pierce' }]),
                d('Ignition', [{ name: 'Ignition', percent: 30 }]),
                util('Power-Focus', [{ name: 'Increase Damage Given', percent: 30 }, { name: 'Increase Generals', percent: 30 }]),
                util('Quick-Recovery', [{ name: 'Overclock' }, { name: 'Increase Heal', percent: 30 }]),
            ];
            case 'Sustain': return [
                r5('Wound-Siphon', [{ name: 'Wound', percent: 30 }, { name: 'Siphon', percent: 30 }]),
                d('Poison-Drain', [{ name: 'Poison', percent: 30 }, { name: 'Drain' }]),
                util('Healing-Flow', [{ name: 'Heal' }, { name: 'Increase Heal', percent: 30 }]),
                util('Shielded-Guard', [{ name: 'Shield' }, { name: 'Decrease Damage Taken', percent: 30 }]),
                d('Leeching-Armor', [{ name: 'Lifesteal', percent: 25 }, { name: 'Absorb', percent: 25 }]),
            ];
            case 'Control': return [
                d('Stun', [{ name: 'Stun' }]),
                d('Bloodline-Seal', [{ name: 'Bloodline Seal' }]),
                d('Elemental-Seal', [{ name: 'Elemental Seal' }]),
                util('Suppression', [{ name: 'Decrease Damage Given', percent: 30 }, { name: 'Buff Prevent' }]),
                d('Poison', [{ name: 'Poison', percent: 30 }]),
            ];
            case 'Prevention': return [
                r5('Buff-Prevent', [{ name: 'Buff Prevent' }]),
                r5('Debuff-Prevent', [{ name: 'Debuff Prevent' }]),
                r5('Cleanse-Prevent', [{ name: 'Cleanse Prevent' }]),
                r5('Clear-Prevent', [{ name: 'Clear Prevent' }]),
                d('Stun-Prevent', [{ name: 'Stun Prevent' }]),
            ];
            case 'Tempo': return [
                d('Circle-Dash', [], { method: 'AOE_CIRCLE', target: 'EMPTY_GROUND' }),
                d('Push', [{ name: 'Push' }]),
                d('Lag', [{ name: 'Lag' }]),
                util('Overclock-Guard', [{ name: 'Overclock' }, { name: 'Decrease Damage Taken', percent: 25 }]),
                d('Recoil-Suppress', [{ name: 'Recoil', percent: 30 }, { name: 'Decrease Damage Given', percent: 30 }]),
            ];
            case 'Disruption': return [
                d('Pierce', [{ name: 'Pierce' }]),
                d('Recoil', [{ name: 'Recoil', percent: 30 }]),
                d('Mirror', [{ name: 'Mirror' }]),
                r5('Copy', [{ name: 'Copy' }]),
                util('Expose-Suppress', [{ name: 'Increase Damage Taken', percent: 25 }, { name: 'Decrease Damage Given', percent: 25 }]),
            ];
            case 'Counter': return [
                r5('Reflect-Absorb', [{ name: 'Reflect', percent: 25 }, { name: 'Absorb', percent: 25 }]),
                r5('Recoil-Wound', [{ name: 'Recoil', percent: 25 }, { name: 'Wound', percent: 25 }]),
                util('Heal-Shield', [{ name: 'Heal' }, { name: 'Shield' }, { name: 'Increase Heal', percent: 25 }]),
                r5('Debuff-Prevent', [{ name: 'Debuff Prevent' }]),
                d('Pierce', [{ name: 'Pierce' }]),
            ];
            case 'Ground': return [
                r5('Poison-Field', [{ name: 'Decrease Damage Given', percent: 25 }, { name: 'Poison', percent: 30 }], { method: 'INSTANT_EFFECT', target: 'EMPTY_GROUND' }),
                r5('Recoil-Spiral', [{ name: 'Recoil', percent: 25 }], { method: 'AOE_SPIRAL', target: 'EMPTY_GROUND' }),
                r5('Burst-Zone', [{ name: 'Increase Damage Taken', percent: 25 }, { name: 'Ignition', percent: 25 }], { method: 'AOE_BURST' }),
                d('Healing-Step', [{ name: 'Move' }, { name: 'Heal' }], { target: 'EMPTY_GROUND' }),
                d('Poison-Pull', [{ name: 'Pull' }, { name: 'Poison', percent: 30 }]),
            ];
        }
    }

    switch (archetype) {
        case 'Burst': return [
            nuke('Nuke-Wound', [{ name: 'Wound', percent: 30 }]),
            d('Pierce', [{ name: 'Pierce' }]),
            d('Ignition', [{ name: 'Ignition', percent: 30 }]),
            util('Power-Tempo', [{ name: 'Increase Damage Given', percent: 30 }, { name: 'Overclock' }]),
        ];
        case 'Sustain': return [
            r5('Wound-Siphon', [{ name: 'Wound', percent: 30 }, { name: 'Siphon', percent: 25 }]),
            d('Poison-Drain', [{ name: 'Poison', percent: 30 }, { name: 'Drain' }]),
            util('Healing-Flow', [{ name: 'Heal' }, { name: 'Increase Heal', percent: 25 }]),
            d('Leeching-Armor', [{ name: 'Lifesteal', percent: 25 }, { name: 'Absorb', percent: 25 }]),
        ];
        case 'Control': return [
            d('Stun', [{ name: 'Stun' }]),
            d('Bloodline-Seal', [{ name: 'Bloodline Seal' }]),
            d('Elemental-Seal', [{ name: 'Elemental Seal' }]),
            d('Suppression-Poison', [{ name: 'Decrease Damage Given', percent: 30 }, { name: 'Poison', percent: 30 }]),
        ];
        case 'Prevention': return [
            r5('Buff-Prevent', [{ name: 'Buff Prevent' }]),
            d('Debuff-Prevent', [{ name: 'Debuff Prevent' }]),
            d('Cleanse-Prevent', [{ name: 'Cleanse Prevent' }]),
            d('Stun-Prevent', [{ name: 'Stun Prevent' }]),
        ];
        case 'Tempo': return [
            d('Circle-Dash', [], { method: 'AOE_CIRCLE', target: 'EMPTY_GROUND' }),
            d('Pull', [{ name: 'Pull' }]),
            d('Lag-Overclock', [{ name: 'Lag' }, { name: 'Overclock' }]),
            d('Plain-Strike'),
        ];
        case 'Disruption': return [
            r5('Copy', [{ name: 'Copy' }]),
            r5('Mirror', [{ name: 'Mirror' }]),
            d('Plain-Strike-A'),
            d('Plain-Strike-B'),
        ];
        case 'Counter': return [
            d('Reflect-Absorb', [{ name: 'Reflect', percent: 25 }, { name: 'Absorb', percent: 25 }]),
            d('Recoil-Wound', [{ name: 'Recoil', percent: 25 }, { name: 'Wound', percent: 25 }]),
            util('Heal-Shield', [{ name: 'Heal' }, { name: 'Shield' }]),
            r5('Debuff-Prevent', [{ name: 'Debuff Prevent' }]),
        ];
        case 'Ground': return [
            d('Poison-Field', [{ name: 'Decrease Damage Given', percent: 25 }, { name: 'Poison', percent: 30 }], { method: 'INSTANT_EFFECT', target: 'EMPTY_GROUND' }),
            d('Recoil-Spiral', [{ name: 'Recoil', percent: 25 }], { method: 'AOE_SPIRAL', target: 'EMPTY_GROUND' }),
            d('Burst-Zone', [{ name: 'Increase Damage Taken', percent: 25 }, { name: 'Ignition', percent: 25 }], { method: 'AOE_BURST' }),
            d('Healing-Step', [{ name: 'Move' }, { name: 'Heal' }], { target: 'EMPTY_GROUND' }),
        ];
    }
}

const EXPECTED_KIT_POINTS: Record<BloodlineRank, Record<Archetype, number>> = {
    'A Rank': { Burst: 9.75, Sustain: 10, Control: 9.75, Prevention: 10, Tempo: 8.75, Disruption: 9.75, Counter: 10, Ground: 9.75 },
    'B Rank': { Burst: 7, Sustain: 6.75, Control: 6.75, Prevention: 7, Tempo: 5.75, Disruption: 7, Counter: 7, Ground: 7 },
};

export function sealPlayerBloodlineKit(archetype: Archetype, rank: BloodlineRank, level: number): SimJutsu[] {
    const normalized = normalizePlayerBloodlineJutsus(playerBloodlineDraft(archetype, rank), rank) as SimJutsu[];
    const expectedCount = rank === 'A Rank' ? 5 : 4;
    const points = bloodlinePoints(normalized, rank);
    if (normalized.length !== expectedCount) {
        throw new Error(`${rank} ${archetype} sealed to ${normalized.length}/${expectedCount} jutsu.`);
    }
    if (Math.abs(points - EXPECTED_KIT_POINTS[rank][archetype]) > 0.0001 || points > pointBudgetForRank(rank)) {
        throw new Error(`${rank} ${archetype} sealed at ${points} points; expected ${EXPECTED_KIT_POINTS[rank][archetype]}.`);
    }
    const roundTrip = normalizePlayerBloodlineJutsus(normalized, rank);
    if (JSON.stringify(roundTrip) !== JSON.stringify(normalized)) {
        throw new Error(`${rank} ${archetype} player-schema round trip is not idempotent.`);
    }
    return normalized.map((jutsu) => {
        const costs = v2JutsuCosts(jutsu, level, PROFILE[archetype].discipline);
        return {
            ...jutsu,
            ...costs,
            bloodlineRank: rank,
            tags: (jutsu.tags ?? []).map((tag) => ({ ...tag, name: canonicalTagName(tag.name) })),
        } as SimJutsu;
    });
}

function baselineJutsuIds(discipline: Discipline): string[] {
    const prefix = discipline === 'Ninjutsu' ? 'nin' : discipline === 'Genjutsu' ? 'gen' : discipline === 'Taijutsu' ? 'tai' : 'buki';
    return [
        'starter-universal-flicker',
        `starter-${prefix}-earth-2`, `starter-${prefix}-wind-2`,
        `starter-${prefix}-lightning-2`, `starter-${prefix}-fire-2`,
        `starter-${prefix}-earth-1`, `starter-${prefix}-lightning-1`,
        `starter-${prefix}-water-4`,
        `starter-${prefix}-wind-1`, `starter-${prefix}-fire-1`,
        `starter-${prefix}-water-1`,
    ];
}

function fullJutsuLoadout(archetype: Archetype, rank: BloodlineRank, level: number, loadoutSize: number): SimJutsu[] {
    const custom = sealPlayerBloodlineKit(archetype, rank, level);
    const fillerCount = loadoutSize - custom.length;
    const baseline = baselineJutsuIds(PROFILE[archetype].discipline);
    if (fillerCount < 0 || fillerCount > baseline.length) {
        throw new Error(`${rank} ${archetype} cannot fill a ${loadoutSize}-slot loadout from ${baseline.length} common techniques.`);
    }
    // Both ranks share the same ordered common core. B-rank's one fewer custom
    // technique legitimately leaves room for one additional common button; the
    // old archetype-index omission removed a different high-value technique from
    // every A build and contaminated both rank and role comparisons.
    const fillerIds = baseline.slice(0, fillerCount);
    const fillers = fillerIds.map((id) => {
        const catalog = JUTSU_CATALOG[id];
        if (!catalog) throw new Error(`Missing baseline jutsu ${id}.`);
        const costs = v2JutsuCosts(catalog, level, PROFILE[archetype].discipline);
        return { ...catalog, ...costs, tags: catalog.tags.map((tag) => ({ ...tag })) } as SimJutsu;
    });
    const loadout = [...custom, ...fillers];
    if (loadout.length !== loadoutSize) throw new Error(`${rank} ${archetype} did not fill ${loadoutSize} jutsu slots.`);
    return loadout;
}

const ARMOR_DR: Record<string, number> = { Standard: 0.01, Reinforced: 0.03, Rare: 0.05, Elite: 0.06, Legendary: 0.07, Mythic: 0.08 };
const ARMOR_SLOTS = ['head', 'body', 'waist', 'legs', 'feet'] as const;

function numericBonuses(item: CatalogItem): Record<string, number> {
    return (item.bonuses ?? {}) as Record<string, number>;
}

function itemCombatScore(item: CatalogItem, discipline: Discipline): number {
    const bonuses = numericBonuses(item);
    const prefix = discipline.toLowerCase();
    const stat = Number(bonuses[`${prefix}Offense`] ?? 0) + Number(bonuses[`${prefix}Defense`] ?? 0);
    const sustain = Number(bonuses.damagePercent ?? 0) * 40
        + Number(bonuses.absorbPercent ?? 0) * 35
        + Number(bonuses.reflectPercent ?? 0) * 30
        + Number(bonuses.lifeStealPercent ?? 0) * 35
        + Number(bonuses.shield ?? 0) / 10;
    return Number(item.weaponEp ?? 0) * 1000 + Number(item.weaponRange ?? 0) * 25 + stat + sustain;
}

function bestEligibleArmor(level: number, slot: typeof ARMOR_SLOTS[number], discipline: Discipline): CatalogItem {
    const candidates = Object.values(ITEM_CATALOG).filter((item) =>
        item.slot === slot && item.armorQuality && meetsItemLevelReq(item, level),
    );
    candidates.sort((a, b) =>
        ((ARMOR_DR[String(b.armorQuality)] ?? 0) - (ARMOR_DR[String(a.armorQuality)] ?? 0)) * 100_000
        || itemCombatScore(b, discipline) - itemCombatScore(a, discipline)
        || String(a.id).localeCompare(String(b.id)),
    );
    const winner = candidates[0];
    if (!winner) throw new Error(`No eligible ${slot} armor at level ${level}.`);
    return winner;
}

function weaponEffectBias(item: CatalogItem, archetype: Archetype): number {
    const effect = canonicalTagName(String(item.weaponEffect ?? item.weaponTags?.[0]?.name ?? ''));
    const wanted = new Set(PROFILE[archetype].weaponTags.map((tag) => canonicalTagName(tag.name)));
    if (wanted.has(effect)) return 500;
    if (archetype === 'Sustain' && ['Lifesteal', 'Absorb', 'Heal', 'Siphon'].includes(effect)) return 300;
    if (archetype === 'Counter' && ['Reflect', 'Absorb', 'Shield'].includes(effect)) return 300;
    if (archetype === 'Control' && ['Wound', 'Drain', 'Decrease Damage Given'].includes(effect)) return 250;
    return 0;
}

function bestEligibleWeapon(level: number, archetype: Archetype): CatalogItem {
    const discipline = PROFILE[archetype].discipline;
    const candidates = Object.values(ITEM_CATALOG).filter((item) =>
        Number(item.weaponEp ?? 0) > 0 && item.slot === 'hand' && meetsItemLevelReq(item, level),
    );
    candidates.sort((a, b) =>
        (itemCombatScore(b, discipline) + weaponEffectBias(b, archetype))
        - (itemCombatScore(a, discipline) + weaponEffectBias(a, archetype))
        || String(a.id).localeCompare(String(b.id)),
    );
    const winner = candidates[0];
    if (!winner) throw new Error(`No eligible weapon at level ${level}.`);
    return winner;
}

function namedArmor(archetype: Archetype, slot: typeof ARMOR_SLOTS[number] | 'hand'): CatalogItem {
    const special = PROFILE[archetype].namedSpecial;
    const value = special === 'shield' ? 150 : special === 'damagePercent' ? 1.5 : 2;
    const bonuses: Record<string, number> = {
        ninjutsuOffense: 35, taijutsuOffense: 35, bukijutsuOffense: 35, genjutsuOffense: 35,
        ninjutsuDefense: 35, taijutsuDefense: 35, bukijutsuDefense: 35, genjutsuDefense: 35,
        [special]: value,
    };
    const ordinal = ARCHETYPES.indexOf(archetype) * 8 + [...ARMOR_SLOTS, 'hand'].indexOf(slot) + 1;
    return {
        id: `named-armor-${ordinal.toString(16).padStart(32, '0')}`,
        name: slot === 'hand' ? `Max-roll ${archetype} Gauntlets` : `Max-roll ${archetype} ${slot}`,
        slot: slot === 'hand' ? 'hand' : slot,
        rarity: 'legendary',
        cost: 0,
        levelReq: 90,
        ...(slot === 'hand' ? {} : { armorQuality: 'Mythic' }),
        bonuses,
    };
}

function namedWeapon(archetype: Archetype): CatalogItem {
    const ordinal = ARCHETYPES.indexOf(archetype) + 1;
    return {
        id: `named-weapon-${(0x100 + ordinal).toString(16).padStart(32, '0')}`,
        name: `Max-roll ${archetype} weapon`,
        slot: 'hand',
        rarity: 'legendary',
        cost: 0,
        levelReq: 90,
        weaponEp: 35,
        weaponRange: 5,
        weaponCooldown: 5,
        weaponElement: PROFILE[archetype].element,
        apCost: 40,
        weaponTags: PROFILE[archetype].weaponTags.map((tag) => ({ ...tag })),
        bonuses: {
            ninjutsuOffense: 180, taijutsuOffense: 180,
            bukijutsuOffense: 180, genjutsuOffense: 180,
        },
    };
}

function preferredRelic(level: number, discipline: Discipline): CatalogItem | null {
    const id = discipline === 'Ninjutsu'
        ? (level >= 60 ? 'relic-stormglass-pendulum' : 'chakra-ring')
        : discipline === 'Genjutsu'
            ? 'relic-rimeglass-lens'
            : discipline === 'Taijutsu'
                ? 'relic-rootbound-effigy'
                : 'relic-ashfall-reliquary';
    const item = ITEM_CATALOG[id];
    return item && meetsItemLevelReq(item, level) ? item : null;
}

function equipmentFor(level: number, archetype: Archetype, namedGear: boolean): {
    equipment: Record<string, string>;
    items: CatalogItem[];
    weapon: CatalogItem;
} {
    if (namedGear) {
        const armor = ARMOR_SLOTS.map((slot) => namedArmor(archetype, slot));
        const gloves = namedArmor(archetype, 'hand');
        const weapon = namedWeapon(archetype);
        const relic = preferredRelic(level, PROFILE[archetype].discipline);
        return {
            equipment: {
                ...Object.fromEntries(armor.map((item) => [String(item.slot), item.id])),
                gloves: gloves.id,
                hand: weapon.id,
                ...(relic ? { relic: relic.id } : {}),
            },
            items: [...armor, gloves, weapon, ...(relic ? [relic] : [])],
            weapon,
        };
    }

    if (level >= 65) {
        const prefix = PROFILE[archetype].set;
        const armor = ARMOR_SLOTS.map((slot) => ITEM_CATALOG[`${prefix}-${slot === 'head' ? 'crown' : slot === 'body' ? 'chest' : slot}`]);
        const gloves = ITEM_CATALOG[`${prefix}-gloves`];
        if (armor.some((item) => !item) || !gloves) throw new Error(`Missing ${prefix} armor set.`);
        for (const item of [...armor, gloves]) {
            if (!meetsItemLevelReq(item, level)) throw new Error(`${item!.id} is not legal at level ${level}.`);
        }
        const weapon = { ...bestEligibleWeapon(level, archetype), weaponElement: PROFILE[archetype].element };
        const relic = preferredRelic(level, PROFILE[archetype].discipline);
        return {
            equipment: {
                ...Object.fromEntries(armor.map((item) => [String(item!.slot), item!.id])),
                gloves: gloves.id,
                hand: weapon.id,
                ...(relic ? { relic: relic.id } : {}),
            },
            items: [...armor as CatalogItem[], gloves, weapon, ...(relic ? [relic] : [])],
            weapon,
        };
    }

    const armor = ARMOR_SLOTS.map((slot) => bestEligibleArmor(level, slot, PROFILE[archetype].discipline));
    const eligibleWeapon = bestEligibleWeapon(level, archetype);
    // Elemental Cores can legally attune legendary/mythic weapons to one of the
    // wielder's awakened elements. Competitive builds use that progression
    // option once the weapon tier permits it; lower-rarity weapons stay neutral.
    const weapon = ['legendary', 'mythic'].includes(String(eligibleWeapon.rarity).toLowerCase())
        ? { ...eligibleWeapon, weaponElement: PROFILE[archetype].element }
        : eligibleWeapon;
    const relic = preferredRelic(level, PROFILE[archetype].discipline);
    return {
        equipment: {
            ...Object.fromEntries(armor.map((item) => [String(item.slot), item.id])),
            hand: weapon.id,
            ...(relic ? { relic: relic.id } : {}),
        },
        items: [...armor, weapon, ...(relic ? [relic] : [])],
        weapon,
    };
}

export function allocatePlayerStats(
    level: number,
    archetype: Archetype,
    fullyCapped = false,
    equipmentBonuses: Record<string, number> = {},
    earnedStats = earnedForLevel(level),
): Record<string, number> {
    if (fullyCapped) return Object.fromEntries(STAT_KEYS.map((key) => [key, MAX_STAT]));
    const cap = statCapForLevel(level);
    const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, 10])) as Record<string, number>;
    let remaining = earnedStats;
    // Competitive specialist allocation: cap the chosen offense, chosen
    // defense, and its two formula generals first; then cover every off-school
    // defense, unused generals, and finally off-school offense. Equal-fill each
    // priority group so the chosen composite is not dependent on field order.
    const discipline = PROFILE[archetype].discipline;
    const prefix = discipline.toLowerCase();
    const generals: Record<Discipline, readonly string[]> = {
        Ninjutsu: ['willpower', 'speed'],
        Genjutsu: ['intelligence', 'willpower'],
        Taijutsu: ['strength', 'speed'],
        Bukijutsu: ['intelligence', 'strength'],
    };
    const primary = [`${prefix}Offense`, `${prefix}Defense`, ...generals[discipline]];
    const otherDefenses = STAT_KEYS.filter((key) => key.endsWith('Defense') && key !== `${prefix}Defense`);
    const unusedGenerals = ['strength', 'speed', 'intelligence', 'willpower'].filter((key) => !generals[discipline].includes(key));
    const otherOffenses = STAT_KEYS.filter((key) => key.endsWith('Offense') && key !== `${prefix}Offense`);
    const rawCap = (key: string) => Math.max(10, cap - Math.max(0, Number(equipmentBonuses[key] ?? 0)));
    for (const group of [primary, otherDefenses, unusedGenerals, otherOffenses]) {
        let guard = 0;
        while (remaining > 0 && guard++ < 10_000) {
            const eligible = group.filter((key) => stats[key]! < rawCap(key));
            if (!eligible.length) break;
            const even = Math.max(1, Math.floor(remaining / eligible.length));
            let spent = 0;
            for (const key of eligible) {
                const grant = Math.min(rawCap(key) - stats[key]!, even, remaining);
                stats[key]! += grant;
                remaining -= grant;
                spent += grant;
                if (remaining <= 0) break;
            }
            if (spent <= 0) break;
        }
        if (remaining <= 0) break;
    }
    if (remaining !== 0) throw new Error(`Could not allocate ${remaining} level-${level} stat points for ${archetype}.`);
    return stats;
}

export function upperEarnedForExactLevel(level: number): number {
    return level >= MAX_LEVEL
        ? STAT_KEYS.length * (MAX_STAT - 10)
        : Math.max(earnedForLevel(level), earnedForLevel(level + 1) - 1);
}

export function makeBuild(level: number, archetype: Archetype, rank: BloodlineRank, options: BuildOptions = {}): BuildTemplate {
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
        throw new Error(`Player level ${level} is outside the live 1-${MAX_LEVEL} range.`);
    }
    const fullyCapped = options.fullyCapped ?? level === 100;
    if (fullyCapped && level !== MAX_LEVEL) {
        throw new Error(`A fully capped player must be level ${MAX_LEVEL}, not ${level}.`);
    }
    const namedGear = options.namedGear ?? fullyCapped;
    const loadoutSize = options.loadoutSize ?? FULL_LOADOUT_SIZE;
    const earnedStats: number | 'all-capped' = fullyCapped
        ? 'all-capped'
        : options.earnedStats ?? upperEarnedForExactLevel(level);
    if (typeof earnedStats === 'number') {
        const minimum = earnedForLevel(level);
        const maximum = upperEarnedForExactLevel(level);
        if (!Number.isInteger(earnedStats) || earnedStats < minimum || earnedStats > maximum) {
            throw new Error(`Level ${level} earnedStats ${earnedStats} is outside its legal ${minimum}-${maximum} bracket.`);
        }
    }
    if (![LOADOUT_CAP_BASE, LOADOUT_CAP_SUB].includes(loadoutSize)) {
        throw new Error(`Unsupported loadout size ${loadoutSize}; live caps are ${LOADOUT_CAP_BASE}/${LOADOUT_CAP_SUB}.`);
    }
    const profile = PROFILE[archetype];
    const loadout = fullJutsuLoadout(archetype, rank, level, loadoutSize);
    const gear = equipmentFor(level, archetype, namedGear);
    for (const item of gear.items) {
        if (!meetsItemLevelReq(item, level)) {
            throw new Error(`${item.id} requires level ${effectiveItemLevelReq(item)}, not ${level}.`);
        }
    }
    const bloodlineId = `sim-${rank.toLowerCase().replace(/\s+/g, '-')}-${archetype.toLowerCase()}`;
    const save = {
        creatorItems: namedGear ? gear.items : [],
        savedBloodlines: [{ id: bloodlineId, rank }],
    };
    const character: Record<string, unknown> = {
        level,
        specialty: profile.discipline,
        element: profile.element,
        elements: [profile.element],
        ...(gear.weapon.weaponElement ? { weaponElements: { [gear.weapon.id]: gear.weapon.weaponElement } } : {}),
        ...(loadoutSize === LOADOUT_CAP_SUB ? { patreon: { active: true, tier: 'Shinobi Supporter' } } : {}),
        equippedBloodlineId: bloodlineId,
        equipment: gear.equipment,
        pvpItems: gear.items,
        jutsu: loadout,
        jutsuMastery: loadout.map((jutsu) => ({ jutsuId: jutsu.id, level: Math.min(JUTSU_MAX_LEVEL, jutsuLevelCapForLevel(level)) })),
        stats: {},
    };
    const bonuses = deriveEquipmentStatBonuses(character, save);
    const allocated = allocatePlayerStats(
        level,
        archetype,
        fullyCapped,
        bonuses,
        typeof earnedStats === 'number' ? earnedStats : earnedForLevel(level),
    );
    character.stats = Object.fromEntries(STAT_KEYS.map((key) => [
        key,
        Number(allocated[key] ?? 10) + Number(bonuses[key] ?? 0),
    ]));
    Object.assign(character, deriveCombatMultipliers(character, save));
    const canonicalMaxHp = maxHpForLevel(level);
    const { maxHp } = pvpSessionHp({
        level,
        currentHp: canonicalMaxHp,
        maxHp: canonicalMaxHp,
        useCurrentVitals: false,
        humanPvp: true,
    });
    const maxChakra = maxChakraForLevel(level);
    const maxStamina = maxStaminaForLevel(level);
    const variant = `${loadoutSize}s-${namedGear ? 'named' : 'catalog'}-${earnedStats === 'all-capped' ? 'capped' : earnedStats}`;
    const name = `L${level}-${rank[0]}-${archetype}-${variant}`;
    return {
        id: `${level}-${rank}-${archetype}-${variant}`,
        name,
        archetype,
        profileArchetype: archetype,
        bloodlineRank: rank,
        level,
        fullyCapped,
        namedGear,
        loadoutSize,
        earnedStats,
        discipline: profile.discipline,
        jutsu: loadout,
        weapon: gear.weapon,
        equipmentIds: gear.items.map((item) => item.id),
        fighter: {
            name,
            hp: maxHp,
            maxHp,
            chakra: maxChakra,
            maxChakra,
            stamina: maxStamina,
            maxStamina,
            shield: Math.max(0, Number(character.itemShield ?? 0)),
            statuses: [],
            character,
            pos: P1_START,
        },
    };
}

function activeStatuses(fighter: PvpFighter, round: number): PvpFighter['statuses'] {
    return activeCombatStatuses(fighter.statuses, round) as PvpFighter['statuses'];
}

function hasStatus(fighter: PvpFighter, name: string, round: number): boolean {
    return activeStatuses(fighter, round).some((status) => canonicalTagName(status.name) === name);
}

function barrierTiles(round: number, ...fighters: PvpFighter[]): number[] {
    return fighters.flatMap((fighter) => activeStatuses(fighter, round)
        .filter((status) => canonicalTagName(status.name) === 'Barrier' && typeof status.amount === 'number')
        .map((status) => Number(status.amount)));
}

function moveQueuedFighter(target: PvpFighter, source: PvpFighter, round: number): PvpFighter {
    let fighter = { ...target };
    const movement = activeStatuses(fighter, round).filter((status) => ['Push', 'Pull'].includes(canonicalTagName(status.name)));
    for (const status of movement) {
        const name = canonicalTagName(status.name);
        const distanceToMove = Math.max(1, Number(status.amount ?? 1));
        let nextPos = fighter.pos;
        for (let step = 0; step < distanceToMove; step += 1) {
            const candidates = hexNeighbors(nextPos).filter((tile) => {
                if (tile === source.pos || barrierTiles(round, fighter, source).includes(tile)) return false;
                return name === 'Push'
                    ? hexDistance(tile, source.pos) > hexDistance(nextPos, source.pos)
                    : hexDistance(tile, source.pos) < hexDistance(nextPos, source.pos);
            });
            if (!candidates.length) break;
            nextPos = candidates[0]!;
        }
        fighter = { ...fighter, pos: nextPos };
    }
    if (movement.length) fighter = { ...fighter, statuses: fighter.statuses.filter((status) => !movement.includes(status)) };
    return fighter;
}

function targetTilePlan(
    jutsu: SimJutsu,
    self: PvpFighter,
    opponent: PvpFighter,
    round: number,
    ap: number,
    actions: number,
    cooldown: number,
): JutsuActionPlan | null {
    const baseInput = {
        jutsu,
        casterPos: self.pos,
        opponentPos: opponent.pos,
        casterChakra: self.chakra,
        casterStamina: self.stamina,
        casterStatuses: self.statuses,
        round,
        availableAp: ap,
        actionsThisTurn: actions,
        cooldownRemaining: cooldown,
        board: {
            width: GRID_W,
            height: GRID_H,
            unavailableTiles: new Set([opponent.pos, ...barrierTiles(round, self, opponent)]),
        },
    };
    const needsTile = (jutsu.tags ?? []).some((tag) => canonicalTagName(tag.name) === 'Move') || jutsu.target === 'EMPTY_GROUND';
    if (!needsTile) {
        const result = resolveJutsuActionPlan(baseInput);
        return result.accepted ? result : null;
    }
    const candidates = Array.from({ length: GRID_W * GRID_H }, (_, tile) => tile)
        .filter((tile) => tile !== self.pos && tile !== opponent.pos)
        .sort((a, b) => {
            const aAdj = hexDistance(a, opponent.pos);
            const bAdj = hexDistance(b, opponent.pos);
            return aAdj - bAdj || hexDistance(self.pos, a) - hexDistance(self.pos, b) || a - b;
        });
    let best: { plan: JutsuActionPlan; score: number } | null = null;
    for (const tile of candidates) {
        const result = resolveJutsuActionPlan({ ...baseInput, tile });
        if (!result.accepted) continue;
        const score = (result.hitsOpponent ? 10_000 : 0)
            + (result.createsGroundEffect && result.footprint.includes(opponent.pos) ? 8_000 : 0)
            - hexDistance(tile, opponent.pos) * 100
            - hexDistance(self.pos, tile);
        if (!best || score > best.score) best = { plan: result, score };
    }
    return best?.plan ?? null;
}

export const AI_UNDERSTOOD_TAGS: ReadonlySet<string> = new Set([
    'Absorb', 'Barrier', 'Buff Prevent', 'Cleanse Prevent', 'Clear Prevent', 'Copy',
    'Debuff Prevent', 'Decrease Damage Given', 'Decrease Damage Taken', 'Drain',
    'Elemental Seal', 'Heal', 'Ignition', 'Increase Damage Given', 'Increase Damage Taken',
    'Increase Discipline', 'Increase Generals', 'Increase Heal', 'Lifesteal', 'Mirror',
    'Move', 'Overclock', 'Pierce', 'Poison', 'Pull', 'Push', 'Recoil', 'Reflect',
    'Bloodline Seal', 'Shield', 'Siphon', 'Stun', 'Stun Prevent', 'Lag', 'Wound',
]);

const missingAiTags = CANONICAL_TAG_NAMES.filter((name) => !AI_UNDERSTOOD_TAGS.has(name));
const unknownAiTags = [...AI_UNDERSTOOD_TAGS].filter((name) => !CANONICAL_TAG_NAMES.includes(name));
if (missingAiTags.length || unknownAiTags.length) {
    throw new Error(`PvP simulation AI tag registry drift (missing: ${missingAiTags.join(', ') || 'none'}; unknown: ${unknownAiTags.join(', ') || 'none'}).`);
}

function validateUnderstoodTags(jutsu: readonly SimJutsu[]): void {
    for (const technique of jutsu) {
        for (const tag of technique.tags ?? []) {
            const name = canonicalTagName(tag.name);
            if (!AI_UNDERSTOOD_TAGS.has(name)) throw new Error(`AI has no valuation for tag ${name} (${technique.id}).`);
        }
    }
}

const BUFF_PREVENTABLE_TAGS = new Set([
    'Absorb', 'Clear Prevent', 'Decrease Damage Taken',
    'Increase Damage Given', 'Increase Discipline', 'Increase Generals', 'Increase Heal',
    'Lifesteal', 'Overclock', 'Reflect', 'Copy',
]);
const CLEARABLE_POSITIVE_TAGS = new Set([
    'Absorb', 'Barrier', 'Clear Prevent', 'Debuff Prevent', 'Decrease Damage Taken',
    'Increase Damage Given', 'Increase Discipline', 'Increase Generals', 'Increase Heal',
    'Lifesteal', 'Overclock', 'Reflect', 'Stun Prevent',
]);
const DEBUFF_PREVENTABLE_TAGS = new Set([
    'Bloodline Seal', 'Buff Prevent', 'Cleanse Prevent', 'Decrease Damage Given',
    'Drain', 'Elemental Seal', 'Ignition', 'Increase Damage Taken', 'Lag', 'Mirror',
    'Poison', 'Pull', 'Push', 'Recoil', 'Stun', 'Wound',
]);
const CLEANSEABLE_NEGATIVE_TAGS = new Set([
    'Bloodline Seal', 'Buff Prevent', 'Cleanse Prevent', 'Decrease Damage Given',
    'Drain', 'Elemental Seal', 'Ignition', 'Increase Damage Taken', 'Lag',
    'Poison', 'Recoil', 'Stun', 'Wound',
]);

function loadoutTagCount(fighter: PvpFighter, wanted: ReadonlySet<string>): number {
    const loadout = (fighter.character.jutsu as SimJutsu[] | undefined) ?? [];
    return loadout.reduce((count, jutsu) => count + (jutsu.tags ?? [])
        .filter((tag) => wanted.has(canonicalTagName(tag.name))).length, 0);
}

function maximumDamageRange(fighter: PvpFighter): number {
    const loadout = (fighter.character.jutsu as SimJutsu[] | undefined) ?? [];
    return Math.max(1, ...loadout
        .filter((jutsu) => Number(jutsu.effectPower ?? 0) > 0)
        .map((jutsu) => Math.max(1, Number(jutsu.range ?? 1))));
}

function poisonSpendValue(fighter: PvpFighter, percent: number): number {
    const loadout = (fighter.character.jutsu as SimJutsu[] | undefined) ?? [];
    const spends = loadout
        .map((jutsu) => Math.max(0, Number(jutsu.chakraCost ?? 0)) + Math.max(0, Number(jutsu.staminaCost ?? 0)))
        .filter((spend) => spend > 0)
        .sort((a, b) => a - b);
    if (!spends.length) return 0;
    // The median legal cast is a stable one-turn exertion estimate; actual
    // candidate preview below charges the exact spend and can reject suicide.
    return v2PoisonOnSpend(spends[Math.floor(spends.length / 2)]!, percent);
}

function statusValue(status: CombatStatus, fighter: PvpFighter, opponent: PvpFighter, round: number): number {
    const name = canonicalTagName(status.name);
    const hp = fighter.maxHp;
    const pct = Number(status.percent ?? 30) / 30;
    const timing = status.activeRound !== undefined && status.activeRound > round ? 0.82 : 1;
    const duration = Math.min(2, Math.max(1, Number(status.rounds ?? 1)));
    let value: number;
    switch (name) {
        case 'Wound': value = Number(status.amount ?? hp * 0.03) * duration; break;
        case 'Drain': value = Number(status.amount ?? hp * 0.025) * duration * 1.4; break;
        case 'Poison': value = poisonSpendValue(fighter, Number(status.percent ?? 6)) * duration; break;
        case 'Stun': value = hp * 0.16; break;
        case 'Bloodline Seal': value = hp * 0.10 * Math.min(1, Math.max(0, Number(fighter.character.bloodlineMult ?? 1) - 1) / 0.3); break;
        case 'Elemental Seal': {
            const loadout = (fighter.character.jutsu as SimJutsu[] | undefined) ?? [];
            const elemental = loadout.filter((jutsu) => jutsu.type !== 'Any' && String(jutsu.element ?? 'None') !== 'None').length;
            value = hp * 0.11 * (elemental / Math.max(1, loadout.length));
            break;
        }
        case 'Buff Prevent': value = hp * 0.03 * Math.min(4, loadoutTagCount(fighter, BUFF_PREVENTABLE_TAGS)); break;
        case 'Debuff Prevent': value = hp * 0.03 * Math.min(4, loadoutTagCount(opponent, DEBUFF_PREVENTABLE_TAGS)); break;
        case 'Cleanse Prevent': value = hp * 0.025 * Math.min(4, loadoutTagCount(opponent, CLEANSEABLE_NEGATIVE_TAGS)); break;
        case 'Clear Prevent': value = hp * 0.025 * Math.min(4, loadoutTagCount(fighter, CLEARABLE_POSITIVE_TAGS)); break;
        case 'Stun Prevent': value = hp * 0.08 * Math.min(1, loadoutTagCount(opponent, new Set(['Stun']))); break;
        case 'Lag': case 'Overclock': value = hp * 0.09; break;
        case 'Increase Generals': case 'Increase Discipline': value = hp * 0.095 * pct * duration; break;
        case 'Increase Damage Given': case 'Increase Damage Taken': case 'Ignition': value = hp * 0.11 * pct * duration; break;
        case 'Decrease Damage Given': case 'Decrease Damage Taken': value = hp * 0.105 * pct * duration; break;
        case 'Absorb': case 'Reflect': case 'Lifesteal': value = hp * 0.085 * pct * duration; break;
        case 'Increase Heal': {
            const sustainTags = new Set(['Heal', 'Siphon', 'Lifesteal']);
            value = loadoutTagCount(fighter, sustainTags) > 0 ? hp * 0.04 * pct * duration : 0;
            break;
        }
        case 'Recoil': value = hp * 0.075 * pct * duration; break;
        case 'Push': value = hp * 0.025 * Math.max(1, hexDistance(fighter.pos, opponent.pos)); break;
        case 'Pull': value = hp * 0.02 * Math.max(1, 5 - hexDistance(fighter.pos, opponent.pos)); break;
        case 'Barrier': value = hp * 0.07; break;
        default: value = 0;
    }
    return value * timing;
}

function decisionStatuses(fighter: PvpFighter, round: number): CombatStatus[] {
    const retained = fighter.statuses.filter((status) => (
        Number(status.rounds ?? 0) > 0
        && (status.inactiveRound === undefined || status.inactiveRound > round)
    ));
    const active = activeStatuses(fighter, round);
    // Age only effects that are active now. Including the pending candidate in
    // this probe would make it see itself at round+1 and suppress every deferred
    // non-stackable status from the valuation.
    const nextRoundFighter = tickStatuses({ ...clone(fighter), statuses: clone(active) }, round);
    const activeNextRoundNonStackable = new Set(activeStatuses(nextRoundFighter, round + 1)
        .map((status) => canonicalTagName(status.name))
        .filter((name) => !STACKABLE_STATUS.has(name)));
    const pending = retained.filter((status) => (
        status.activeRound !== undefined
        && status.activeRound > round
        && (STACKABLE_STATUS.has(canonicalTagName(status.name)) || !activeNextRoundNonStackable.has(canonicalTagName(status.name)))
    ));
    return [...active, ...pending];
}

function fighterStateValue(fighter: PvpFighter, opponent: PvpFighter, round: number): number {
    const hpValue = fighter.hp + fighter.shield * 0.85;
    const statusTotal = decisionStatuses(fighter, round).reduce((sum, status) => {
        const magnitude = statusValue(status, fighter, opponent, round);
        return sum + (status.kind === 'positive' ? magnitude : -magnitude);
    }, 0);
    return hpValue + statusTotal;
}

type PreviewResult = {
    self: PvpFighter;
    opponent: PvpFighter;
    baselineSelf?: PvpFighter;
    baselineOpponent?: PvpFighter;
    evaluationRound?: number;
};

function previewGroundPulse(
    originalSelf: PvpFighter,
    originalOpponent: PvpFighter,
    paidSelf: PvpFighter,
    effect: PvpGroundEffect,
    round: number,
    castPulseThisTurn: boolean,
): PreviewResult {
    if (castPulseThisTurn) {
        return {
            self: paidSelf,
            opponent: applyGroundEffectToFighter(originalOpponent, effect, round, true).fighter,
        };
    }
    // A closer's zone first pulses after live endTurn has aged both status
    // lists. Compare against that same naturally-aged baseline so an expiring
    // ward neither blocks the future pulse nor creates fake value merely by
    // disappearing at the boundary.
    const baselineSelf = tickStatuses(clone(originalSelf), round);
    const baselineOpponent = tickStatuses(clone(originalOpponent), round);
    const futureSelf = tickStatuses(paidSelf, round);
    const futureOpponent = applyGroundEffectToFighter(baselineOpponent, effect, round + 1).fighter;
    return {
        self: futureSelf,
        opponent: futureOpponent,
        baselineSelf,
        baselineOpponent,
        evaluationRound: round + 1,
    };
}

function previewJutsu(
    self: PvpFighter,
    opponent: PvpFighter,
    jutsu: SimJutsu,
    plan: JutsuActionPlan | null,
    round: number,
    castPulseThisTurn = false,
): PreviewResult {
    let previewSelf = clone(self);
    let previewOpponent = clone(opponent);
    const tags = jutsu.tags ?? [];
    if (plan?.move && plan.targetTile !== undefined) {
        previewSelf.pos = plan.targetTile;
        previewSelf = payJutsuResources(previewSelf, plan, round);
        if (plan.createsGroundEffect) {
            const effect: PvpGroundEffect = {
                ...createCanonicalGroundEffect({ id: `preview-${jutsu.id}`, owner: 'p1', name: jutsu.name, plan }),
                activeRound: round + 1,
            };
            return previewGroundPulse(self, opponent, previewSelf, effect, round, castPulseThisTurn);
        }
        if (plan.method === 'AOE_CIRCLE' && plan.hitsOpponent) {
            const damageJutsu = { ...jutsu, tags: tags.filter((tag) => canonicalTagName(tag.name) !== 'Move') };
            const result = applyJutsu(previewSelf, previewOpponent, damageJutsu as never, 1, 'central', round);
            return { self: result.self, opponent: result.opponent };
        }
        const secondary = tags.filter((tag) => {
            const name = canonicalTagName(tag.name);
            return name !== 'Move' && name !== 'Pierce' && !REQUIRES_DAMAGE_TAGS.has(name);
        });
        if (secondary.length) {
            const result = applyJutsu(previewSelf, previewOpponent, { ...jutsu, effectPower: 0, tags: secondary } as never, 1, 'central', round, 0);
            return { self: result.self, opponent: result.opponent };
        }
        return { self: previewSelf, opponent: previewOpponent };
    }
    if (plan?.createsGroundEffect) {
        previewSelf = payJutsuResources(previewSelf, plan, round);
        const effect: PvpGroundEffect = {
            ...createCanonicalGroundEffect({ id: `preview-${jutsu.id}`, owner: 'p1', name: jutsu.name, plan }),
            activeRound: round + 1,
        };
        return previewGroundPulse(self, opponent, previewSelf, effect, round, castPulseThisTurn);
    }
    if (plan && jutsu.target === 'EMPTY_GROUND' && plan.targetTile !== undefined) {
        previewSelf = payJutsuResources(previewSelf, plan, round);
        if (plan.method === 'AOE_CIRCLE' && plan.hitsOpponent) {
            const result = applyJutsu(previewSelf, previewOpponent, jutsu as never, 1, 'central', round);
            return { self: result.self, opponent: result.opponent };
        }
        // Live PvP still charges the cast when the chosen ground footprint
        // misses, but does not resolve a direct hit or any authored payload.
        return { self: previewSelf, opponent: previewOpponent };
    }
    const result = applyJutsu(previewSelf, previewOpponent, jutsu as never, 1, 'central', round);
    return {
        self: plan ? payJutsuResources(result.self, plan, round) : result.self,
        opponent: result.opponent,
    };
}

function resolvedStateScore(
    self: PvpFighter,
    opponent: PvpFighter,
    preview: PreviewResult,
    round: number,
): number {
    const evaluationRound = preview.evaluationRound ?? round;
    const baselineSelf = preview.baselineSelf ?? self;
    const baselineOpponent = preview.baselineOpponent ?? opponent;
    const before = fighterStateValue(baselineSelf, baselineOpponent, evaluationRound)
        - fighterStateValue(baselineOpponent, baselineSelf, evaluationRound);
    const after = fighterStateValue(preview.self, preview.opponent, evaluationRound)
        - fighterStateValue(preview.opponent, preview.self, evaluationRound);
    let score = after - before;
    const selfDead = preview.self.hp <= 0;
    const opponentDead = preview.opponent.hp <= 0;
    if (opponentDead && !selfDead) score += self.maxHp * 10;
    else if (selfDead && !opponentDead) score -= self.maxHp * 10;
    return score;
}

function jutsuScore(
    self: PvpFighter,
    opponent: PvpFighter,
    jutsu: SimJutsu,
    plan: JutsuActionPlan,
    round: number,
    castPulseThisTurn: boolean,
): number {
    const preview = previewJutsu(self, opponent, jutsu, plan, round, castPulseThisTurn);
    let score = resolvedStateScore(self, opponent, preview, round);
    // A persistent zone receives a second target-turn pulse if the victim stays
    // inside it. The first pulse is resolved through the live helper above; this
    // modest continuation value prevents the policy from treating a legal zone
    // as a one-shot effect without inventing synthetic status behavior.
    if (plan.createsGroundEffect && score > 0) score *= 1.25;
    if (plan.move && plan.targetTile !== undefined) {
        const beforeDistance = hexDistance(self.pos, opponent.pos);
        const afterDistance = hexDistance(plan.targetTile, opponent.pos);
        score += (beforeDistance - afterDistance) * self.maxHp * 0.018;
    }
    const tagNames = new Set((jutsu.tags ?? []).map((tag) => canonicalTagName(tag.name)));
    const beforeDistance = hexDistance(self.pos, opponent.pos);
    const afterDistance = hexDistance(preview.self.pos, preview.opponent.pos);
    if (tagNames.has('Push') && afterDistance > beforeDistance) {
        const opponentReach = maximumDamageRange(opponent);
        const escapedThreat = beforeDistance <= opponentReach && afterDistance > opponentReach;
        const healthPressure = Math.max(0,
            opponent.hp / Math.max(1, opponent.maxHp) - self.hp / Math.max(1, self.maxHp),
        );
        // Direct Push has no lingering status for the state evaluator to see.
        // Value the immediate spacing itself, especially when it breaks the
        // opponent's current threat range or a wounded fighter needs to kite.
        score += (afterDistance - beforeDistance) * self.maxHp * (0.008 + healthPressure * 0.025);
        if (escapedThreat) score += self.maxHp * 0.075;
    }
    if (tagNames.has('Pull') && afterDistance < beforeDistance) {
        // Pull can create the common 60-AP control + 40-AP basic-attack opener.
        // Reward the displacement and likely same-turn follow-up window; the
        // normal candidate pass still enforces actual AP/resources afterward.
        score += (beforeDistance - afterDistance) * self.maxHp * 0.008;
        if (afterDistance <= 1 && plan.effectiveApCost <= 60) score += self.maxHp * 0.075;
    }
    if ((jutsu.tags ?? []).some((tag) => canonicalTagName(tag.name) === 'Copy')) {
        const copyable = hasStatus(self, 'Buff Prevent', round)
            ? []
            : activeStatuses(opponent, round).filter((status) => status.kind === 'positive' && !COPY_EXCLUDED_BUFFS.has(canonicalTagName(status.name)));
        // The live preview already contains every copied status. A tiny
        // efficiency penalty only breaks ties against an equal plain attack;
        // Copy remains a real damaging cast when no payload is available.
        if (copyable.length === 0) score -= self.maxHp * 0.005;
    }
    if ((jutsu.tags ?? []).some((tag) => canonicalTagName(tag.name) === 'Mirror')) {
        const debuffs = hasStatus(opponent, 'Debuff Prevent', round)
            ? []
            : activeStatuses(self, round).filter((status) => status.kind === 'negative');
        if (debuffs.length === 0) score -= self.maxHp * 0.005;
    }
    const resourceCost = plan.chakraCost + plan.staminaCost;
    score -= resourceCost * 0.08;
    score -= plan.effectiveApCost * 0.02;
    return score;
}

function synthWeapon(item: CatalogItem, fighter?: PvpFighter): SimJutsu {
    const tags = [...(item.weaponTags ?? [])];
    if (item.weaponEffect && !tags.some((tag) => canonicalTagName(tag.name) === canonicalTagName(item.weaponEffect!))) {
        tags.push({ name: item.weaponEffect, percent: item.weaponEffectValue ?? 0 });
    }
    return {
        id: 'weapon',
        name: item.name,
        type: 'Bukijutsu',
        element: item.weaponElement,
        ap: Number(item.apCost ?? 40),
        range: Number(item.weaponRange ?? 1),
        effectPower: Number(item.weaponEp ?? 15),
        cooldown: Number(item.weaponCooldown ?? 5),
        isUtility: false,
        weaponSwing: true,
        suppressBloodline: !item.weaponElement
            || !((fighter?.character.elements as string[] | undefined) ?? [String(fighter?.character.element ?? '')]).includes(item.weaponElement),
        tags: tags.map((tag) => ({ ...tag, name: canonicalTagName(tag.name) })),
    };
}

export function chooseAction(
    self: PvpFighter,
    opponent: PvpFighter,
    weapon: CatalogItem,
    cooldowns: Record<string, number>,
    round: number,
    ap: number,
    actions: number,
    castPulseThisTurn = false,
    groundEffects: readonly PvpGroundEffect[] = [],
    selfSeat?: Seat,
): SimAction {
    const candidates: Array<{ action: SimAction; score: number; tie: string }> = [];
    const loadout = (self.character.jutsu as SimJutsu[] | undefined) ?? [];
    for (const jutsu of loadout) {
        const plan = targetTilePlan(jutsu, self, opponent, round, ap, actions, cooldowns[jutsu.id] ?? 0);
        if (!plan) continue;
        candidates.push({ action: { kind: 'jutsu', jutsu, plan }, score: jutsuScore(self, opponent, jutsu, plan, round, castPulseThisTurn), tie: `1-${jutsu.id}` });
    }

    const weaponJutsu = synthWeapon(weapon, self);
    const weaponAp = adjustedApCost(Number(weaponJutsu.ap ?? 40), {
        // Flat +/-TEMPO_AP_SWING: presence only, the stored percent is not read.
        lagged: activeStatuses(self, round).some((status) => canonicalTagName(status.name) === 'Lag'),
        overclocked: activeStatuses(self, round).some((status) => canonicalTagName(status.name) === 'Overclock'),
    });
    const weaponKey = weapon.id;
    if (ap >= weaponAp && (cooldowns[weaponKey] ?? 0) <= 0 && hexDistance(self.pos, opponent.pos) <= Number(weaponJutsu.range ?? 1)) {
        const preview = previewJutsu(self, opponent, weaponJutsu, null, round);
        candidates.push({
            action: { kind: 'weapon', jutsu: weaponJutsu, apCost: weaponAp, cooldownKey: weaponKey, cooldown: Number(weapon.weaponCooldown ?? 5) },
            score: resolvedStateScore(self, opponent, preview, round) - weaponAp * 0.02,
            tie: '2-weapon',
        });
    }

    const canPay = (base: number) => {
        const cost = adjustedApCost(base, {
            lagged: activeStatuses(self, round).some((status) => canonicalTagName(status.name) === 'Lag'),
            overclocked: activeStatuses(self, round).some((status) => canonicalTagName(status.name) === 'Overclock'),
        });
        return { ok: ap >= cost && actions < MAX_ACTIONS, cost };
    };
    const negative = activeStatuses(self, round).filter((status) => status.kind === 'negative');
    const positive = activeStatuses(opponent, round).filter((status) => status.kind === 'positive');
    const cleanse = canPay(60);
    if (cleanse.ok && (cooldowns.cleanse ?? 0) <= 0 && negative.length && !hasStatus(self, 'Cleanse Prevent', round)) {
        const score = negative.reduce((sum, status) => sum + statusValue(status, self, opponent, round), 0);
        candidates.push({ action: { kind: 'cleanse', apCost: cleanse.cost }, score, tie: '0-cleanse' });
    }
    const clear = canPay(60);
    if (clear.ok && (cooldowns.clear ?? 0) <= 0 && positive.length && !hasStatus(opponent, 'Clear Prevent', round)) {
        const score = positive.reduce((sum, status) => sum + statusValue(status, opponent, self, round), 0);
        candidates.push({ action: { kind: 'clear', apCost: clear.cost }, score, tie: '0-clear' });
    }
    const heal = canPay(60);
    if (heal.ok && (cooldowns.basicHeal ?? 0) <= 0 && self.chakra >= 10 && self.hp < self.maxHp) {
        const amount = Math.min(self.maxHp - self.hp, Math.max(1, Math.floor(self.maxHp * 0.10)));
        candidates.push({ action: { kind: 'basicHeal', apCost: heal.cost }, score: amount - heal.cost * 0.02, tie: '3-basic-heal' });
    }
    const basic = canPay(40);
    if (basic.ok && self.stamina >= 10 && hexDistance(self.pos, opponent.pos) <= 1) {
        const specialty = String(self.character.specialty ?? 'Taijutsu');
        const basicJutsu: SimJutsu = { id: 'basic-attack', name: 'Basic Attack', type: specialty, ap: 40, range: 1, effectPower: 10, tags: [] };
        const preview = previewJutsu(self, opponent, basicJutsu, null, round);
        candidates.push({ action: { kind: 'basicAttack', jutsu: basicJutsu, apCost: basic.cost }, score: resolvedStateScore(self, opponent, preview, round), tie: '4-basic' });
    }

    const move = canPay(30);
    const hostileZones = groundEffects.filter((effect) => (
        effect.owner !== selfSeat
        && effect.tiles.includes(self.pos)
        && (effect.rounds > 1 || (effect.activeRound !== undefined && effect.activeRound > round))
    ));
    if (move.ok && hostileZones.length) {
        const dangerousTiles = new Set(hostileZones.flatMap((effect) => effect.tiles));
        const blocked = new Set([opponent.pos, ...barrierTiles(round, self, opponent)]);
        const tile = hexNeighbors(self.pos)
            .filter((candidate) => !blocked.has(candidate) && !dangerousTiles.has(candidate))
            .sort((a, b) => hexDistance(a, opponent.pos) - hexDistance(b, opponent.pos) || a - b)[0];
        if (tile !== undefined) {
            const nextRoundSelf = tickStatuses(clone(self), round);
            const danger = hostileZones.reduce((sum, effect) => {
                const afterPulse = applyGroundEffectToFighter(clone(nextRoundSelf), effect, round + 1).fighter;
                return sum + Math.max(0,
                    fighterStateValue(nextRoundSelf, opponent, round + 1)
                    - fighterStateValue(afterPulse, opponent, round + 1),
                );
            }, 0);
            candidates.push({
                action: { kind: 'move', tile, apCost: move.cost },
                score: danger * 1.15 + self.maxHp * 0.015,
                tie: '0-zone-escape',
            });
        }
    }
    if (move.ok && hexDistance(self.pos, opponent.pos) > 1) {
        const blocked = new Set([opponent.pos, ...barrierTiles(round, self, opponent)]);
        const tile = hexNeighbors(self.pos).filter((candidate) => !blocked.has(candidate))
            .sort((a, b) => hexDistance(a, opponent.pos) - hexDistance(b, opponent.pos) || a - b)[0];
        if (tile !== undefined && hexDistance(tile, opponent.pos) < hexDistance(self.pos, opponent.pos)) {
            candidates.push({ action: { kind: 'move', tile, apCost: move.cost }, score: self.maxHp * 0.055, tie: '5-move' });
        }
    }

    candidates.sort((a, b) => b.score - a.score || a.tie.localeCompare(b.tie));
    if (!candidates.length || candidates[0]!.score <= 0) return { kind: 'pass' };
    return candidates[0]!.action;
}

function payJutsuResources(self: PvpFighter, plan: JutsuActionPlan, round: number): PvpFighter {
    const poisonPct = COMBAT_RESOURCES_V2
        ? sumActiveCombatStatusPercent(self.statuses, 'Poison', round, 6, (actual, expected) => canonicalTagName(actual) === expected)
        : 0;
    const poisonDamage = poisonPct > 0 ? v2PoisonOnSpend(plan.chakraCost + plan.staminaCost, poisonPct) : 0;
    return {
        ...self,
        hp: Math.max(0, self.hp - poisonDamage),
        chakra: Math.max(0, self.chakra - plan.chakraCost),
        stamina: Math.max(0, self.stamina - plan.staminaCost),
    };
}

function tagResolvedInLines(name: string, lines: readonly string[]): boolean {
    const markers: Record<string, readonly string[]> = {
        'Increase Damage Given': ['% Damage Given'],
        'Decrease Damage Given': ['-% Damage Given'],
        'Increase Damage Taken': ['% Damage Taken'],
        'Decrease Damage Taken': ['-% Damage Taken'],
    };
    if (name === 'Increase Damage Given') return lines.some((line) => /^\+\d+% Damage Given/.test(line));
    if (name === 'Decrease Damage Given') return lines.some((line) => /^-\d+% Damage Given/.test(line) || /deals \d+% less damage/i.test(line));
    if (name === 'Increase Damage Taken') return lines.some((line) => /^\+\d+% Damage Taken/.test(line));
    if (name === 'Decrease Damage Taken') return lines.some((line) => /^-\d+% Damage Taken/.test(line));
    if (name === 'Recoil') return lines.some((line) => line.startsWith('Recoil:') || /suffers \d+% recoil/i.test(line));
    if (name === 'Poison') return lines.some((line) => line.startsWith('Poison:') || /is poisoned/i.test(line));
    return lines.some((line) => line.startsWith(`${name}:`) || (markers[name] ?? []).some((marker) => line.includes(marker)));
}

function recordTagResolution(
    state: BattleState,
    tags: readonly CombatTag[],
    lines: readonly string[],
    forcedApplied: ReadonlySet<string> = new Set(),
): void {
    for (const tag of tags) {
        const name = canonicalTagName(tag.name);
        increment(state.tagAttempts, name);
        const blocked = lines.some((line) => line.includes(`${name}`) && /\bblock(?:s|ed)?\b/i.test(line));
        const empty = (name === 'Copy' && lines.some((line) => /Copy:.*copied nothing/i.test(line)))
            || (name === 'Mirror' && lines.some((line) => /Mirror:.*no debuffs/i.test(line)));
        if (!blocked && !empty && (forcedApplied.has(name) || tagResolvedInLines(name, lines))) {
            increment(state.tagApplied, name);
        } else {
            increment(state.tagBlockedOrEmpty, name);
        }
    }
}

function beginGroundTagResolution(state: BattleState, effect: PvpGroundEffect): void {
    const names = [...new Set(effect.tags.map((tag) => canonicalTagName(tag.name)))];
    for (const name of names) increment(state.tagAttempts, name);
    state.groundTagPending[effect.id] = names;
}

function recordGroundPulseResolution(state: BattleState, effect: PvpGroundEffect, lines: readonly string[]): void {
    const pending = state.groundTagPending[effect.id];
    if (!pending?.length) return;
    const wholeEffectBlocked = lines.some((line) => /Debuff Prevent blocks/i.test(line));
    const unresolved: string[] = [];
    for (const name of pending) {
        if (wholeEffectBlocked) unresolved.push(name);
        // The live ground helper is all-or-nothing: an in-zone, unwarded pulse
        // emits one line per supported ground tag. Those lines begin with the
        // authored effect title rather than the canonical tag name.
        else if (lines.length > 0) increment(state.tagApplied, name);
        else unresolved.push(name);
    }
    if (unresolved.length) state.groundTagPending[effect.id] = unresolved;
    else delete state.groundTagPending[effect.id];
}

function finalizeExpiredGroundTags(state: BattleState, liveEffects: readonly PvpGroundEffect[]): void {
    const liveIds = new Set(liveEffects.map((effect) => effect.id));
    for (const [effectId, names] of Object.entries(state.groundTagPending)) {
        if (liveIds.has(effectId)) continue;
        for (const name of names) increment(state.tagBlockedOrEmpty, name);
        delete state.groundTagPending[effectId];
    }
}

function executeJutsu(
    state: BattleState,
    seat: Seat,
    action: Extract<SimAction, { kind: 'jutsu' }>,
): void {
    const opponentSeat = otherSeat(seat);
    let self = state[seat];
    let opponent = state[opponentSeat];
    const { jutsu, plan } = action;
    const tags = jutsu.tags ?? [];
    const lines: string[] = [];
    const forcedApplied = new Set<string>();
    if (plan.move && plan.targetTile !== undefined) {
        self = { ...self, pos: plan.targetTile };
        forcedApplied.add('Move');
        self = payJutsuResources(self, plan, state.round);
        if (plan.createsGroundEffect) {
            let effect: PvpGroundEffect = {
                ...createCanonicalGroundEffect({ id: `${jutsu.id}-${state.round}-${seat}-${state.actionCounts.jutsu ?? 0}`, owner: seat, name: jutsu.name, plan }),
                activeRound: state.round + 1,
            };
            const castPulse = seat === state.opener ? applyGroundEffectToFighter(opponent, effect, state.round, true) : null;
            if (castPulse) opponent = castPulse.fighter;
            if (castPulse) lines.push(...castPulse.lines);
            effect = { ...effect, castPulseConsumed: castPulse !== null && effect.tiles.includes(opponent.pos) };
            beginGroundTagResolution(state, effect);
            if (castPulse) recordGroundPulseResolution(state, effect, castPulse.lines);
            state.groundEffects.push(effect);
        } else if (plan.method === 'AOE_CIRCLE' && plan.hitsOpponent) {
            const result = applyJutsu(self, opponent, { ...jutsu, tags: tags.filter((tag) => canonicalTagName(tag.name) !== 'Move') } as never, 1, 'central', state.round);
            self = result.self;
            opponent = result.opponent;
            lines.push(...result.lines);
        } else if (plan.method !== 'AOE_CIRCLE') {
            const secondary = tags.filter((tag) => {
                const name = canonicalTagName(tag.name);
                return name !== 'Move' && name !== 'Pierce' && !REQUIRES_DAMAGE_TAGS.has(name);
            });
            if (secondary.length) {
                const result = applyJutsu(self, opponent, { ...jutsu, effectPower: 0, tags: secondary } as never, 1, 'central', state.round, 0);
                self = result.self;
                opponent = result.opponent;
                lines.push(...result.lines);
            }
        }
    } else if (plan.createsGroundEffect) {
        self = payJutsuResources(self, plan, state.round);
        let effect: PvpGroundEffect = {
            ...createCanonicalGroundEffect({ id: `${jutsu.id}-${state.round}-${seat}-${state.actionCounts.jutsu ?? 0}`, owner: seat, name: jutsu.name, plan }),
            activeRound: state.round + 1,
        };
        const castPulse = seat === state.opener ? applyGroundEffectToFighter(opponent, effect, state.round, true) : null;
        if (castPulse) opponent = castPulse.fighter;
        if (castPulse) lines.push(...castPulse.lines);
        effect = { ...effect, castPulseConsumed: castPulse !== null && effect.tiles.includes(opponent.pos) };
        beginGroundTagResolution(state, effect);
        if (castPulse) recordGroundPulseResolution(state, effect, castPulse.lines);
        state.groundEffects.push(effect);
    } else if (jutsu.target === 'EMPTY_GROUND' && plan.targetTile !== undefined) {
        self = payJutsuResources(self, plan, state.round);
        if (plan.method === 'AOE_CIRCLE' && plan.hitsOpponent) {
            const result = applyJutsu(self, opponent, jutsu as never, 1, 'central', state.round);
            self = result.self;
            opponent = result.opponent;
            lines.push(...result.lines);
        }
    } else {
        const result = applyJutsu(self, opponent, jutsu as never, 1, 'central', state.round);
        self = payJutsuResources(result.self, plan, state.round);
        opponent = result.opponent;
        lines.push(...result.lines);
    }
    state[seat] = self;
    state[opponentSeat] = opponent;
    if (plan.cooldown > 0) state.cooldowns[seat][jutsu.id] = plan.cooldown;
    const groundNames = new Set(plan.createsGroundEffect
        ? plan.groundTags.map((tag) => canonicalTagName(tag.name))
        : []);
    recordTagResolution(
        state,
        tags.filter((tag) => !groundNames.has(canonicalTagName(tag.name))),
        lines,
        forcedApplied,
    );
    increment(state.actionCounts, 'jutsu');
}

function executeAction(state: BattleState, seat: Seat, action: SimAction): number {
    const opponentSeat = otherSeat(seat);
    let self = state[seat];
    let opponent = state[opponentSeat];
    switch (action.kind) {
        case 'pass': return 0;
        case 'jutsu':
            executeJutsu(state, seat, action);
            return action.plan.effectiveApCost;
        case 'weapon': {
            const result = applyJutsu(self, opponent, action.jutsu as never, 1, 'central', state.round);
            state[seat] = result.self;
            state[opponentSeat] = result.opponent;
            if (action.cooldown > 0) state.cooldowns[seat][action.cooldownKey] = action.cooldown;
            recordTagResolution(state, action.jutsu.tags, result.lines);
            increment(state.actionCounts, 'weapon');
            return action.apCost;
        }
        case 'cleanse': {
            const removed = removeActiveCombatStatusesByKind(self.statuses, 'negative', state.round);
            state[seat] = { ...self, statuses: removed.statuses };
            state.cooldowns[seat].cleanse = CLEANUP_COOLDOWN;
            increment(state.actionCounts, 'cleanse');
            return action.apCost;
        }
        case 'clear': {
            const removed = removeActiveCombatStatusesByKind(opponent.statuses, 'positive', state.round);
            state[opponentSeat] = { ...opponent, statuses: removed.statuses };
            state.cooldowns[seat].clear = CLEANUP_COOLDOWN;
            increment(state.actionCounts, 'clear');
            return action.apCost;
        }
        case 'basicHeal':
            state[seat] = { ...self, hp: Math.min(self.maxHp, self.hp + Math.max(1, Math.floor(self.maxHp * 0.10))), chakra: Math.max(0, self.chakra - 10) };
            state.cooldowns[seat].basicHeal = BASIC_HEAL_COOLDOWN;
            increment(state.actionCounts, 'basicHeal');
            return action.apCost;
        case 'basicAttack': {
            const result = applyJutsu(self, opponent, action.jutsu as never, 1, 'central', state.round);
            state[seat] = { ...result.self, stamina: Math.max(0, result.self.stamina - 10) };
            state[opponentSeat] = result.opponent;
            increment(state.actionCounts, 'basicAttack');
            return action.apCost;
        }
        case 'move':
            state[seat] = { ...self, pos: action.tile };
            increment(state.actionCounts, 'move');
            return action.apCost;
    }
}

function startTurn(state: BattleState, seat: Seat): number {
    const opponentSeat = otherSeat(seat);
    let fighter = state[seat];
    for (const effect of state.groundEffects) {
        if (effect.owner === seat) continue;
        const pulse = applyGroundEffectToFighter(fighter, effect, state.round);
        fighter = pulse.fighter;
        recordGroundPulseResolution(state, effect, pulse.lines);
    }
    fighter = moveQueuedFighter(fighter, state[opponentSeat], state.round);
    fighter = applyDoTs(fighter, state.round).fighter;
    if (COMBAT_RESOURCES_V2) {
        const regen = v2ResourceRegen(Number(fighter.character.level ?? 1));
        fighter = {
            ...fighter,
            chakra: Math.min(fighter.maxChakra, fighter.chakra + regen),
            stamina: Math.min(fighter.maxStamina, fighter.stamina + regen),
        };
    }
    let ap = AP_PER_TURN;
    if (hasStatus(fighter, 'Stun', state.round)) {
        ap = Math.max(0, AP_PER_TURN - STUN_AP_PENALTY);
        fighter = {
            ...fighter,
            statuses: removeActiveCombatStatusesByName(
                fighter.statuses,
                ['Stun'],
                state.round,
                (actual, expected) => canonicalTagName(actual) === expected,
            ).statuses,
        };
    }
    state[seat] = fighter;
    return ap;
}

function winnerNow(state: BattleState): Seat | 'draw' | null {
    if (state.p1.hp <= 0 && state.p2.hp <= 0) return 'draw';
    if (state.p1.hp <= 0) return 'p2';
    if (state.p2.hp <= 0) return 'p1';
    return null;
}

export function simulateFight(p1Build: BuildTemplate, p2Build: BuildTemplate, opener: Seat): FightResult {
    const p1 = clone(p1Build.fighter);
    const p2 = clone(p2Build.fighter);
    p1.character = normalizeHumanPvpLoadout(p1.character);
    p2.character = normalizeHumanPvpLoadout(p2.character);
    p1.pos = P1_START;
    p2.pos = P2_START;
    validateUnderstoodTags((p1.character.jutsu as SimJutsu[]) ?? []);
    validateUnderstoodTags((p2.character.jutsu as SimJutsu[]) ?? []);
    const state: BattleState = {
        p1, p2,
        cooldowns: { p1: {}, p2: {} },
        groundEffects: [],
        round: 1,
        opener,
        tagAttempts: {},
        tagApplied: {},
        tagBlockedOrEmpty: {},
        groundTagPending: {},
        actionCounts: {},
    };
    const order: readonly Seat[] = opener === 'p1' ? ['p1', 'p2'] : ['p2', 'p1'];
    let winner: Seat | 'draw' | null = null;
    for (let round = 1; round <= MAX_ROUNDS && !winner; round += 1) {
        state.round = round;
        for (const seat of order) {
            let ap = startTurn(state, seat);
            winner = winnerNow(state);
            if (winner) break;
            let actions = 0;
            const weapon = seat === 'p1' ? p1Build.weapon : p2Build.weapon;
            while (ap > 0 && actions < MAX_ACTIONS && !winner) {
                const action = chooseAction(
                    state[seat],
                    state[otherSeat(seat)],
                    weapon,
                    state.cooldowns[seat],
                    round,
                    ap,
                    actions,
                    seat === state.opener,
                    state.groundEffects,
                    seat,
                );
                if (action.kind === 'pass') break;
                const spent = executeAction(state, seat, action);
                if (spent <= 0 || spent > ap) throw new Error(`Invalid ${action.kind} AP spend ${spent}/${ap}.`);
                ap -= spent;
                actions += 1;
                winner = winnerNow(state);
            }
            state.cooldowns[seat] = tickCombatCooldowns(state.cooldowns[seat]);
            if (winner) break;
        }
        if (!winner) {
            state.p1 = tickStatuses(state.p1, round);
            state.p2 = tickStatuses(state.p2, round);
            const groundEffects = tickGroundEffects(state.groundEffects, round, opener);
            finalizeExpiredGroundTags(state, groundEffects);
            state.groundEffects = groundEffects;
        }
    }
    finalizeExpiredGroundTags(state, []);
    const timeout = winner === null;
    if (!winner) {
        const p1Health = pvpNormalizedEffectiveHealth(state.p1);
        const p2Health = pvpNormalizedEffectiveHealth(state.p2);
        winner = p1Health > p2Health ? 'p1' : p2Health > p1Health ? 'p2' : 'draw';
    }
    return {
        winner,
        rounds: state.round,
        timeout,
        opener,
        p1Health: pvpNormalizedEffectiveHealth(state.p1),
        p2Health: pvpNormalizedEffectiveHealth(state.p2),
        p1Chakra: state.p1.chakra / Math.max(1, state.p1.maxChakra),
        p1Stamina: state.p1.stamina / Math.max(1, state.p1.maxStamina),
        p2Chakra: state.p2.chakra / Math.max(1, state.p2.maxChakra),
        p2Stamina: state.p2.stamina / Math.max(1, state.p2.maxStamina),
        tagAttempts: state.tagAttempts,
        tagApplied: state.tagApplied,
        tagBlockedOrEmpty: state.tagBlockedOrEmpty,
        actionCounts: state.actionCounts,
    };
}

export function makeLevelRoster(level: number, options: BuildOptions = {}): BuildTemplate[] {
    return ARCHETYPES.flatMap((archetype) => BLOODLINE_RANKS.map((rank) => makeBuild(level, archetype, rank, options)));
}

const COMPETITIVE_TEMPLATE_PROFILE = {
    Burst: 'glass-cannon',
    Sustain: 'bruiser',
    Control: 'controller',
    Prevention: 'support',
} as const satisfies Partial<Record<Archetype, string>>;

export const COMPETITIVE_ARCHETYPES = Object.keys(COMPETITIVE_TEMPLATE_PROFILE) as Array<keyof typeof COMPETITIVE_TEMPLATE_PROFILE>;
/** Two legal stat/discipline/gear constructions per combat discipline. */
export const COMPETITIVE_PROFILES: readonly Archetype[] = ARCHETYPES;

/**
 * Server-build-safe mirror of ARCHETYPE_SPECS in the client Bloodline Maker.
 * The simulator is compiled under Node16/CommonJS while the client package is
 * ESM, so importing the client helper directly breaks the server typecheck.
 * Keep names/order/tags in lock-step with
 * shinobij.client/src/lib/bloodline-templates.ts; its own parity tests guard the
 * creator rules, while the harness tests below guard this sealed projection.
 */
function competitiveTemplateDraft(
    archetype: typeof COMPETITIVE_ARCHETYPES[number],
    rank: BloodlineRank,
    profileArchetype: Archetype = archetype,
): SimJutsu[] {
    const discipline = PROFILE[profileArchetype].discipline;
    const p = 30;
    const standard = (name: string, tags: CombatTag[] = [], options: Partial<SimJutsu> = {}) => (
        draftJutsu(archetype, discipline, name.replace(/\s+/g, '-'), tags, options)
    );
    const utility = (name: string, tags: CombatTag[], target = 'SELF') => standard(name, tags, {
        ap: 40, effectPower: 0, target,
    });
    const nuke = (name: string, tags: CombatTag[]) => standard(name, tags, { effectPower: 50 });
    const all: Record<typeof COMPETITIVE_ARCHETYPES[number], SimJutsu[]> = {
        Burst: [
            nuke('Annihilation Blast', [{ name: 'Increase Damage Given', percent: p }]),
            standard('Piercing Lance', [{ name: 'Pierce' }]),
            standard('Searing Barrage', [{ name: 'Ignition', percent: p }, { name: 'Wound', percent: p }]),
            standard('Exposed Nerve', [{ name: 'Increase Damage Taken', percent: p }]),
            utility('Battle Trance', [{ name: 'Increase Damage Given', percent: p }, { name: 'Overclock' }]),
        ],
        Sustain: [
            standard('Rending Strike', [{ name: 'Wound', percent: p }, { name: 'Decrease Damage Given', percent: p }]),
            standard('Leeching Blow', [{ name: 'Lifesteal', percent: p }]),
            nuke('Devastator', [{ name: 'Increase Damage Given', percent: p }]),
            standard('Chakra Siphon', [{ name: 'Siphon', percent: p }]),
            utility('Iron Resolve', [{ name: 'Decrease Damage Taken', percent: p }, { name: 'Increase Heal', percent: p }]),
        ],
        Control: [
            standard('Paralyzing Grip', [{ name: 'Stun' }]),
            standard('Bloodline Sever', [{ name: 'Bloodline Seal' }, { name: 'Drain' }]),
            standard('Crippling Hex', [{ name: 'Decrease Damage Given', percent: p }]),
            standard('Venom Curse', [{ name: 'Poison', percent: p }]),
            utility('Mind Fog', [{ name: 'Buff Prevent' }, { name: 'Decrease Damage Given', percent: p }], 'OPPONENT'),
        ],
        Prevention: [
            standard('Aegis Ward', [{ name: 'Shield' }, { name: 'Decrease Damage Taken', percent: p }]),
            standard('Mending Tide', [{ name: 'Heal' }]),
            standard('Reflective Guard', [{ name: 'Reflect', percent: p }]),
            standard('Suppressing Field', [{ name: 'Decrease Damage Given', percent: p }]),
            utility('Bulwark Stance', [{ name: 'Debuff Prevent' }, { name: 'Decrease Damage Taken', percent: p }]),
        ],
    };
    const expectedCount = rank === 'A Rank' ? 5 : 4;
    return all[archetype].slice(0, expectedCount).map((jutsu, index) => ({
        ...jutsu,
        id: `competitive-${rank[0].toLowerCase()}-${archetype.toLowerCase()}-${profileArchetype.toLowerCase()}-${index + 1}`,
        name: `${PROFILE[profileArchetype].element} ${jutsu.name}`,
        element: PROFILE[profileArchetype].element,
    }));
}

/**
 * Builds the four quick-start bloodlines that players actually receive in the
 * Bloodline Maker, at both A and B rank. The larger eight-role roster above is
 * intentionally adversarial: it packs rare/conditional tags together to stress
 * mechanics and AI coverage. Keeping this roster separate prevents a deliberately
 * awkward Copy+Mirror or all-prevention kit from masquerading as the population
 * balance of competitive player builds.
 */
export function makeCompetitiveTemplateRoster(
    level: number,
    options: BuildOptions = {},
    fixedProfile?: Archetype,
): BuildTemplate[] {
    return COMPETITIVE_ARCHETYPES.flatMap((archetype) => BLOODLINE_RANKS.map((rank) => {
        const profileArchetype = fixedProfile ?? archetype;
        const base = makeBuild(level, profileArchetype, rank, options);
        const profile = PROFILE[profileArchetype];
        const drafted = competitiveTemplateDraft(archetype, rank, profileArchetype);
        const normalized = normalizePlayerBloodlineJutsus(drafted, rank) as SimJutsu[];
        const expectedCount = rank === 'A Rank' ? 5 : 4;
        const points = bloodlinePoints(normalized, rank);
        if (normalized.length !== expectedCount || points > pointBudgetForRank(rank)) {
            throw new Error(`${rank} ${archetype} competitive template sealed at ${normalized.length} jutsu / ${points} points.`);
        }
        const custom = normalized.map((jutsu) => ({
            ...jutsu,
            ...v2JutsuCosts(jutsu, level, profile.discipline),
            bloodlineRank: rank,
            tags: (jutsu.tags ?? []).map((tag) => ({ ...tag, name: canonicalTagName(tag.name) })),
        } as SimJutsu));
        // makeBuild already produced the correct same-rank common core. Replace
        // only its synthetic custom prefix, retaining the exact legal filler,
        // gear, stats, resources, and rank-derived bloodline multiplier.
        const loadout = [...custom, ...base.jutsu.slice(expectedCount)];
        if (loadout.length !== base.loadoutSize) {
            throw new Error(`${rank} ${archetype} competitive loadout has ${loadout.length}/${base.loadoutSize} slots.`);
        }
        const name = `${base.name}-Official-${COMPETITIVE_TEMPLATE_PROFILE[archetype]}-on-${profileArchetype.toLowerCase()}`;
        const character = {
            ...base.fighter.character,
            jutsu: loadout,
            jutsuMastery: loadout.map((jutsu) => ({
                jutsuId: jutsu.id,
                level: Math.min(JUTSU_MAX_LEVEL, jutsuLevelCapForLevel(level)),
            })),
        };
        return {
            ...base,
            id: `${base.id}-official-${COMPETITIVE_TEMPLATE_PROFILE[archetype]}-on-${profileArchetype.toLowerCase()}`,
            name,
            archetype,
            profileArchetype,
            jutsu: loadout,
            fighter: { ...base.fighter, name, character },
        };
    }));
}

function gearSummary(roster: readonly BuildTemplate[]): string {
    const first = roster[0]!;
    const armor = first.equipmentIds.map((id) => (first.fighter.character.pvpItems as CatalogItem[]).find((item) => item.id === id))
        .filter((item): item is CatalogItem => !!item && !!item.armorQuality);
    const rawDr = Number(first.fighter.character.armorRawDR ?? 0);
    const weaponEps = [...new Set(roster.map((build) => Number(build.weapon.weaponEp ?? 0)))].sort((a, b) => a - b);
    const named = roster.every((build) => build.namedGear);
    return `${named ? 'max-roll named' : armor[0]?.armorQuality ?? 'none'} armor (${(rawDr * 100).toFixed(0)}% raw DR), weapon EP ${weaponEps.join('-')}${named ? ' range 5' : ''}`;
}

function evaluateLevel(report: Omit<LevelBalanceReport, 'issues'>): string[] {
    const issues: string[] = [];
    const p1Rate = scoredRate(report.seats.p1);
    const openerRate = scoredRate(report.opener);
    if (p1Rate < FAIR_INITIATIVE_LOW || p1Rate > FAIR_INITIATIVE_HIGH) issues.push(`Seat skew: P1 scored ${(p1Rate * 100).toFixed(1)}%.`);
    if (openerRate < FAIR_INITIATIVE_LOW || openerRate > FAIR_INITIATIVE_HIGH) issues.push(`Initiative skew: opener scored ${(openerRate * 100).toFixed(1)}%.`);
    for (const archetype of ARCHETYPES) {
        const rate = scoredRate(report.archetypes[archetype]);
        if (rate < FAIR_ARCHETYPE_LOW || rate > FAIR_ARCHETYPE_HIGH) issues.push(`${archetype} scored ${(rate * 100).toFixed(1)}% (target 40-60%).`);
    }
    for (let i = 0; i < ARCHETYPES.length; i += 1) {
        for (let j = i + 1; j < ARCHETYPES.length; j += 1) {
            const a = ARCHETYPES[i]!;
            const b = ARCHETYPES[j]!;
            const tally = report.matchups[a][b];
            const rate = scoredRate(tally);
            if (tally.games > 0 && (rate < 0.30 || rate > 0.70)) {
                issues.push(`${a} vs ${b} is ${(rate * 100).toFixed(1)}% (${tally.games} perspectives; target 30-70%).`);
            }
        }
    }
    const aCross = scoredRate(report.rankCross['A Rank']);
    if (report.rankCross['A Rank'].games > 0 && (aCross < 0.50 || aCross > 0.70)) {
        issues.push(`A-rank scored ${(aCross * 100).toFixed(1)}% directly against B-rank (expected modest 50-70% edge).`);
    }
    if (report.timeouts / report.totalFights > 0.25) issues.push(`Timeout rate ${(100 * report.timeouts / report.totalFights).toFixed(1)}% exceeds 25%.`);
    if (report.earlyKos / report.totalFights > 0.05) issues.push(`Round-1/2 KO rate ${(100 * report.earlyKos / report.totalFights).toFixed(1)}% exceeds 5%.`);
    if (report.uncastAvailableTags.length) issues.push(`Policy never selected available tags: ${report.uncastAvailableTags.join(', ')}.`);
    const attemptedButNeverApplied = report.unappliedAvailableTags.filter((tag) => !report.uncastAvailableTags.includes(tag));
    if (attemptedButNeverApplied.length) issues.push(`Selected tags never successfully applied: ${attemptedButNeverApplied.join(', ')}.`);
    const buildGames = Object.values(report.builds).reduce((sum, tally) => sum + tally.games, 0);
    const buildWins = Object.values(report.builds).reduce((sum, tally) => sum + tally.wins, 0);
    const buildLosses = Object.values(report.builds).reduce((sum, tally) => sum + tally.losses, 0);
    const buildDraws = Object.values(report.builds).reduce((sum, tally) => sum + tally.draws, 0);
    if (buildGames !== report.totalFights * 2 || buildWins !== buildLosses || buildDraws !== report.draws * 2) {
        issues.push('Tournament tally conservation failed.');
    }
    return issues;
}

export function runLevelTournament(level: number, options: TournamentOptions = {}): LevelBalanceReport {
    const roster = options.roster ?? makeLevelRoster(level, options);
    if (roster.length < 2 || roster.some((build) => build.level !== level)) {
        throw new Error(`Tournament roster must contain at least two level-${level} builds.`);
    }
    const builds = Object.fromEntries(roster.map((build) => [build.id, emptyTally()])) as Record<string, Tally>;
    const archetypes = Object.fromEntries(ARCHETYPES.map((name) => [name, emptyTally()])) as Record<Archetype, Tally>;
    const matchups = Object.fromEntries(ARCHETYPES.map((a) => [
        a,
        Object.fromEntries(ARCHETYPES.map((b) => [b, emptyTally()])),
    ])) as Record<Archetype, Record<Archetype, Tally>>;
    const ranks = Object.fromEntries(BLOODLINE_RANKS.map((rank) => [rank, emptyTally()])) as Record<BloodlineRank, Tally>;
    const rankCross = Object.fromEntries(BLOODLINE_RANKS.map((rank) => [rank, emptyTally()])) as Record<BloodlineRank, Tally>;
    const seats: Record<Seat, Tally> = { p1: emptyTally(), p2: emptyTally() };
    const opener = emptyTally();
    const tagAttempts: Record<string, number> = {};
    const tagApplied: Record<string, number> = {};
    const tagBlockedOrEmpty: Record<string, number> = {};
    const actionCounts: Record<string, number> = {};
    let totalFights = 0;
    let draws = 0;
    let timeouts = 0;
    let totalRounds = 0;
    let earlyKos = 0;
    let endChakraTotal = 0;
    let endStaminaTotal = 0;
    let endChakraBelowTen = 0;
    let endStaminaBelowTen = 0;
    const roundSamples: number[] = [];

    const runBout = (p1Template: BuildTemplate, p2Template: BuildTemplate, openingSeat: Seat) => {
        const result = simulateFight(p1Template, p2Template, openingSeat);
        totalFights += 1;
        totalRounds += result.rounds;
        roundSamples.push(result.rounds);
        if (!result.timeout && result.rounds <= 2) earlyKos += 1;
        if (result.winner === 'draw') draws += 1;
        if (result.timeout) timeouts += 1;
        for (const value of [result.p1Chakra, result.p2Chakra]) {
            endChakraTotal += value;
            if (value < 0.10) endChakraBelowTen += 1;
        }
        for (const value of [result.p1Stamina, result.p2Stamina]) {
            endStaminaTotal += value;
            if (value < 0.10) endStaminaBelowTen += 1;
        }
        for (const [tag, count] of Object.entries(result.tagAttempts)) increment(tagAttempts, tag, count);
        for (const [tag, count] of Object.entries(result.tagApplied)) increment(tagApplied, tag, count);
        for (const [tag, count] of Object.entries(result.tagBlockedOrEmpty)) increment(tagBlockedOrEmpty, tag, count);
        for (const [action, count] of Object.entries(result.actionCounts)) increment(actionCounts, action, count);
        const outcome = (seat: Seat): 'win' | 'loss' | 'draw' => result.winner === 'draw' ? 'draw' : result.winner === seat ? 'win' : 'loss';
        const p1Outcome = outcome('p1');
        const p2Outcome = outcome('p2');
        record(seats.p1, p1Outcome);
        record(seats.p2, p2Outcome);
        record(opener, outcome(openingSeat));
        record(builds[p1Template.id]!, p1Outcome);
        record(builds[p2Template.id]!, p2Outcome);
        record(archetypes[p1Template.archetype], p1Outcome);
        record(archetypes[p2Template.archetype], p2Outcome);
        record(matchups[p1Template.archetype][p2Template.archetype], p1Outcome);
        record(matchups[p2Template.archetype][p1Template.archetype], p2Outcome);
        record(ranks[p1Template.bloodlineRank], p1Outcome);
        record(ranks[p2Template.bloodlineRank], p2Outcome);
        if (p1Template.bloodlineRank !== p2Template.bloodlineRank) {
            record(rankCross[p1Template.bloodlineRank], p1Outcome);
            record(rankCross[p2Template.bloodlineRank], p2Outcome);
        }
    };

    for (let i = 0; i < roster.length; i += 1) {
        for (let j = i + 1; j < roster.length; j += 1) {
            runBout(roster[i]!, roster[j]!, 'p1');
            runBout(roster[i]!, roster[j]!, 'p2');
            runBout(roster[j]!, roster[i]!, 'p1');
            runBout(roster[j]!, roster[i]!, 'p2');
        }
    }

    roundSamples.sort((a, b) => a - b);
    const percentile = (p: number) => roundSamples[Math.min(roundSamples.length - 1, Math.floor((roundSamples.length - 1) * p))] ?? 0;
    const availableTags = [...new Set(roster.flatMap((build) => [
        ...build.jutsu.flatMap((jutsu) => jutsu.tags.map((tag) => canonicalTagName(tag.name))),
        ...synthWeapon(build.weapon, build.fighter).tags.map((tag) => canonicalTagName(tag.name)),
    ]))].sort();
    const uncastAvailableTags = availableTags.filter((tag) => (tagAttempts[tag] ?? 0) === 0);
    const unappliedAvailableTags = availableTags.filter((tag) => (tagApplied[tag] ?? 0) === 0);
    const representative = roster[0]!;
    const base = {
        level,
        label: options.label ?? (level === 100 && representative.fullyCapped
            ? `Fully capped (${representative.namedGear ? 'max legal named gear' : 'standard endgame gear'})`
            : `Level ${level}`),
        rosterSize: roster.length,
        totalFights,
        draws,
        timeouts,
        totalRounds,
        roundP10: percentile(0.10),
        roundMedian: percentile(0.50),
        roundP90: percentile(0.90),
        earlyKos,
        seats,
        opener,
        ranks,
        rankCross,
        archetypes,
        matchups,
        builds,
        // Kept as a report alias for callers of the first simulator version.
        tagCasts: tagAttempts,
        tagAttempts,
        tagApplied,
        tagBlockedOrEmpty,
        availableTags,
        uncastAvailableTags,
        unappliedAvailableTags,
        actionCounts,
        gearSummary: gearSummary(roster),
        statCap: statCapForLevel(level),
        masteryCap: jutsuLevelCapForLevel(level),
        earnedStats: representative.earnedStats,
        loadoutSize: representative.loadoutSize,
        namedGear: representative.namedGear,
        resources: {
            meanChakra: endChakraTotal / Math.max(1, totalFights * 2),
            meanStamina: endStaminaTotal / Math.max(1, totalFights * 2),
            chakraBelowTenPct: endChakraBelowTen / Math.max(1, totalFights * 2),
            staminaBelowTenPct: endStaminaBelowTen / Math.max(1, totalFights * 2),
        },
    };
    return { ...base, issues: evaluateLevel(base) };
}

function printLevel(report: LevelBalanceReport): void {
    console.log(`\n${'='.repeat(84)}`);
    console.log(`${report.label} — ${report.totalFights} crossed fights, ${report.rosterSize} legal builds`);
    console.log(`${'='.repeat(84)}`);
    console.log(`Stats: ${report.earnedStats} earned; per-stat cap ${report.statCap}; mastery cap ${report.masteryCap}`);
    console.log(`Gear:  ${report.gearSummary}`);
    console.log(`Rounds: avg ${(report.totalRounds / report.totalFights).toFixed(2)}; p10/median/p90 ${report.roundP10}/${report.roundMedian}/${report.roundP90}; early KO ${report.earlyKos} (${(100 * report.earlyKos / report.totalFights).toFixed(1)}%); timeouts ${report.timeouts} (${(100 * report.timeouts / report.totalFights).toFixed(1)}%); draws ${report.draws}`);
    console.log(`End resources: chakra ${(100 * report.resources.meanChakra).toFixed(1)}% mean (${(100 * report.resources.chakraBelowTenPct).toFixed(1)}% below 10%); stamina ${(100 * report.resources.meanStamina).toFixed(1)}% mean (${(100 * report.resources.staminaBelowTenPct).toFixed(1)}% below 10%).`);
    console.log(`Seat:   P1 ${(100 * scoredRate(report.seats.p1)).toFixed(1)}% | opener ${(100 * scoredRate(report.opener)).toFixed(1)}%`);
    console.log(`Ranks:  A vs B ${(100 * scoredRate(report.rankCross['A Rank'])).toFixed(1)}% / ${(100 * scoredRate(report.rankCross['B Rank'])).toFixed(1)}%`);
    console.log('Archetypes (draw = half-win):');
    for (const archetype of ARCHETYPES) {
        const tally = report.archetypes[archetype];
        console.log(`  ${archetype.padEnd(11)} ${(100 * scoredRate(tally)).toFixed(1).padStart(5)}%  W ${String(tally.wins).padStart(3)} L ${String(tally.losses).padStart(3)} D ${String(tally.draws).padStart(3)}`);
    }
    const tagUse = report.availableTags.map((tag) => `${tag}:${report.tagApplied[tag] ?? 0}/${report.tagAttempts[tag] ?? 0}`);
    console.log(`Tag-use coverage: ${report.availableTags.length - report.uncastAvailableTags.length}/${report.availableTags.length} attempted; ${report.availableTags.length - report.unappliedAvailableTags.length}/${report.availableTags.length} applied.`);
    console.log(`Tags (applied/attempted): ${tagUse.join(', ')}`);
    const blocked = Object.entries(report.tagBlockedOrEmpty).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    if (blocked.length) console.log(`Blocked/no-target tag attempts: ${blocked.map(([tag, count]) => `${tag}:${count}`).join(', ')}`);
    if (report.issues.length) {
        console.log('Balance flags:');
        for (const issue of report.issues) console.log(`  - ${issue}`);
    } else {
        console.log('Balance flags: none.');
    }
}

export function runCertification(levels: readonly number[] = TEST_LEVELS): BalanceCertification {
    const reports = levels.map((level) => runLevelTournament(level));
    const issues = reports.flatMap((report) => report.issues.map((issue) => `${report.label}: ${issue}`));
    return {
        generatedAt: new Date().toISOString(),
        engine: 'live api/pvp/move.ts resolver + live action planner; deterministic tag-aware policy; human-PvP-normalized 12-slot loadouts plus 15-slot entitlement isolation',
        levels: reports,
        issues,
    };
}

export function runCompetitiveCertification(levels: readonly number[] = TEST_LEVELS): BalanceCertification {
    const reports = levels.map((level) => runLevelTournament(level, {
        roster: makeCompetitiveTemplateRoster(level),
        label: level === MAX_LEVEL ? 'Fully capped (official Bloodline Maker templates)' : `Level ${level} (official Bloodline Maker templates)`,
    }));
    const issues = reports.flatMap((report) => report.issues.map((issue) => `${report.label}: ${issue}`));
    return {
        generatedAt: new Date().toISOString(),
        engine: 'live api/pvp/move.ts resolver + official Bloodline Maker A/B templates + deterministic tag-aware policy',
        levels: reports,
        issues,
    };
}

/**
 * Isolates the live A/B damage multiplier from loadout construction.
 *
 * The official A template contains five custom techniques while B contains
 * four, so forcing every custom button into a 12-slot simulator loadout also
 * gives B one additional common technique. Real players may omit any custom
 * technique. For the actual rank check, give the A fighter the B fighter's
 * exact 12 buttons while preserving A's authoritative character multipliers,
 * then cross both seats and both openers.
 */
export function runRankIsolationControl(level: number): Tally {
    const aRank = emptyTally();
    const recordA = (result: FightResult, aSeat: Seat) => {
        record(aRank, result.winner === 'draw' ? 'draw' : result.winner === aSeat ? 'win' : 'loss');
    };

    for (const profile of COMPETITIVE_PROFILES) {
        const roster = makeCompetitiveTemplateRoster(level, {}, profile);
        for (const archetype of COMPETITIVE_ARCHETYPES) {
            const originalA = roster.find((build) => build.archetype === archetype && build.bloodlineRank === 'A Rank');
            const b = roster.find((build) => build.archetype === archetype && build.bloodlineRank === 'B Rank');
            if (!originalA || !b) throw new Error(`Missing ${archetype}/${profile} A/B rank-isolation build.`);

            const sharedJutsu = clone(b.jutsu);
            const sharedMastery = clone(b.fighter.character.jutsuMastery ?? []);
            const a: BuildTemplate = {
                ...originalA,
                jutsu: sharedJutsu,
                fighter: {
                    ...originalA.fighter,
                    character: {
                        ...originalA.fighter.character,
                        jutsu: sharedJutsu,
                        jutsuMastery: sharedMastery,
                    },
                },
            };

            recordA(simulateFight(a, b, 'p1'), 'p1');
            recordA(simulateFight(a, b, 'p2'), 'p1');
            recordA(simulateFight(b, a, 'p1'), 'p2');
            recordA(simulateFight(b, a, 'p2'), 'p2');
        }
    }
    return aRank;
}

/**
 * Cross-controls the official quick-start bloodlines against construction.
 * Every template is tested at both A/B rank on all eight legal construction
 * profiles (two each for Ninjutsu, Genjutsu, Taijutsu, and Bukijutsu), but a tournament compares fighters only
 * within the same profile. This keeps equipment and stat allocation real while
 * preventing one arbitrarily favorable profile from being misreported as a
 * property of the bloodline tags assigned to it.
 */
export function runCompetitiveProfileRotation(level: number): CompetitiveProfileRotationLevelReport {
    const profiles = COMPETITIVE_PROFILES.map((profile) => ({
        profile,
        report: runLevelTournament(level, {
            roster: makeCompetitiveTemplateRoster(level, {}, profile),
            label: `${level === MAX_LEVEL ? 'Fully capped' : `Level ${level}`} — ${profile} construction`,
        }),
    }));
    const opener = emptyTally();
    const rankCross = Object.fromEntries(BLOODLINE_RANKS.map((rank) => [rank, emptyTally()])) as Record<BloodlineRank, Tally>;
    const archetypes = Object.fromEntries(ARCHETYPES.map((name) => [name, emptyTally()])) as Record<Archetype, Tally>;
    const tagAttempts: Record<string, number> = {};
    const tagApplied: Record<string, number> = {};
    let totalFights = 0;
    let totalRounds = 0;
    let earlyKos = 0;
    let timeouts = 0;
    let draws = 0;
    for (const { report } of profiles) {
        totalFights += report.totalFights;
        totalRounds += report.totalRounds;
        earlyKos += report.earlyKos;
        timeouts += report.timeouts;
        draws += report.draws;
        mergeTally(opener, report.opener);
        for (const rank of BLOODLINE_RANKS) mergeTally(rankCross[rank], report.rankCross[rank]);
        for (const archetype of ARCHETYPES) mergeTally(archetypes[archetype], report.archetypes[archetype]);
        for (const [tag, count] of Object.entries(report.tagAttempts)) increment(tagAttempts, tag, count);
        for (const [tag, count] of Object.entries(report.tagApplied)) increment(tagApplied, tag, count);
    }
    const availableTags = [...new Set(profiles.flatMap(({ report }) => report.availableTags))].sort();
    const uncastAvailableTags = availableTags.filter((tag) => (tagAttempts[tag] ?? 0) === 0);
    const rankIsolationA = runRankIsolationControl(level);
    const medians = profiles.map(({ report }) => report.roundMedian);
    const label = level === MAX_LEVEL
        ? 'Fully capped (official templates across eight legal profiles)'
        : `Level ${level} (official templates across eight legal profiles)`;
    const issues: string[] = [];
    const openerRate = scoredRate(opener);
    if (openerRate < FAIR_INITIATIVE_LOW || openerRate > FAIR_INITIATIVE_HIGH) {
        issues.push(`Initiative skew: opener scored ${(100 * openerRate).toFixed(1)}%.`);
    }
    for (const archetype of COMPETITIVE_ARCHETYPES) {
        const rate = scoredRate(archetypes[archetype]);
        if (rate < FAIR_ARCHETYPE_LOW || rate > FAIR_ARCHETYPE_HIGH) {
            issues.push(`${archetype} template scored ${(100 * rate).toFixed(1)}% after profile rotation (target 40-60%).`);
        }
    }
    const isolatedA = scoredRate(rankIsolationA);
    if (rankIsolationA.games > 0 && (isolatedA < 0.50 || isolatedA > 0.70)) {
        issues.push(`A-rank scored ${(100 * isolatedA).toFixed(1)}% with identical 12-button loadouts (expected modest 50-70% edge).`);
    }
    if (earlyKos / Math.max(1, totalFights) > 0.05) {
        issues.push(`Round-1/2 KO rate ${(100 * earlyKos / totalFights).toFixed(1)}% exceeds 5%.`);
    }
    if (timeouts / Math.max(1, totalFights) > 0.25) {
        issues.push(`Timeout rate ${(100 * timeouts / totalFights).toFixed(1)}% exceeds 25%.`);
    }
    return {
        level,
        label,
        profiles,
        totalFights,
        totalRounds,
        earlyKos,
        timeouts,
        draws,
        medianRoundLow: Math.min(...medians),
        medianRoundHigh: Math.max(...medians),
        opener,
        rankIsolationA,
        rankCross,
        archetypes,
        tagAttempts,
        tagApplied,
        availableTags,
        uncastAvailableTags,
        issues,
    };
}

export function runCompetitiveProfileRotationCertification(
    levels: readonly number[] = TEST_LEVELS,
): CompetitiveProfileRotationCertification {
    const reports = levels.map((level) => runCompetitiveProfileRotation(level));
    const issues = reports.flatMap((report) => report.issues.map((issue) => `${report.label}: ${issue}`));
    return {
        generatedAt: new Date().toISOString(),
        engine: 'live PvP resolver + official A/B Bloodline Maker templates + four controlled legal gear/stat/discipline profiles + deterministic tag-aware policy',
        levels: reports,
        issues,
    };
}

function printCompetitiveProfileRotation(report: CompetitiveProfileRotationLevelReport): void {
    console.log(`\n${'='.repeat(84)}`);
    console.log(`${report.label} — ${report.totalFights} crossed fights`);
    console.log(`${'='.repeat(84)}`);
    console.log(`Rounds: avg ${(report.totalRounds / report.totalFights).toFixed(2)}; profile medians ${report.medianRoundLow}-${report.medianRoundHigh}; early KO ${report.earlyKos} (${(100 * report.earlyKos / report.totalFights).toFixed(1)}%); timeouts ${report.timeouts} (${(100 * report.timeouts / report.totalFights).toFixed(1)}%); draws ${report.draws}`);
    console.log(`Initiative: opener ${(100 * scoredRate(report.opener)).toFixed(1)}% | forced-template loadouts A vs B ${(100 * scoredRate(report.rankCross['A Rank'])).toFixed(1)}% / ${(100 * scoredRate(report.rankCross['B Rank'])).toFixed(1)}%`);
    console.log(`Rank isolation (identical 12 buttons): A ${(100 * scoredRate(report.rankIsolationA)).toFixed(1)}% / B ${(100 * (1 - scoredRate(report.rankIsolationA))).toFixed(1)}% across ${report.rankIsolationA.games} fights.`);
    console.log('Templates after profile rotation (draw = half-win):');
    for (const archetype of COMPETITIVE_ARCHETYPES) {
        const tally = report.archetypes[archetype];
        console.log(`  ${archetype.padEnd(11)} ${(100 * scoredRate(tally)).toFixed(1).padStart(5)}%  W ${String(tally.wins).padStart(3)} L ${String(tally.losses).padStart(3)} D ${String(tally.draws).padStart(3)}`);
    }
    console.log('Construction sensitivity (template rates within each controlled profile):');
    for (const { profile, report: profileReport } of report.profiles) {
        const rates = COMPETITIVE_ARCHETYPES.map((archetype) => `${archetype} ${(100 * scoredRate(profileReport.archetypes[archetype])).toFixed(1)}%`);
        console.log(`  ${profile.padEnd(11)} ${rates.join(' | ')}`);
    }
    console.log(`Tag-use coverage: ${report.availableTags.length - report.uncastAvailableTags.length}/${report.availableTags.length} attempted; ${report.availableTags.filter((tag) => (report.tagApplied[tag] ?? 0) > 0).length}/${report.availableTags.length} applied.`);
    if (report.issues.length) {
        console.log('Systemic balance flags:');
        for (const issue of report.issues) console.log(`  - ${issue}`);
    } else {
        console.log('Systemic balance flags: none.');
    }
}

/**
 * Verifies the human-PvP fair-loadout seal. Supporter saves may carry 15
 * equipped techniques elsewhere, but live human PvP projects both origins to
 * the same 12 regular buttons before combat. Both seats/openers prove that the
 * pre-seal entitlement cannot leak into a paid combat advantage.
 */
export function runEntitlementComparison(level: number): EntitlementBalanceReport {
    const baseRoster = makeLevelRoster(level, { loadoutSize: LOADOUT_CAP_BASE });
    const supporterRoster = makeLevelRoster(level, { loadoutSize: LOADOUT_CAP_SUB });
    const base = emptyTally();
    const supporter = emptyTally();
    let fights = 0;

    const bout = (p1: BuildTemplate, p2: BuildTemplate, supporterSeat: Seat, opener: Seat) => {
        const result = simulateFight(p1, p2, opener);
        fights += 1;
        const supporterOutcome = result.winner === 'draw'
            ? 'draw'
            : result.winner === supporterSeat ? 'win' : 'loss';
        const baseOutcome = supporterOutcome === 'draw'
            ? 'draw'
            : supporterOutcome === 'win' ? 'loss' : 'win';
        record(supporter, supporterOutcome);
        record(base, baseOutcome);
    };

    for (let i = 0; i < baseRoster.length; i += 1) {
        const normal = baseRoster[i]!;
        const paid = supporterRoster[i]!;
        bout(normal, paid, 'p2', 'p1');
        bout(normal, paid, 'p2', 'p2');
        bout(paid, normal, 'p1', 'p1');
        bout(paid, normal, 'p1', 'p2');
    }

    const rate = scoredRate(supporter);
    const issues: string[] = [];
    if (rate > 0.55) issues.push(`Supporter-origin builds scored ${(100 * rate).toFixed(1)}% after both origins were sealed to 12 human-PvP techniques.`);
    if (rate < 0.45) issues.push(`Supporter-origin builds unexpectedly scored only ${(100 * rate).toFixed(1)}% after both origins were sealed to 12 human-PvP techniques.`);
    if (base.games !== fights || supporter.games !== fights || base.wins !== supporter.losses || base.losses !== supporter.wins) {
        issues.push('Entitlement comparison tally conservation failed.');
    }
    return { level, fights, supporter, base, issues };
}

function printEntitlement(report: EntitlementBalanceReport): void {
    console.log(`  L${String(report.level).padStart(3)}: supporter-origin ${(100 * scoredRate(report.supporter)).toFixed(1)}% / base-origin ${(100 * scoredRate(report.base)).toFixed(1)}% after the 12-button seal (${report.fights} crossed fights)${report.issues.length ? '  FLAG' : ''}`);
}

export function main(): void {
    if (process.argv.includes('--competitive-only')) {
        console.log('PvP competitive-template profile-rotation certification');
        console.log('Every official Bloodline Maker A/B template on eight legal construction profiles (two per discipline); neutral environment; both seats x both openers; identical-button A/B rank control.');
        const started = Date.now();
        const report = runCompetitiveProfileRotationCertification();
        for (const level of report.levels) printCompetitiveProfileRotation(level);
        const totalFights = report.levels.reduce((sum, level) => sum + level.totalFights + level.rankIsolationA.games, 0);
        console.log(`\nCompleted ${totalFights} fights in ${Date.now() - started} ms.`);
        console.log(`Competitive certification: ${report.issues.length ? `REVIEW (${report.issues.length} systemic flags)` : 'PASS'}`);
        return;
    }
    console.log('PvP level/rank balance certification');
    console.log('Neutral ranked environment (central biome, no weather/home bonus, no consumables/legacy slot).');
    console.log('Each unordered build pair: both seats x both round openers. A/B creator kits are schema-sealed and point-checked.');
    const started = Date.now();
    const report = runCertification();
    for (const level of report.levels) printLevel(level);
    console.log(`\n${'='.repeat(84)}`);
    console.log('Fully-capped gear sensitivity (catalog endgame set instead of perfect named rolls)');
    const catalogCap = runLevelTournament(100, {
        fullyCapped: true,
        namedGear: false,
        label: 'Fully capped (standard catalog endgame gear)',
    });
    printLevel(catalogCap);

    console.log(`\n${'='.repeat(84)}`);
    console.log('Human-PvP entitlement seal (pre-seal 12 vs 15 techniques; both projected to 12)');
    const entitlements = TEST_LEVELS.map((level) => runEntitlementComparison(level));
    for (const entitlement of entitlements) printEntitlement(entitlement);

    const totalFights = report.levels.reduce((sum, level) => sum + level.totalFights, 0)
        + catalogCap.totalFights
        + entitlements.reduce((sum, level) => sum + level.fights, 0);
    const supplementalIssues = [...catalogCap.issues, ...entitlements.flatMap((level) => level.issues)];
    console.log(`\nCompleted ${totalFights} fights in ${Date.now() - started} ms.`);
    const allIssues = [...report.issues, ...supplementalIssues];
    console.log(`Overall certification: ${allIssues.length ? `NOT BALANCED (${allIssues.length} flags)` : 'PASS'}`);
}

const entry = process.argv[1] ? basename(process.argv[1]) : '';
if (/^pvp-level-balance-sim\.(?:ts|js|mts|mjs)$/.test(entry)) main();
