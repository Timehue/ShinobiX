/*
 * Hollow Warfront — deterministic three-lane command battle.
 *
 * Four pets deploy 2–1–1 across three navigation-isolated causeways. Every
 * two minutes one pet may seal-transfer to another active lane. Destroying a
 * tower resolves that lane and releases every pet on it for an immediate
 * breakthrough redeploy. The first team to destroy two towers wins.
 *
 * Cross-engine authority contract: no Math.random, Date, trigonometry, or
 * frame-time input. The server copy is generated from this source of truth.
 */
import type { Pet } from "../types/pet";
import type { ArenaRole, ArenaSlot } from "./pet-arena-sim";
import {
    WF_LANE_IDS,
    WF_LANE_Y,
    WF_SPAWN_X,
    WF_TOWERS,
    wfSpawnPoint,
    type WfLaneId,
} from "./pet-warfront-map";

export const WARFRONT_TPS = 30;
export const WF_ROUND_SECONDS = 120;
export const WF_MAX_SECONDS = 600;
export const WF_PHASE_SKIRMISH = 120;
export const WF_PHASE_WAR = 240;
export const WF_PHASE_SUDDEN = 480;
const COMMAND_TICKS = WARFRONT_TPS * WF_ROUND_SECONDS;
const MAX_TICKS = WARFRONT_TPS * WF_MAX_SECONDS;
const RIFTFALL_TICKS = WARFRONT_TPS * WF_PHASE_SUDDEN;

const TOWER_HP = 5000;
const TOWER_REDUCTION = 0.18;
const TOWER_RANGE = 7.4;
const TOWER_DAMAGE = 82;
const TOWER_CD = Math.round(WARFRONT_TPS * 1.2);
const TOWER_RADIUS = 1.7;
const PET_BASE_SPEED = 3.05 / WARFRONT_TPS;
const PET_ATTACK_CD = WARFRONT_TPS;
const WARDEN_COST = 100;
const WARDEN_PACT_COST = 85;
const WARDEN_HP = 3000;
const WARDEN_DURATION = WARFRONT_TPS * 38;
const WARDEN_PACT_DURATION = WARFRONT_TPS * 46;
const WARDEN_DAMAGE = 150;
const WARDEN_TOWER_DAMAGE = 210;
const WARDEN_ATTACK_CD = Math.round(WARFRONT_TPS * 1.25);
const WARDEN_RANGE = 2.45;
const FAVOR_TAKEDOWN = 12;
const FAVOR_ASSIST = 5;
const FAVOR_DEFENSE_BONUS = 6;
const FAVOR_WARDEN_KILL = 20;
const FAVOR_PER_TOWER_DAMAGE = 1 / 125;
const FAVOR_PASSIVE_EVERY = WARFRONT_TPS * 6;

export type WfStance = "balanced" | "siege" | "jungle" | "headhunt" | "turtle";
export type WfDoctrine = "none" | "vanguard" | "bulwark" | "zealot" | "warden-pact";
export type WfBuyPolicy = "off" | "balanced" | "offense" | "defense";
export type WfPowerupKind = "strike" | "guard" | "vitality" | "swift" | "mend";
export type WfWardenAspect = "breaker" | "sentinel" | "harrier";
export type WfOmen = "thin-veil" | "storm-gate" | "blood-moon" | "shattered-wards";

export const WF_WARDEN_ASPECTS: ReadonlyArray<{
    id: WfWardenAspect; icon: string; label: string; desc: string;
}> = Object.freeze([
    { id: "breaker", icon: "◆", label: "Breaker", desc: "Crushes towers; easier to stop with defenders." },
    { id: "sentinel", icon: "◈", label: "Sentinel", desc: "Guards your tower and refuses to overextend." },
    { id: "harrier", icon: "✦", label: "Harrier", desc: "Hunts rival pets; deals reduced structure damage." },
]);

export const WF_OMENS: ReadonlyArray<{
    id: WfOmen; icon: string; label: string; desc: string;
}> = Object.freeze([
    { id: "thin-veil", icon: "◐", label: "Thin Veil", desc: "Wardens cost 80 Favor, but remain for only 28 seconds." },
    { id: "storm-gate", icon: "ϟ", label: "Storm Gate", desc: "Scheduled command windows arrive every 90 seconds." },
    { id: "blood-moon", icon: "●", label: "Blood Moon", desc: "Takedowns while defending a fractured allied lane tower grant 12 bonus Favor." },
    { id: "shattered-wards", icon: "◇", label: "Shattered Wards", desc: "The first tower fracture opens an immediate command window." },
]);

export function wfOmenForSeed(seed: number): WfOmen {
    const index = ((Math.floor(seed) >>> 0) % WF_OMENS.length + WF_OMENS.length) % WF_OMENS.length;
    return WF_OMENS[index].id;
}

export function wfTakedownFavor(omen: WfOmen, defendingFracturedTower: boolean): number {
    if (!defendingFracturedTower) return FAVOR_TAKEDOWN;
    return FAVOR_TAKEDOWN + (omen === "blood-moon" ? 12 : FAVOR_DEFENSE_BONUS);
}
export const WF_STACK_CAP = 0;
export const WF_COIN_TRICKLE = 0;
export const WF_COIN_MOB = 0;
export const WF_COIN_PET_KILL = 0;
export const WF_COIN_STATUE = 0;
export const WF_COIN_MINI = 0;
export const WF_COIN_WARDEN = 0;
export const WF_COIN_GUARD = 0;
export const WF_COIN_MINION = 0;
export function wfPowerupCost(): number { return 0; }

export type WfTeam = "blue" | "red";
type Team = WfTeam;
const other = (team: Team): Team => team === "blue" ? "red" : "blue";
const clamp = (value: number, min: number, max: number) => value < min ? min : value > max ? max : value;
const quant = (value: number) => Math.round(value * 256) / 256;
const distance = (ax: number, ay: number, bx: number, by: number) => {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
};
const makeRng = (seed: number) => {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
};

const ROLE_CFG: Readonly<Record<ArenaRole, {
    hp: number; atk: number; def: number; speed: number; range: number; crit: number;
}>> = Object.freeze({
    defender: { hp: 1.65, atk: 0.68, def: 1.65, speed: 0.86, range: 1.85, crit: 0.04 },
    tracker: { hp: 1.08, atk: 1.0, def: 1.05, speed: 1.04, range: 4.3, crit: 0.12 },
    assassin: { hp: 0.78, atk: 1.48, def: 0.72, speed: 1.2, range: 1.95, crit: 0.28 },
    sage: { hp: 0.92, atk: 0.58, def: 0.96, speed: 1.0, range: 4.6, crit: 0.05 },
});
const ELEMENT_BEATS: Readonly<Record<string, string>> = Object.freeze({
    Fire: "Wind", Wind: "Lightning", Lightning: "Earth", Earth: "Water", Water: "Fire",
});
function elementMultiplier(attacker?: string | null, defender?: string | null): number {
    if (!attacker || !defender || attacker === "None" || defender === "None") return 1;
    if (ELEMENT_BEATS[attacker] === defender) return 1.15;
    if (ELEMENT_BEATS[defender] === attacker) return 0.85;
    return 1;
}

interface WfPet {
    id: string;
    team: Team;
    slot: number;
    role: ArenaRole;
    pet: Pet;
    element?: string | null;
    lane: WfLaneId;
    x: number;
    y: number;
    faceX: number;
    hp: number;
    maxHp: number;
    atk: number;
    def: number;
    speed: number;
    range: number;
    crit: number;
    state: "idle" | "move" | "attack" | "dash" | "respawning";
    intent: string;
    attackCd: number;
    abilityCd: number;
    respawnLeft: number;
    invulnerable: number;
    shieldHp: number;
    kills: number;
    assists: number;
    dmg: number;
    towerDamage: number;
    hitLog: Array<{ id: string; t: number }>;
}

interface WfTower {
    team: Team;
    lane: WfLaneId;
    x: number;
    y: number;
    hp: number;
    alive: boolean;
    fractured: boolean;
    attackCd: number;
    targetId: string | null;
    sameTargetShots: number;
    damageTaken: number;
}

interface WfWarden {
    team: Team;
    aspect: WfWardenAspect;
    active: boolean;
    lane: WfLaneId;
    x: number;
    y: number;
    faceX: number;
    hp: number;
    left: number;
    attackCd: number;
    slamCd: number;
    targetId: string | null;
}

export type WfCommandReason = "scheduled" | "breakthrough" | "omen";
export interface WfCommandState {
    sequence: number;
    t: number;
    reason: WfCommandReason;
    resolvedLane?: WfLaneId;
    activeLanes: WfLaneId[];
    freedPetSlots: Record<Team, number[]>;
    maxMoves: number;
}

export type WarfrontChoice =
    | { type: "move"; petIndex: number; lane: WfLaneId }
    | { type: "summon"; lane: WfLaneId; aspect: WfWardenAspect };

export interface WarfrontCommandEntry {
    t: number;
    reason: WfCommandReason;
    moves: Array<{ petIndex: number; lane: WfLaneId }>;
    summonLane?: WfLaneId;
    summonAspect?: WfWardenAspect;
}

export interface WarfrontCommandPlan {
    initialLanes: Record<Team, WfLaneId[]>;
    commands: WarfrontCommandEntry[];
}

export interface WfActorSnap {
    id: string;
    team: Team;
    slot: number;
    role: ArenaRole;
    element?: string | null;
    lane: WfLaneId;
    x: number;
    y: number;
    faceX: number;
    faceY: number;
    hp: number;
    maxHp: number;
    state: WfPet["state"];
    respawnSecs: number;
    stacksTotal: number;
    wlevel: number;
    carrying: false;
    statuses: string[];
    shielded: boolean;
    intent: string;
}

export interface WfTowerSnap {
    team: Team;
    lane: WfLaneId;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    alive: boolean;
    fractured: boolean;
    targetId: string | null;
}

export interface WfWardenSnap {
    team: Team;
    aspect: WfWardenAspect;
    active: boolean;
    lane: WfLaneId;
    x: number;
    y: number;
    faceX: number;
    hp: number;
    maxHp: number;
    secs: number;
    targetId: string | null;
}

export interface WfSnapshot {
    t: number;
    actors: WfActorSnap[];
    towers: Record<Team, Record<WfLaneId, WfTowerSnap>>;
    wardens: Record<Team, WfWardenSnap>;
    favor: Record<Team, number>;
    towerDamage: Record<Team, number>;
    stances: Record<Team, WfStance>;
    omen: WfOmen;
    command: WfCommandState | null;
    riftfall: boolean;
}

export type WfEvent =
    | { t: number; type: "hit"; targetId: string; actorId: string; dmg: number; crit: boolean; element?: string | null }
    | { t: number; type: "heal"; targetId: string; actorId: string; amount: number }
    | { t: number; type: "kill"; targetId: string; actorId: string; team: Team }
    | { t: number; type: "ability"; petId: string; kind: "shield" | "dash" | "mark"; x: number; y: number; targetId?: string }
    | { t: number; type: "elemsig"; petId: string; el: string; name: string; px: number; py: number; x: number; y: number; targetId: string }
    | { t: number; type: "towerhit"; team: Team; lane: WfLaneId; actorId: string; dmg: number; x: number; y: number }
    | { t: number; type: "towerfractured"; team: Team; lane: WfLaneId; by: Team; actorId: string }
    | { t: number; type: "towerdown"; team: Team; lane: WfLaneId; by: Team; actorId: string }
    | { t: number; type: "commandwindow"; reason: WfCommandReason; sequence: number; lane?: WfLaneId }
    | { t: number; type: "commandresolved"; sequence: number; reason: WfCommandReason; blue: WarfrontCommandEntry; red: WarfrontCommandEntry }
    | { t: number; type: "commandimpact"; impact: WfCommandImpact }
    | { t: number; type: "redeploy"; team: Team; petId: string; from: WfLaneId; lane: WfLaneId }
    | { t: number; type: "favorready"; team: Team }
    | { t: number; type: "wardensummon"; team: Team; lane: WfLaneId; aspect: WfWardenAspect }
    | { t: number; type: "wardenhit"; team: Team; actorId: string; dmg: number; x: number; y: number }
    | { t: number; type: "wardenslam"; team: Team; lane: WfLaneId; x: number; y: number }
    | { t: number; type: "wardendown"; team: Team; by: Team; expired: boolean }
    | { t: number; type: "riftfall" }
    | { t: number; type: "phase"; name: string }
    | { t: number; type: "round"; round: number };

export interface WfCommandImpact {
    sequence: number;
    team: Team;
    t: number;
    resolvedAt: number;
    reason: WfCommandReason;
    moves: Array<{ petIndex: number; lane: WfLaneId }>;
    summonLane?: WfLaneId;
    summonAspect?: WfWardenAspect;
    towerDamageDealt: number;
    towerDamageTaken: number;
    towersBroken: number;
    towersLost: number;
}

export interface WarfrontResult {
    winner: Team | "draw" | null;
    ticks: number;
    petStats?: Array<{ id: string; name: string; team: Team; level: number; kills: number; assists: number; dmg: number; coins: number }>;
    snapshots: WfSnapshot[];
    events: WfEvent[];
    theme?: string;
    coins: Record<Team, number>;
    initialLanes: Record<Team, WfLaneId[]>;
    commandLog: WarfrontCommandEntry[];
    omen: WfOmen;
    commandImpacts: WfCommandImpact[];
}

interface PendingCommandImpact {
    sequence: number;
    team: Team;
    entry: WarfrontCommandEntry;
    startedAt: number;
    towerDamage: Record<Team, number>;
    score: Record<Team, number>;
}

interface WfState {
    t: number;
    rng: () => number;
    pets: WfPet[];
    towers: Record<Team, Record<WfLaneId, WfTower>>;
    wardens: Record<Team, WfWarden>;
    favor: Record<Team, number>;
    favorReady: Record<Team, boolean>;
    towerDamage: Record<Team, number>;
    stance: Record<Team, WfStance>;
    doctrine: Record<Team, WfDoctrine>;
    omen: WfOmen;
    shatteredWindowUsed: boolean;
    winner: Team | "draw" | null;
    pendingCommand: WfCommandState | null;
    commandSequence: number;
    commandLog: WarfrontCommandEntry[];
    pendingImpacts: Record<Team, PendingCommandImpact | null>;
    commandImpacts: WfCommandImpact[];
    events: WfEvent[];
    snapshots: WfSnapshot[];
}

function validLane(value: unknown): value is WfLaneId {
    return value === "n" || value === "m" || value === "s";
}

function validWardenAspect(value: unknown): value is WfWardenAspect {
    return value === "breaker" || value === "sentinel" || value === "harrier";
}

export function normalizeWarfrontLanes(values: readonly WfLaneId[] | undefined, size = 4): WfLaneId[] {
    const count = Math.max(1, Math.min(4, Math.floor(size)));
    if (values?.length === count && values.every(validLane)) {
        if (count !== 4 || WF_LANE_IDS.every((lane) => values.includes(lane))) return [...values];
    }
    if (count === 1) return ["m"];
    if (count === 2) return ["n", "s"];
    if (count === 3) return ["n", "m", "s"];
    return ["n", "m", "s", "m"];
}

/** Parse the only player-authored data accepted by server settlement. The
 * rival formation remains canonical and every applied command is revalidated
 * again against the live command window by applyTeamCommand. */
export function parseWarfrontCommandPlan(value: unknown): WarfrontCommandPlan | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const rawInitialLanes = record.initialLanes;
    if (!Array.isArray(rawInitialLanes) || rawInitialLanes.length !== 4 || !rawInitialLanes.every(validLane)) return null;
    if (!WF_LANE_IDS.every((lane) => rawInitialLanes.includes(lane))) return null;
    const blue = normalizeWarfrontLanes(rawInitialLanes, 4);
    if (!Array.isArray(record.commands) || record.commands.length > 12) return null;
    const commands: WarfrontCommandEntry[] = [];
    for (const raw of record.commands) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const command = raw as Record<string, unknown>;
        const t = Number(command.t);
        const reason = command.reason;
        if (!Number.isSafeInteger(t) || t <= 0 || t > MAX_TICKS
            || (reason !== "scheduled" && reason !== "breakthrough" && reason !== "omen")) return null;
        if (!Array.isArray(command.moves) || command.moves.length > 4) return null;
        const moves: WarfrontCommandEntry["moves"] = [];
        for (const rawMove of command.moves) {
            if (!rawMove || typeof rawMove !== "object" || Array.isArray(rawMove)) return null;
            const move = rawMove as Record<string, unknown>;
            const petIndex = Number(move.petIndex);
            if (!Number.isSafeInteger(petIndex) || petIndex < 0 || petIndex >= 4 || !validLane(move.lane)) return null;
            moves.push({ petIndex, lane: move.lane });
        }
        if (command.summonLane !== undefined && !validLane(command.summonLane)) return null;
        if (command.summonAspect !== undefined && !validWardenAspect(command.summonAspect)) return null;
        if (command.summonAspect !== undefined && command.summonLane === undefined) return null;
        commands.push({
            t,
            reason,
            moves,
            ...(validLane(command.summonLane) ? { summonLane: command.summonLane } : {}),
            ...(validWardenAspect(command.summonAspect) ? { summonAspect: command.summonAspect } : {}),
        });
    }
    return { initialLanes: { blue, red: normalizeWarfrontLanes(undefined, 4) }, commands };
}

function makePet(slot: ArenaSlot, team: Team, index: number, lane: WfLaneId): WfPet {
    const cfg = ROLE_CFG[slot.role];
    const pet = slot.pet;
    const hp = Math.max(220, Number(pet.hp ?? 400)) * cfg.hp * 2.0;
    const atk = Math.max(12, Number(pet.attack ?? 40)) * cfg.atk;
    const def = Math.max(6, Number(pet.defense ?? 20)) * cfg.def;
    const speed = PET_BASE_SPEED * cfg.speed * clamp(0.88 + Number(pet.speed ?? 40) / 220, 0.88, 1.32);
    const [x, y] = wfSpawnPoint(team, lane, index);
    return {
        id: `${team}-${index}`,
        team,
        slot: index,
        role: slot.role,
        pet,
        element: pet.element,
        lane,
        x,
        y,
        faceX: team === "blue" ? 1 : -1,
        hp,
        maxHp: hp,
        atk,
        def,
        speed,
        range: cfg.range,
        crit: cfg.crit,
        state: "idle",
        intent: `hold:${lane}`,
        attackCd: index * 3,
        abilityCd: WARFRONT_TPS * (4 + index),
        respawnLeft: 0,
        invulnerable: WARFRONT_TPS,
        shieldHp: 0,
        kills: 0,
        assists: 0,
        dmg: 0,
        towerDamage: 0,
        hitLog: [],
    };
}

function applyDoctrine(pet: WfPet, doctrine: WfDoctrine) {
    if (doctrine === "vanguard") pet.atk *= 1.08;
    else if (doctrine === "bulwark") { pet.hp *= 1.12; pet.maxHp *= 1.12; }
    else if (doctrine === "zealot") pet.speed *= 1.1;
}

function makeTower(team: Team, lane: WfLaneId): WfTower {
    const [x, y] = WF_TOWERS[team][lane];
    return { team, lane, x, y, hp: TOWER_HP, alive: true, fractured: false, attackCd: 0, targetId: null, sameTargetShots: 0, damageTaken: 0 };
}

function makeWarden(team: Team): WfWarden {
    return { team, aspect: "breaker", active: false, lane: "m", x: 0, y: 0, faceX: team === "blue" ? 1 : -1, hp: 0, left: 0, attackCd: 0, slamCd: 0, targetId: null };
}

function initState(
    blue: ArenaSlot[],
    red: ArenaSlot[],
    seed: number,
    initialLanes: Partial<Record<Team, readonly WfLaneId[]>> | undefined,
    stances: Partial<Record<Team, WfStance>>,
    doctrines: Partial<Record<Team, WfDoctrine>>,
): WfState {
    const blueLanes = normalizeWarfrontLanes(initialLanes?.blue, blue.length);
    const redLanes = normalizeWarfrontLanes(initialLanes?.red, red.length);
    const pets = [
        ...blue.slice(0, 4).map((slot, index) => makePet(slot, "blue", index, blueLanes[index])),
        ...red.slice(0, 4).map((slot, index) => makePet(slot, "red", index, redLanes[index])),
    ];
    const stance: Record<Team, WfStance> = { blue: stances.blue ?? "balanced", red: stances.red ?? "balanced" };
    const doctrine: Record<Team, WfDoctrine> = { blue: doctrines.blue ?? "none", red: doctrines.red ?? "none" };
    const omen = wfOmenForSeed(seed);
    for (const pet of pets) applyDoctrine(pet, doctrine[pet.team]);
    return {
        t: 0,
        rng: makeRng(seed),
        pets,
        towers: {
            blue: { n: makeTower("blue", "n"), m: makeTower("blue", "m"), s: makeTower("blue", "s") },
            red: { n: makeTower("red", "n"), m: makeTower("red", "m"), s: makeTower("red", "s") },
        },
        wardens: { blue: makeWarden("blue"), red: makeWarden("red") },
        favor: { blue: 0, red: 0 },
        favorReady: { blue: false, red: false },
        towerDamage: { blue: 0, red: 0 },
        stance,
        doctrine,
        omen,
        shatteredWindowUsed: false,
        winner: null,
        pendingCommand: null,
        commandSequence: 0,
        commandLog: [],
        pendingImpacts: { blue: null, red: null },
        commandImpacts: [],
        events: [
            { t: 0, type: "phase", name: "DEPLOYMENT" },
        ],
        snapshots: [],
    };
}

function laneActive(state: WfState, lane: WfLaneId): boolean {
    return state.towers.blue[lane].alive && state.towers.red[lane].alive;
}
function activeLanes(state: WfState): WfLaneId[] {
    return WF_LANE_IDS.filter((lane) => laneActive(state, lane));
}

export function wfVerdictScore(snapshot: Pick<WfSnapshot, "towers">): Record<Team, number> {
    const downed = (team: Team) => WF_LANE_IDS.filter((lane) => !snapshot.towers[team][lane].alive).length;
    return { blue: downed("red"), red: downed("blue") };
}

function stateScore(state: WfState): Record<Team, number> {
    const downed = (team: Team) => WF_LANE_IDS.filter((lane) => !state.towers[team][lane].alive).length;
    return { blue: downed("red"), red: downed("blue") };
}

function finalizeCommandImpacts(state: WfState) {
    const score = stateScore(state);
    for (const team of ["blue", "red"] as const) {
        const pending = state.pendingImpacts[team];
        if (!pending) continue;
        const foe = other(team);
        const impact: WfCommandImpact = {
            sequence: pending.sequence,
            team,
            t: pending.startedAt,
            resolvedAt: state.t,
            reason: pending.entry.reason,
            moves: pending.entry.moves.map((move) => ({ ...move })),
            ...(pending.entry.summonLane && pending.entry.summonAspect
                ? { summonLane: pending.entry.summonLane, summonAspect: pending.entry.summonAspect }
                : {}),
            towerDamageDealt: Math.max(0, Math.round(state.towerDamage[team] - pending.towerDamage[team])),
            towerDamageTaken: Math.max(0, Math.round(state.towerDamage[foe] - pending.towerDamage[foe])),
            towersBroken: Math.max(0, score[team] - pending.score[team]),
            towersLost: Math.max(0, score[foe] - pending.score[foe]),
        };
        state.commandImpacts.push(impact);
        state.events.push({ t: state.t, type: "commandimpact", impact });
        state.pendingImpacts[team] = null;
    }
}

function beginCommandImpact(state: WfState, team: Team, sequence: number, entry: WarfrontCommandEntry) {
    state.pendingImpacts[team] = {
        sequence,
        team,
        entry: { ...entry, moves: entry.moves.map((move) => ({ ...move })) },
        startedAt: state.t,
        towerDamage: { ...state.towerDamage },
        score: stateScore(state),
    };
}

function addFavor(state: WfState, team: Team, amount: number) {
    const score = stateScore(state);
    const behind = score[team] < score[other(team)];
    const before = state.favor[team];
    state.favor[team] = quant(clamp(before + amount * (behind ? 1.25 : 1), 0, 100));
    if (before < 100 && state.favor[team] >= 100 && !state.favorReady[team]) {
        state.favorReady[team] = true;
        state.events.push({ t: state.t, type: "favorready", team });
    }
}

function snapshot(state: WfState): WfSnapshot {
    const towerSnap = (tower: WfTower): WfTowerSnap => ({
        team: tower.team, lane: tower.lane, x: tower.x, y: tower.y,
        hp: quant(tower.hp), maxHp: TOWER_HP, alive: tower.alive,
        fractured: tower.fractured, targetId: tower.targetId,
    });
    const wardenSnap = (warden: WfWarden): WfWardenSnap => ({
        team: warden.team, aspect: warden.aspect, active: warden.active, lane: warden.lane,
        x: quant(warden.x), y: quant(warden.y), faceX: warden.faceX,
        hp: quant(warden.hp), maxHp: WARDEN_HP, secs: warden.left / WARFRONT_TPS,
        targetId: warden.targetId,
    });
    return {
        t: state.t,
        actors: state.pets.map((pet) => ({
            id: pet.id, team: pet.team, slot: pet.slot, role: pet.role, element: pet.element,
            lane: pet.lane, x: quant(pet.x), y: quant(pet.y), faceX: pet.faceX, faceY: 0,
            hp: quant(pet.hp), maxHp: quant(pet.maxHp), state: pet.state,
            respawnSecs: pet.respawnLeft / WARFRONT_TPS, stacksTotal: 0, wlevel: 1, carrying: false,
            statuses: [
                ...(pet.invulnerable > 0 ? ["SEAL WARD"] : []),
                ...(pet.shieldHp > 0 ? ["BARRIER"] : []),
            ],
            shielded: pet.shieldHp > 0,
            intent: pet.intent,
        })),
        towers: {
            blue: { n: towerSnap(state.towers.blue.n), m: towerSnap(state.towers.blue.m), s: towerSnap(state.towers.blue.s) },
            red: { n: towerSnap(state.towers.red.n), m: towerSnap(state.towers.red.m), s: towerSnap(state.towers.red.s) },
        },
        wardens: { blue: wardenSnap(state.wardens.blue), red: wardenSnap(state.wardens.red) },
        favor: { blue: quant(state.favor.blue), red: quant(state.favor.red) },
        towerDamage: { blue: quant(state.towerDamage.blue), red: quant(state.towerDamage.red) },
        stances: { ...state.stance },
        omen: state.omen,
        command: state.pendingCommand ? {
            ...state.pendingCommand,
            activeLanes: [...state.pendingCommand.activeLanes],
            freedPetSlots: { blue: [...state.pendingCommand.freedPetSlots.blue], red: [...state.pendingCommand.freedPetSlots.red] },
        } : null,
        riftfall: state.t >= RIFTFALL_TICKS,
    };
}

function resetAtTower(pet: WfPet) {
    const [x, y] = wfSpawnPoint(pet.team, pet.lane, pet.slot);
    pet.x = x;
    pet.y = y;
    pet.faceX = pet.team === "blue" ? 1 : -1;
    pet.hp = pet.maxHp;
    pet.shieldHp = 0;
    pet.state = "idle";
    pet.intent = `return:${pet.lane}`;
    pet.invulnerable = WARFRONT_TPS * 2;
}

function recordDamager(target: WfPet, actorId: string, tick: number) {
    target.hitLog = target.hitLog.filter((entry) => tick - entry.t <= WARFRONT_TPS * 8 && entry.id !== actorId);
    target.hitLog.push({ id: actorId, t: tick });
}

function petDamage(state: WfState, target: WfPet, raw: number, actorId: string, actorTeam: Team, crit: boolean, element?: string | null) {
    if (target.respawnLeft > 0 || target.invulnerable > 0) return;
    const reduced = raw * (100 / (100 + Math.max(0, target.def * 0.9)));
    let damage = Math.max(1, reduced);
    if (target.shieldHp > 0) {
        const absorbed = Math.min(target.shieldHp, damage);
        target.shieldHp -= absorbed;
        damage -= absorbed;
    }
    if (damage <= 0) return;
    target.hp = quant(Math.max(0, target.hp - damage));
    recordDamager(target, actorId, state.t);
    const attacker = state.pets.find((pet) => pet.id === actorId);
    if (attacker) attacker.dmg += damage;
    state.events.push({ t: state.t, type: "hit", targetId: target.id, actorId, dmg: Math.round(damage), crit, element });
    if (target.hp > 0) return;

    const killer = state.pets.find((pet) => pet.id === actorId);
    if (killer) killer.kills++;
    for (const entry of target.hitLog) {
        const assist = state.pets.find((pet) => pet.id === entry.id && pet.team === actorTeam && pet.id !== actorId);
        if (assist) { assist.assists++; addFavor(state, actorTeam, FAVOR_ASSIST); }
    }
    const ownTower = state.towers[actorTeam][target.lane];
    const threatenedDefense = ownTower.alive && ownTower.hp <= TOWER_HP * 0.5;
    addFavor(state, actorTeam, wfTakedownFavor(state.omen, threatenedDefense));
    state.events.push({ t: state.t, type: "kill", targetId: target.id, actorId, team: actorTeam });
    target.respawnLeft = WARFRONT_TPS * Math.min(14, 8 + Math.floor(state.t / (WARFRONT_TPS * 60)));
    target.state = "respawning";
    target.intent = "seal:reforming";
    target.attackCd = 0;
    target.abilityCd = WARFRONT_TPS * 2;
    target.hitLog = [];
}

function stancePetDamage(state: WfState, team: Team): number {
    if (state.stance[team] === "headhunt") return 1.08;
    if (state.stance[team] === "siege") return 0.95;
    return 1;
}
function stanceTowerDamage(state: WfState, team: Team): number {
    if (state.stance[team] === "siege") return 1.1;
    if (state.stance[team] === "headhunt") return 0.9;
    return 1;
}

function wardenCost(state: WfState, team: Team): number {
    if (state.omen === "thin-veil") return 80;
    return state.doctrine[team] === "warden-pact" ? WARDEN_PACT_COST : WARDEN_COST;
}

function wardenDuration(state: WfState, team: Team): number {
    if (state.omen === "thin-veil") return WARFRONT_TPS * 28;
    return state.doctrine[team] === "warden-pact" ? WARDEN_PACT_DURATION : WARDEN_DURATION;
}

function autoWardenAspect(state: WfState, team: Team, lane: WfLaneId): WfWardenAspect {
    const own = state.towers[team][lane];
    const foe = state.towers[other(team)][lane];
    if (own.hp <= TOWER_HP * 0.4) return "sentinel";
    if (foe.hp <= TOWER_HP * 0.48) return "breaker";
    return "harrier";
}

function queueBreakthrough(state: WfState, lane: WfLaneId) {
    if (state.winner !== null || state.pendingCommand) return;
    finalizeCommandImpacts(state);
    const actives = activeLanes(state);
    if (!actives.length) return;
    state.commandSequence++;
    state.pendingCommand = {
        sequence: state.commandSequence,
        t: state.t,
        reason: "breakthrough",
        resolvedLane: lane,
        activeLanes: actives,
        freedPetSlots: {
            blue: state.pets.filter((pet) => pet.team === "blue" && pet.lane === lane).map((pet) => pet.slot),
            red: state.pets.filter((pet) => pet.team === "red" && pet.lane === lane).map((pet) => pet.slot),
        },
        maxMoves: 4,
    };
    state.events.push({ t: state.t, type: "commandwindow", reason: "breakthrough", sequence: state.commandSequence, lane });
}

function finishTower(state: WfState, tower: WfTower, by: Team, actorId: string) {
    if (!tower.alive) return;
    tower.alive = false;
    tower.hp = 0;
    tower.targetId = null;
    state.events.push({ t: state.t, type: "towerdown", team: tower.team, lane: tower.lane, by, actorId });
    const score = stateScore(state);
    if (score.blue >= 2 || score.red >= 2) {
        state.winner = score.blue >= 2 && score.red >= 2 ? "draw" : score.blue >= 2 ? "blue" : "red";
        state.pendingCommand = null;
        finalizeCommandImpacts(state);
        return;
    }
    queueBreakthrough(state, tower.lane);
}

function damageTower(state: WfState, tower: WfTower, raw: number, actorId: string, by: Team) {
    if (!tower.alive || !laneActive(state, tower.lane)) return;
    let damage = raw * stanceTowerDamage(state, by);
    if (state.t < RIFTFALL_TICKS) damage *= 1 - TOWER_REDUCTION;
    else damage *= 1.3;
    damage = quant(Math.max(1, damage));
    tower.hp = quant(Math.max(0, tower.hp - damage));
    tower.damageTaken += damage;
    state.towerDamage[by] += damage;
    addFavor(state, by, damage * FAVOR_PER_TOWER_DAMAGE * (state.stance[by] === "jungle" ? 1.2 : 1));
    const attacker = state.pets.find((pet) => pet.id === actorId);
    if (attacker) attacker.towerDamage += damage;
    state.events.push({ t: state.t, type: "towerhit", team: tower.team, lane: tower.lane, actorId, dmg: Math.round(damage), x: tower.x, y: tower.y });
    if (!tower.fractured && tower.hp <= TOWER_HP * 0.5) {
        tower.fractured = true;
        state.events.push({ t: state.t, type: "towerfractured", team: tower.team, lane: tower.lane, by, actorId });
        if (tower.hp > 0 && state.omen === "shattered-wards" && !state.shatteredWindowUsed && !state.pendingCommand && state.winner === null) {
            finalizeCommandImpacts(state);
            state.shatteredWindowUsed = true;
            state.commandSequence++;
            state.pendingCommand = {
                sequence: state.commandSequence,
                t: state.t,
                reason: "omen",
                activeLanes: activeLanes(state),
                freedPetSlots: { blue: [], red: [] },
                maxMoves: 1,
            };
            state.events.push({ t: state.t, type: "commandwindow", reason: "omen", sequence: state.commandSequence, lane: tower.lane });
        }
    }
    if (tower.hp <= 0) finishTower(state, tower, by, actorId);
}

type CombatTarget = { kind: "pet"; pet: WfPet } | { kind: "warden"; warden: WfWarden };
function nearestCombatTarget(state: WfState, team: Team, lane: WfLaneId, x: number, y: number): CombatTarget | null {
    let best: CombatTarget | null = null;
    let bestDistance = Infinity;
    for (const pet of state.pets) {
        if (pet.team === team || pet.lane !== lane || pet.respawnLeft > 0 || pet.hp <= 0) continue;
        const d = distance(x, y, pet.x, pet.y);
        if (d < bestDistance) { best = { kind: "pet", pet }; bestDistance = d; }
    }
    const warden = state.wardens[other(team)];
    if (warden.active && warden.lane === lane) {
        const d = distance(x, y, warden.x, warden.y);
        if (d < bestDistance) best = { kind: "warden", warden };
    }
    return best;
}

function damageWarden(state: WfState, warden: WfWarden, raw: number, actorId: string, by: Team) {
    if (!warden.active) return;
    const damage = quant(Math.max(1, raw * 0.86));
    warden.hp = quant(Math.max(0, warden.hp - damage));
    const attacker = state.pets.find((pet) => pet.id === actorId);
    if (attacker) attacker.dmg += damage;
    state.events.push({ t: state.t, type: "wardenhit", team: warden.team, actorId, dmg: Math.round(damage), x: warden.x, y: warden.y });
    if (warden.hp <= 0) dismissWarden(state, warden, by, false);
}

function dismissWarden(state: WfState, warden: WfWarden, by: Team, expired: boolean) {
    if (!warden.active) return;
    warden.active = false;
    warden.hp = 0;
    warden.left = 0;
    warden.targetId = null;
    if (!expired) addFavor(state, by, FAVOR_WARDEN_KILL);
    state.events.push({ t: state.t, type: "wardendown", team: warden.team, by, expired });
}

function moveToward(pet: WfPet, targetX: number, targetY: number) {
    const dx = targetX - pet.x;
    const dy = targetY - pet.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 0.001) return;
    const step = Math.min(pet.speed, d);
    pet.x = quant(pet.x + dx / d * step);
    pet.y = quant(pet.y + dy / d * step);
    pet.faceX = dx < 0 ? -1 : 1;
    pet.state = "move";
}

function triggerRoleAbility(state: WfState, pet: WfPet): boolean {
    if (pet.abilityCd > 0) return false;
    if (pet.role === "sage") {
        const ally = state.pets
            .filter((candidate) => candidate.team === pet.team && candidate.lane === pet.lane && candidate.respawnLeft <= 0 && candidate.hp < candidate.maxHp * 0.78)
            .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0];
        if (ally && distance(pet.x, pet.y, ally.x, ally.y) <= 6) {
            const amount = quant(Math.min(ally.maxHp - ally.hp, ally.maxHp * 0.16));
            ally.hp += amount;
            pet.abilityCd = WARFRONT_TPS * 7;
            state.events.push({ t: state.t, type: "heal", targetId: ally.id, actorId: pet.id, amount: Math.round(amount) });
            return true;
        }
    } else if (pet.role === "defender" && pet.hp < pet.maxHp * 0.62 && pet.shieldHp <= 0) {
        pet.shieldHp = quant(pet.maxHp * 0.18);
        pet.abilityCd = WARFRONT_TPS * 8;
        state.events.push({ t: state.t, type: "ability", petId: pet.id, kind: "shield", x: pet.x, y: pet.y });
        return true;
    }
    return false;
}

function updatePet(state: WfState, pet: WfPet) {
    if (pet.respawnLeft > 0) {
        pet.respawnLeft--;
        if (pet.respawnLeft <= 0) resetAtTower(pet);
        return;
    }
    if (!laneActive(state, pet.lane)) return;
    if (pet.attackCd > 0) pet.attackCd--;
    if (pet.abilityCd > 0) pet.abilityCd--;
    if (pet.invulnerable > 0) pet.invulnerable--;
    triggerRoleAbility(state, pet);

    const target = nearestCombatTarget(state, pet.team, pet.lane, pet.x, pet.y);
    if (target) {
        const tx = target.kind === "pet" ? target.pet.x : target.warden.x;
        const ty = target.kind === "pet" ? target.pet.y : target.warden.y;
        const d = distance(pet.x, pet.y, tx, ty);
        if (d > pet.range) {
            pet.intent = `duel:${target.kind === "pet" ? target.pet.id : `warden-${target.warden.team}`}`;
            moveToward(pet, tx, ty);
            return;
        }
        pet.state = "attack";
        pet.faceX = tx < pet.x ? -1 : 1;
        pet.intent = `strike:${target.kind === "pet" ? target.pet.id : `warden-${target.warden.team}`}`;
        if (pet.attackCd > 0) return;
        const crit = state.rng() < pet.crit;
        let raw = pet.atk * stancePetDamage(state, pet.team) * (crit ? 1.65 : 1);
        if (target.kind === "pet") {
            raw *= elementMultiplier(pet.element, target.pet.element);
            petDamage(state, target.pet, raw, pet.id, pet.team, crit, pet.element);
        } else damageWarden(state, target.warden, raw, pet.id, pet.team);
        pet.attackCd = PET_ATTACK_CD;
        return;
    }

    const tower = state.towers[other(pet.team)][pet.lane];
    const d = Math.abs(tower.x - pet.x);
    if (d > pet.range + TOWER_RADIUS) {
        pet.intent = `advance:${pet.lane}`;
        moveToward(pet, tower.x + (pet.team === "blue" ? -TOWER_RADIUS : TOWER_RADIUS), WF_LANE_Y[pet.lane] + ((pet.slot % 4) - 1.5) * 0.55);
        return;
    }
    pet.state = "attack";
    pet.faceX = pet.team === "blue" ? 1 : -1;
    pet.intent = `siege:${pet.lane}`;
    if (pet.attackCd <= 0) {
        damageTower(state, tower, pet.atk * 0.82, pet.id, pet.team);
        pet.attackCd = PET_ATTACK_CD;
    }
}

function updateTower(state: WfState, tower: WfTower) {
    if (!tower.alive || !laneActive(state, tower.lane)) { tower.targetId = null; return; }
    if (tower.attackCd > 0) tower.attackCd--;
    let targetPet: WfPet | null = null;
    let best = Infinity;
    for (const pet of state.pets) {
        if (pet.team === tower.team || pet.lane !== tower.lane || pet.respawnLeft > 0 || pet.hp <= 0 || pet.invulnerable > 0) continue;
        const d = distance(tower.x, tower.y, pet.x, pet.y);
        if (d <= TOWER_RANGE && d < best) { targetPet = pet; best = d; }
    }
    const foeWarden = state.wardens[other(tower.team)];
    const wardenDistance = foeWarden.active && foeWarden.lane === tower.lane
        ? distance(tower.x, tower.y, foeWarden.x, foeWarden.y)
        : Infinity;
    if (!targetPet && wardenDistance > TOWER_RANGE) { tower.targetId = null; tower.sameTargetShots = 0; return; }
    const nextTargetId = targetPet?.id ?? `warden-${foeWarden.team}`;
    if (tower.targetId !== nextTargetId) tower.sameTargetShots = 0;
    tower.targetId = nextTargetId;
    if (tower.attackCd > 0) return;
    const ramp = 1 + Math.min(0.5, tower.sameTargetShots * 0.08);
    if (targetPet) petDamage(state, targetPet, TOWER_DAMAGE * ramp, `tower-${tower.team}-${tower.lane}`, tower.team, false);
    else damageWarden(state, foeWarden, TOWER_DAMAGE * 1.25 * ramp, `tower-${tower.team}-${tower.lane}`, tower.team);
    tower.sameTargetShots++;
    tower.attackCd = TOWER_CD;
}

function updateWarden(state: WfState, warden: WfWarden) {
    if (!warden.active) return;
    warden.left--;
    if (warden.left <= 0) { dismissWarden(state, warden, other(warden.team), true); return; }
    if (!laneActive(state, warden.lane)) return;
    if (warden.attackCd > 0) warden.attackCd--;
    if (warden.slamCd > 0) warden.slamCd--;
    let target = nearestCombatTarget(state, warden.team, warden.lane, warden.x, warden.y);
    if (warden.aspect === "sentinel" && target) {
        const ownTower = state.towers[warden.team][warden.lane];
        const targetX = target.kind === "pet" ? target.pet.x : target.warden.x;
        const targetY = target.kind === "pet" ? target.pet.y : target.warden.y;
        if (distance(ownTower.x, ownTower.y, targetX, targetY) > TOWER_RANGE + 2) target = null;
    }
    if (target) {
        const targetX = target.kind === "pet" ? target.pet.x : target.warden.x;
        const targetY = target.kind === "pet" ? target.pet.y : target.warden.y;
        warden.targetId = target.kind === "pet" ? target.pet.id : `warden-${target.warden.team}`;
        const d = distance(warden.x, warden.y, targetX, targetY);
        if (d > WARDEN_RANGE) {
            const direction = targetX < warden.x ? -1 : 1;
            const speed = warden.aspect === "harrier" ? 0.94 : warden.aspect === "sentinel" ? 0.7 : 0.78;
            warden.x = quant(warden.x + direction * PET_BASE_SPEED * speed);
            warden.faceX = direction;
            return;
        }
        if (warden.attackCd <= 0) {
            if (target.kind === "pet") {
                const multiplier = warden.aspect === "harrier" ? 1.35 : warden.aspect === "breaker" ? 0.82 : 1;
                petDamage(state, target.pet, WARDEN_DAMAGE * multiplier, `warden-${warden.team}`, warden.team, false);
            }
            else damageWarden(state, target.warden, WARDEN_DAMAGE, `warden-${warden.team}`, warden.team);
            warden.attackCd = WARDEN_ATTACK_CD;
        }
        if (warden.slamCd <= 0) {
            state.events.push({ t: state.t, type: "wardenslam", team: warden.team, lane: warden.lane, x: warden.x, y: warden.y });
            for (const pet of state.pets) if (pet.team !== warden.team && pet.lane === warden.lane && pet.respawnLeft <= 0 && distance(warden.x, warden.y, pet.x, pet.y) <= 3.4) {
                const multiplier = warden.aspect === "harrier" ? 1.28 : warden.aspect === "breaker" ? 0.8 : 1;
                petDamage(state, pet, WARDEN_DAMAGE * 1.35 * multiplier, `warden-${warden.team}`, warden.team, false);
            }
            warden.slamCd = WARFRONT_TPS * 7;
        }
        return;
    }
    if (warden.aspect === "sentinel") {
        const ownTower = state.towers[warden.team][warden.lane];
        const anchorX = ownTower.x + (warden.team === "blue" ? 2.1 : -2.1);
        if (Math.abs(warden.x - anchorX) > 0.25) {
            const direction = anchorX < warden.x ? -1 : 1;
            warden.x = quant(warden.x + direction * PET_BASE_SPEED * 0.7);
            warden.faceX = warden.team === "blue" ? 1 : -1;
        }
        warden.targetId = `tower-${ownTower.team}-${ownTower.lane}`;
        return;
    }
    const tower = state.towers[other(warden.team)][warden.lane];
    const d = Math.abs(tower.x - warden.x);
    if (d > WARDEN_RANGE + TOWER_RADIUS) {
        const direction = warden.team === "blue" ? 1 : -1;
        warden.x = quant(warden.x + direction * PET_BASE_SPEED * 0.78);
        warden.faceX = direction;
        warden.targetId = `tower-${tower.team}-${tower.lane}`;
        return;
    }
    if (warden.attackCd <= 0) {
        const pact = state.doctrine[warden.team] === "warden-pact" ? 1.15 : 1;
        const aspect = warden.aspect === "breaker" ? 1.35 : 0.55;
        damageTower(state, tower, WARDEN_TOWER_DAMAGE * pact * aspect, `warden-${warden.team}`, warden.team);
        warden.attackCd = WARDEN_ATTACK_CD;
    }
}

function openScheduledWindow(state: WfState) {
    finalizeCommandImpacts(state);
    state.commandSequence++;
    state.pendingCommand = {
        sequence: state.commandSequence,
        t: state.t,
        reason: "scheduled",
        activeLanes: activeLanes(state),
        freedPetSlots: { blue: [], red: [] },
        maxMoves: 1,
    };
    state.events.push({ t: state.t, type: "round", round: state.commandSequence });
    state.events.push({ t: state.t, type: "commandwindow", reason: "scheduled", sequence: state.commandSequence });
}

function timeoutWinner(state: WfState): Team | "draw" {
    const score = stateScore(state);
    if (score.blue !== score.red) return score.blue > score.red ? "blue" : "red";
    if (Math.round(state.towerDamage.blue) !== Math.round(state.towerDamage.red)) return state.towerDamage.blue > state.towerDamage.red ? "blue" : "red";
    return "draw";
}

function tick(state: WfState, snapshotEvery: number) {
    state.t++;
    if (state.t % FAVOR_PASSIVE_EVERY === 0) {
        addFavor(state, "blue", state.stance.blue === "jungle" ? 1.2 : 1);
        addFavor(state, "red", state.stance.red === "jungle" ? 1.2 : 1);
    }
    if (state.t === RIFTFALL_TICKS) {
        state.events.push({ t: state.t, type: "riftfall" });
        state.events.push({ t: state.t, type: "phase", name: "RIFTFALL" });
    }

    updateWarden(state, state.wardens.blue);
    updateWarden(state, state.wardens.red);
    const teamOrder = (team: Team) => team === "blue" ? 0 : 1;
    const pets = [...state.pets].sort((a, b) => state.t % 2 === 0
        ? teamOrder(a.team) - teamOrder(b.team) || a.slot - b.slot
        : teamOrder(b.team) - teamOrder(a.team) || a.slot - b.slot);
    for (const pet of pets) {
        if (state.winner !== null || state.pendingCommand) break;
        updatePet(state, pet);
    }
    if (!state.pendingCommand && state.winner === null) {
        for (const lane of WF_LANE_IDS) {
            updateTower(state, state.towers.blue[lane]);
            updateTower(state, state.towers.red[lane]);
        }
    }
    const commandTicks = state.omen === "storm-gate" ? WARFRONT_TPS * 90 : COMMAND_TICKS;
    if (state.winner === null && !state.pendingCommand && state.t < MAX_TICKS && state.t % commandTicks === 0) openScheduledWindow(state);
    if (state.t >= MAX_TICKS && state.winner === null) {
        state.winner = timeoutWinner(state);
        finalizeCommandImpacts(state);
    }
    if (snapshotEvery > 0 && (state.t % snapshotEvery === 0 || state.pendingCommand || state.winner !== null)) {
        state.snapshots.push(snapshot(state));
    }
}

function desiredLane(state: WfState, team: Team, lanes: readonly WfLaneId[]): WfLaneId {
    const foe = other(team);
    return [...lanes].sort((a, b) => {
        const aTower = state.towers[foe][a].hp / TOWER_HP;
        const bTower = state.towers[foe][b].hp / TOWER_HP;
        const aOwn = state.towers[team][a].hp / TOWER_HP;
        const bOwn = state.towers[team][b].hp / TOWER_HP;
        return (aTower - aOwn * 0.35) - (bTower - bOwn * 0.35) || WF_LANE_IDS.indexOf(a) - WF_LANE_IDS.indexOf(b);
    })[0];
}

function autoChoices(state: WfState, team: Team, command: WfCommandState): WarfrontChoice[] {
    const choices: WarfrontChoice[] = [];
    if (command.reason === "breakthrough") {
        for (const slot of command.freedPetSlots[team]) choices.push({ type: "move", petIndex: slot, lane: desiredLane(state, team, command.activeLanes) });
    } else {
        const target = desiredLane(state, team, command.activeLanes);
        const counts = new Map(command.activeLanes.map((lane) => [lane, state.pets.filter((pet) => pet.team === team && pet.lane === lane).length]));
        const source = [...state.pets]
            .filter((pet) => pet.team === team && pet.lane !== target && (counts.get(pet.lane) ?? 0) > 1)
            .sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp || a.slot - b.slot)[0];
        if (source) choices.push({ type: "move", petIndex: source.slot, lane: target });
    }
    const cost = wardenCost(state, team);
    if (state.favor[team] >= cost && !state.wardens[team].active && command.activeLanes.length) {
        const lane = desiredLane(state, team, command.activeLanes);
        choices.push({ type: "summon", lane, aspect: autoWardenAspect(state, team, lane) });
    }
    return choices;
}

function parseChoices(values: readonly WarfrontChoice[] | undefined): WarfrontChoice[] {
    if (!Array.isArray(values)) return [];
    const parsed: WarfrontChoice[] = [];
    for (const value of values.slice(0, 6)) {
        if (!value || typeof value !== "object") continue;
        if (value.type === "move" && Number.isSafeInteger(value.petIndex) && value.petIndex >= 0 && value.petIndex < 4 && validLane(value.lane)) parsed.push({ type: "move", petIndex: value.petIndex, lane: value.lane });
        else if (value.type === "summon" && validLane(value.lane) && validWardenAspect(value.aspect)) {
            parsed.push({ type: "summon", lane: value.lane, aspect: value.aspect });
        }
    }
    return parsed;
}

function applyTeamCommand(state: WfState, team: Team, command: WfCommandState, raw: readonly WarfrontChoice[] | undefined): WarfrontCommandEntry {
    const fallback = autoChoices(state, team, command);
    const provided = parseChoices(raw);
    const moves = provided.filter((choice): choice is Extract<WarfrontChoice, { type: "move" }> => choice.type === "move");
    const summon = provided.find((choice): choice is Extract<WarfrontChoice, { type: "summon" }> => choice.type === "summon");
    const fallbackMoves = fallback.filter((choice): choice is Extract<WarfrontChoice, { type: "move" }> => choice.type === "move");
    const allowedSlots = command.reason === "breakthrough" ? new Set(command.freedPetSlots[team]) : null;
    const used = new Set<number>();
    const appliedMoves: Array<{ petIndex: number; lane: WfLaneId }> = [];
    // `undefined` means an unattended/AI window and may use the deterministic
    // fallback. An explicit empty or invalid array is the player's Hold command.
    const candidates = raw === undefined ? fallbackMoves : moves;
    for (const move of candidates) {
        if (appliedMoves.length >= command.maxMoves || used.has(move.petIndex) || !command.activeLanes.includes(move.lane)) continue;
        if (allowedSlots && !allowedSlots.has(move.petIndex)) continue;
        const pet = state.pets.find((candidate) => candidate.team === team && candidate.slot === move.petIndex);
        if (!pet || pet.lane === move.lane) continue;
        const from = pet.lane;
        pet.lane = move.lane;
        const [x, y] = wfSpawnPoint(team, move.lane, pet.slot);
        pet.x = x;
        pet.y = y;
        pet.faceX = team === "blue" ? 1 : -1;
        pet.invulnerable = Math.max(pet.invulnerable, WARFRONT_TPS * 2);
        pet.intent = `redeploy:${move.lane}`;
        appliedMoves.push({ petIndex: pet.slot, lane: move.lane });
        used.add(pet.slot);
        state.events.push({ t: state.t, type: "redeploy", team, petId: pet.id, from, lane: move.lane });
    }
    if (allowedSlots) {
        for (const slot of allowedSlots) {
            if (used.has(slot)) continue;
            const pet = state.pets.find((candidate) => candidate.team === team && candidate.slot === slot);
            const lane = desiredLane(state, team, command.activeLanes);
            if (!pet || pet.lane === lane) continue;
            const from = pet.lane;
            pet.lane = lane;
            const [x, y] = wfSpawnPoint(team, lane, pet.slot);
            pet.x = x; pet.y = y; pet.faceX = team === "blue" ? 1 : -1; pet.invulnerable = WARFRONT_TPS * 2;
            appliedMoves.push({ petIndex: slot, lane });
            state.events.push({ t: state.t, type: "redeploy", team, petId: pet.id, from, lane });
        }
    }
    const summonChoice = summon ?? (raw === undefined
        ? fallback.find((choice): choice is Extract<WarfrontChoice, { type: "summon" }> => choice.type === "summon")
        : undefined);
    let summonLane: WfLaneId | undefined;
    let summonAspect: WfWardenAspect | undefined;
    if (summonChoice && command.activeLanes.includes(summonChoice.lane) && !state.wardens[team].active) {
        const cost = wardenCost(state, team);
        if (state.favor[team] >= cost) {
            state.favor[team] = quant(state.favor[team] - cost);
            state.favorReady[team] = false;
            const warden = state.wardens[team];
            warden.active = true;
            warden.aspect = summonChoice.aspect;
            warden.lane = summonChoice.lane;
            warden.x = team === "blue" ? -WF_SPAWN_X + 1 : WF_SPAWN_X - 1;
            warden.y = WF_LANE_Y[summonChoice.lane];
            warden.faceX = team === "blue" ? 1 : -1;
            warden.hp = WARDEN_HP;
            warden.left = wardenDuration(state, team);
            warden.attackCd = 0;
            warden.slamCd = WARFRONT_TPS * 4;
            summonLane = summonChoice.lane;
            summonAspect = summonChoice.aspect;
            state.events.push({ t: state.t, type: "wardensummon", team, lane: summonChoice.lane, aspect: summonChoice.aspect });
        }
    }
    return {
        t: state.t,
        reason: command.reason,
        moves: appliedMoves,
        ...(summonLane && summonAspect ? { summonLane, summonAspect } : {}),
    };
}

function applyCommandWindow(state: WfState, blueChoices?: readonly WarfrontChoice[]) {
    const command = state.pendingCommand;
    if (!command) return;
    const redChoices = autoChoices(state, "red", command);
    const blueEntry = applyTeamCommand(state, "blue", command, blueChoices);
    const redEntry = applyTeamCommand(state, "red", command, redChoices);
    state.commandLog.push(blueEntry);
    state.events.push({ t: state.t, type: "commandresolved", sequence: command.sequence, reason: command.reason, blue: blueEntry, red: redEntry });
    beginCommandImpact(state, "blue", command.sequence, blueEntry);
    beginCommandImpact(state, "red", command.sequence, redEntry);
    if (command.reason === "breakthrough") {
        for (const team of ["blue", "red"] as const) {
            const warden = state.wardens[team];
            if (warden.active && warden.lane === command.resolvedLane) {
                warden.lane = desiredLane(state, team, command.activeLanes);
                warden.x = team === "blue" ? -WF_SPAWN_X + 1 : WF_SPAWN_X - 1;
                warden.y = WF_LANE_Y[warden.lane];
            }
        }
    }
    state.pendingCommand = null;
}

export interface WarfrontMatchCtl {
    readonly result: WarfrontResult;
    readonly done: boolean;
    readonly round: number;
    buyState(team: Team): Array<{ petId: string; petName: string; stacks: Record<WfPowerupKind, number>; costs: Record<WfPowerupKind, number> }>;
    coins(team: Team): number;
    favor(team: Team): number;
    stances(): Record<Team, WfStance>;
    commandState(): WfCommandState | null;
    lanes(): Record<Team, WfLaneId[]>;
    commandLog(): WarfrontCommandEntry[];
    advanceRound(blueChoices?: WarfrontChoice[], blueStance?: WfStance): void;
    advanceRoundPartial(maxTicks: number, blueChoices?: WarfrontChoice[], blueStance?: WfStance): boolean;
}

export type WarfrontRuntimeOptions = Readonly<{
    /** Presentation snapshots are unnecessary during authoritative settlement.
     * Disabling them keeps the server result bounded while preserving the exact
     * winner, ticks, events, command log, and pet statistics. */
    captureSnapshots?: boolean;
    /** Presentation-only sampling interval. Runtime authority ignores this
     * when captureSnapshots is false. */
    snapshotEvery?: number;
}>;

export function startWarfrontMatch(
    blue: ArenaSlot[], red: ArenaSlot[], seed: number,
    opts?: {
        bluePolicy?: WfBuyPolicy; redPolicy?: WfBuyPolicy; theme?: string;
        blueStance?: WfStance; redStance?: WfStance;
        blueDoctrine?: WfDoctrine; redDoctrine?: WfDoctrine;
        adaptStances?: boolean;
        snapshotEvery?: number;
        initialLanes?: Partial<Record<Team, readonly WfLaneId[]>>;
    },
): WarfrontMatchCtl {
    const state = initState(
        blue,
        red,
        seed,
        opts?.initialLanes,
        { blue: opts?.blueStance, red: opts?.redStance },
        { blue: opts?.blueDoctrine, red: opts?.redDoctrine },
    );
    const openingLanes: Record<Team, WfLaneId[]> = {
        blue: state.pets.filter((pet) => pet.team === "blue").sort((a, b) => a.slot - b.slot).map((pet) => pet.lane),
        red: state.pets.filter((pet) => pet.team === "red").sort((a, b) => a.slot - b.slot).map((pet) => pet.lane),
    };
    const snapshotEvery = opts?.snapshotEvery === 0
        ? 0
        : Math.max(1, Math.min(WARFRONT_TPS, Math.floor(opts?.snapshotEvery ?? 1)));
    state.snapshots.push(snapshot(state));
    const result: WarfrontResult = {
        winner: null,
        ticks: 0,
        snapshots: state.snapshots,
        events: state.events,
        theme: opts?.theme,
        coins: { blue: 0, red: 0 },
        initialLanes: openingLanes,
        commandLog: state.commandLog,
        omen: state.omen,
        commandImpacts: state.commandImpacts,
    };
    let segments = 0;
    const syncResult = () => {
        result.ticks = state.t;
        result.winner = state.winner;
        result.petStats = state.pets.map((pet) => ({
            id: pet.id, name: pet.pet.name, team: pet.team, level: 1,
            kills: pet.kills, assists: pet.assists, dmg: Math.round(pet.dmg + pet.towerDamage), coins: 0,
        }));
    };
    const emptyStacks = (): Record<WfPowerupKind, number> => ({ strike: 0, guard: 0, vitality: 0, swift: 0, mend: 0 });
    return {
        get result() { return result; },
        get done() { return result.winner !== null; },
        get round() { return segments; },
        coins: () => 0,
        favor: (team) => state.favor[team],
        stances: () => ({ ...state.stance }),
        commandState: () => state.pendingCommand ? { ...state.pendingCommand, activeLanes: [...state.pendingCommand.activeLanes], freedPetSlots: { blue: [...state.pendingCommand.freedPetSlots.blue], red: [...state.pendingCommand.freedPetSlots.red] } } : null,
        lanes: () => ({
            blue: state.pets.filter((pet) => pet.team === "blue").sort((a, b) => a.slot - b.slot).map((pet) => pet.lane),
            red: state.pets.filter((pet) => pet.team === "red").sort((a, b) => a.slot - b.slot).map((pet) => pet.lane),
        }),
        commandLog: () => state.commandLog.map((entry) => ({ ...entry, moves: entry.moves.map((move) => ({ ...move })) })),
        buyState: (team) => state.pets.filter((pet) => pet.team === team).map((pet) => ({
            petId: pet.id, petName: pet.pet.name, stacks: emptyStacks(), costs: emptyStacks(),
        })),
        advanceRound(blueChoices?: WarfrontChoice[]) {
            if (result.winner !== null) return;
            if (state.pendingCommand) applyCommandWindow(state, blueChoices);
            while (state.winner === null && !state.pendingCommand) tick(state, snapshotEvery);
            segments++;
            syncResult();
        },
        advanceRoundPartial(maxTicks: number, blueChoices?: WarfrontChoice[]) {
            if (result.winner !== null) return true;
            if (state.pendingCommand) applyCommandWindow(state, blueChoices);
            let ticks = 0;
            const cap = Math.max(1, Math.floor(maxTicks));
            while (state.winner === null && !state.pendingCommand && ticks++ < cap) tick(state, snapshotEvery);
            if (state.winner !== null || state.pendingCommand) segments++;
            syncResult();
            return state.winner !== null || state.pendingCommand !== null;
        },
    };
}

export function runWarfrontMatch(
    blue: ArenaSlot[], red: ArenaSlot[], seed: number,
    bluePolicy: WfBuyPolicy = "balanced", redPolicy: WfBuyPolicy = "balanced", theme?: string,
    stances?: { blue?: WfStance; red?: WfStance; adapt?: boolean },
    doctrines?: { blue?: WfDoctrine; red?: WfDoctrine },
    plan?: {
        initialLanes?: Partial<Record<Team, readonly WfLaneId[]>>;
        commands?: readonly WarfrontCommandEntry[];
    },
    runtime?: WarfrontRuntimeOptions,
): WarfrontResult {
    const control = startWarfrontMatch(blue, red, seed, {
        bluePolicy, redPolicy, theme,
        blueStance: stances?.blue,
        redStance: stances?.red,
        blueDoctrine: doctrines?.blue,
        redDoctrine: doctrines?.red,
        adaptStances: stances?.adapt,
        initialLanes: plan?.initialLanes,
        snapshotEvery: runtime?.captureSnapshots === false ? 0 : runtime?.snapshotEvery,
    });
    let commandIndex = 0;
    let guard = 0;
    while (!control.done && guard++ < 32) {
        const pending = control.commandState();
        // Once a player-authored plan exists, an omitted or mismatched window is
        // Hold—not permission for the deterministic AI to improve that plan.
        // `undefined` remains reserved for the sealed no-plan baseline.
        let choices: WarfrontChoice[] | undefined = plan ? [] : undefined;
        if (pending) {
            const command = plan?.commands?.[commandIndex++];
            if (command && command.t === pending.t && command.reason === pending.reason) {
                choices = [
                    ...command.moves.map((move) => ({ type: "move" as const, petIndex: move.petIndex, lane: move.lane })),
                    ...(command.summonLane
                        ? [{ type: "summon" as const, lane: command.summonLane, aspect: command.summonAspect ?? "breaker" }]
                        : []),
                ];
            }
        }
        control.advanceRound(choices);
    }
    return control.result;
}
