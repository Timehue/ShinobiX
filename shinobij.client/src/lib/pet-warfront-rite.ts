/*
 * pet-warfront-rite.ts — Hollow Warfront, the AUTOBATTLER.
 *
 * FOUR PETS PER BAND: all four active, best of three formation clashes.
 *
 * Each Beastbound Warfront clash keeps pets on discrete cells with cover and line
 * of sight, and use role-specific ranges and priorities. Placement creates the
 * plan without class locks; the engine never resolves movement with body pushing.
 *
 * A clash runs through the additive `runPetSquadDuelCinematic` entry point. That
 * path now owns a Warfront-only grid simulation; the existing Coliseum duel
 * paths remain byte-identical and share only the shipped pet data/model layer.
 *
 * RELEASE RATCHETS (pet-warfront-rite.test.ts): hard cell ownership, correct
 * facing, sight/cover, role actions, meaningful free deployment, pacing and
 * deterministic server parity.
 * Re-run the statistical harness before publishing new balance claims whenever
 * the maze, objective travel, targeting priorities, or pet damage changes.
 *
 * Determinism: no Date, no Math.random, no localStorage. `accuracyEnabled` and
 * `applyItems` are passed EXPLICITLY, because the engine's defaults read client
 * state the server mirror cannot see. Items are off by design — the
 * balanced-PvP pillar says power comes from play, not from carried gear.
 */
import type { Pet } from "../types/pet";
import { derivePetRole, type PetRole } from "./pet-roles";
import { DUEL_TPS, type DuelResult } from "./pet-duel-sim";
import {
    WARFRONT_DEFAULT_DEPLOYMENT,
    WARFRONT_DEPLOYMENT_NODES,
    runPetSquadDuelCinematic,
} from "./pet-duel-cinematic";
export { WARFRONT_DEFAULT_DEPLOYMENT, WARFRONT_DEPLOYMENT_NODES } from "./pet-duel-cinematic";

/** Pets per band. Matches the sealed team size in api/pet/warfront-start.ts. */
export const RITE_BAND_SIZE = 4;
/** Every band member fights. Formation depth changes behaviour, never eligibility. */
export const RITE_ACTIVE_SIZE = 4;

/** Legacy strategy vocabulary retained for old recaps and saved replays. Free
 *  deployment no longer requires one pet in each job. */
export const RITE_JOBS = Object.freeze([
    Object.freeze({ id: "vanguard", label: "VANGUARD", brief: "Contests the center" }),
    Object.freeze({ id: "warden", label: "WARDEN", brief: "Intercepts their Flanker" }),
    Object.freeze({ id: "flanker", label: "FLANKER", brief: "Hunts their Anchor" }),
    Object.freeze({ id: "anchor", label: "ANCHOR", brief: "Holds the home post" }),
] as const);
/** Only two of the opponent's deployed positions are revealed. */
export const RITE_SCOUTED_JOBS = 2;
/** Compatibility alias for old callers; these are scouted jobs, not a front line. */
export const RITE_FRONT_SLOTS = RITE_SCOUTED_JOBS;

/**
 * Clash-length scale applied to every pet's `hp` before the engine builds it.
 *
 * Formation clashes need enough durability for opening movement, a first
 * technique cycle and a visible signature beat without becoming attrition.
 * Re-run `scripts/warfront-rite-harness.mts` whenever squad size or engine
 * damage changes; pacing is certified against the real pet pool, not fixtures.
 */
export const RITE_SQUAD_HP_SCALE = 0.58;

/** Clashes in a match. First to two wins; a 2-0 ends it early. */
export const RITE_CLASHES_TO_WIN = 2;
export const RITE_MAX_CLASHES = 3;

/**
 * Health a pet that FELL in the previous clash returns with.
 *
 * Falling has to hurt without ending the match: with permadeath the next clash
 * becomes a lopsided cleanup and the result is settled before it starts, which is the
 * "foregone conclusion" problem a previous Warfront pass spent a whole commit
 * failing to fix. A wounded return keeps a best-of-three genuinely live while
 * still making the first clash matter.
 */
export const RITE_DOWNED_RETURN_HP = 0.45;

/** A survivor never returns below this — a 3% pet is not a fight. */
export const RITE_MIN_ENTRY_HP = 0.12;

/**
 * REGROUP — how much of its missing health a band recovers between clashes.
 *
 * Without this the mode is a best-of-three in name only. Wounds carry, so the
 * side that lost clash one walks into clash two wounded against a healthy
 * opponent and simply loses again: MEASURED at 77.5% 2-0 sweeps with only 10%
 * of matches won by the side that lost the opening clash. That is the same
 * "foregone conclusion" a previous Warfront pass burned a whole commit failing
 * to fix.
 *
 * The side that LOST regroups harder — it had to pull back and regather, while
 * the winner held the ring. This is a deliberate rubber band, and a legible one:
 * it restores health, never grants power, so it can never turn a weaker band
 * into a stronger one.
 */
export const RITE_REGROUP = 0.72;
export const RITE_LOSER_REGROUP = 0.88;

export type RiteSide = "blue" | "red";

/**
 * BOND — what a band's composition grants each of its members.
 *
 * Four pets that merely stand near each other are still four individuals.
 * Bonds are what make an active squad: every fielded pet contributes by role to
 * its allies, and contributes half again when it shares the recipient's element.
 *
 * Applied caller-side by scaling `hp`/`attack` before the engine builds a
 * fighter — the same lever as RITE_SQUAD_HP_SCALE — so the shared Coliseum
 * engine is untouched and the whole thing stays deterministic and replayable.
 */
export const RITE_BOND_BY_ROLE: Readonly<Record<PetRole, { hp: number; attack: number; verb: string }>> = Object.freeze({
    defender: { hp: 0.06, attack: 0, verb: "fortifies" },
    sage: { hp: 0.07, attack: 0, verb: "mends" },
    tracker: { hp: 0, attack: 0.05, verb: "marks" },
    assassin: { hp: 0, attack: 0.06, verb: "sharpens" },
});

/** Sharing an element with the recipient makes a bond land half again as hard. */
export const RITE_BOND_RESONANCE = 1.5;
export const RITE_BOND_MAX_HP = 1.24;
export const RITE_BOND_MAX_ATTACK = 1.2;

export interface RiteBond {
    hpMult: number;
    attackMult: number;
    contributions: ReadonlyArray<{ petId: string; slot: number; role: PetRole; resonant: boolean; verb: string }>;
}

const NO_BOND: RiteBond = Object.freeze({ hpMult: 1, attackMult: 1, contributions: [] });
const roleOf = (pet: Pet): PetRole => (pet.role as PetRole | undefined) ?? derivePetRole(pet).role;

/** The bond `recipient` receives from the rest of its standing band. */
export function riteBond(recipient: Pet, allies: ReadonlyArray<{ pet: Pet; slot: number }>): RiteBond {
    if (!recipient || !allies.length) return NO_BOND;
    let hp = 1;
    let attack = 1;
    const contributions: Array<{ petId: string; slot: number; role: PetRole; resonant: boolean; verb: string }> = [];
    for (const entry of allies) {
        const pet = entry.pet;
        if (!pet) continue;
        const role = roleOf(pet);
        const spec = RITE_BOND_BY_ROLE[role];
        if (!spec) continue;
        const resonant = Boolean(pet.element) && pet.element === recipient.element;
        const scale = resonant ? RITE_BOND_RESONANCE : 1;
        hp += spec.hp * scale;
        attack += spec.attack * scale;
        contributions.push({ petId: String(pet.id), slot: entry.slot, role, resonant, verb: spec.verb });
    }
    return {
        hpMult: Math.min(RITE_BOND_MAX_HP, hp),
        attackMult: Math.min(RITE_BOND_MAX_ATTACK, attack),
        contributions,
    };
}

/** Distinct elements in a band. "None" is its own bucket — it cannot be countered. */
export function riteBandElements(band: readonly Pet[]): string[] {
    const seen = new Set<string>();
    for (const pet of band) seen.add(pet?.element ? String(pet.element) : "None");
    return [...seen];
}

/**
 * ⛔ THERE IS NO ELEMENT REQUIREMENT. Owner ruling 2026-09-01 — do not add one back.
 *
 * A `RITE_MIN_ELEMENTS = 3` gate used to block a band carrying fewer than three
 * distinct elements, on the measurement that a mono-element band loses ~1.2% of
 * matches against its hard counter (two of five matchups measured a flat 0.0%).
 *
 * That measurement was real but it answered the wrong question: it ran level-1
 * pets on BOTH sides, so it only ever showed the ±15% chart working as intended.
 * A counter beating its victim at equal level is the mechanic, not a defect —
 * and levels are the axis a player actually invests in. Blocking entry protected
 * players from a correct mechanic while removing the choice to answer it by
 * levelling, or simply to take a bad matchup knowingly.
 *
 * The ruling is that players decide what is best for them. A band that can be
 * fielded is a band that may enter; the enemy Vanguard and Warden are scouted
 * on the deploy screen, so the opening orders are visible before anyone commits.
 */

/** Whether a band may ENTER. Deliberately allows duplicate pet ids: the
 *  generated rival band cycles a three-pet pool into four slots, and the engine
 *  keys on slot rather than id, so a repeat is harmless. */
export function isValidRiteBand(band: readonly Pet[], bandSize = RITE_BAND_SIZE): boolean {
    if (!Array.isArray(band) || band.length !== bandSize) return false;
    return !band.some((pet) => !pet?.id);
}

/** Player-facing reason a band cannot be SELECTED. Stricter by one rule: a
 *  player fields four DIFFERENT pets, because one pet cannot hold two slots.
 *  Composition is NOT policed — see the ruling above. */
export function riteBandProblem(band: readonly Pet[], bandSize = RITE_BAND_SIZE): string | null {
    if (!Array.isArray(band) || band.length !== bandSize) return `Pick ${bandSize} pets for your band.`;
    if (band.some((pet) => !pet?.id)) return `Pick ${bandSize} pets for your band.`;
    if (new Set(band.map((pet) => String(pet.id))).size !== bandSize) return "Each pet can only take one slot.";
    return null;
}

/** A side's sealed deployment transcript. Formation remains for legacy replay
 * compatibility; deployment is roster-indexed and names one of the ten free
 * marks for every pet. */
export interface RiteReform {
    /** The completed clash whose public evidence prompted this adjustment. */
    afterClash: number;
    /** Stable roster playback order adopted for the following clash. */
    formation: number[];
    /** Roster-indexed legal deployment adopted for the following clash. */
    deployment: number[];
}

export interface RitePlan {
    /** Stable roster playback order. New clients leave this as roster order. */
    formation: number[];
    /** Roster-indexed deployment node ids. Omitted only by legacy replays. */
    deployment?: number[];
    /** Re-form after this clash index resolves. One per match; null = unused. */
    reformAfterClash: number | null;
    /** Legacy roster-order adjustment. */
    reform?: number[] | null;
    /** Roster-indexed deployment adopted after the chosen clash. */
    reformDeployment?: number[] | null;
    /**
     * Ordered decision transcript for the current best-of-three. A player may
     * lock one re-form after every non-terminal clash; the legacy singular
     * fields above remain readable for old receipts and replays.
     */
    reforms?: RiteReform[];
}

export interface RiteCombatant {
    slot: number;
    petId: string;
    lane: number;
    /** Free-deployment node occupied when the clash began. */
    node: number;
    /** 0..1 health this pet walked into the clash with. */
    entryHp: number;
    /** 0..1 cumulative base-roster health it walked out with. Zero means it fell. */
    exitHp: number;
    bond: RiteBond;
}

export interface RiteClash {
    index: number;
    seed: number;
    blue: RiteCombatant[];
    red: RiteCombatant[];
    /** Compatibility sentinels; Beastbound Warfront stores -1 because all fight. */
    blueReserveSlot: number;
    redReserveSlot: number;
    /** Pets left standing when the clash ended. */
    blueStanding: number;
    redStanding: number;
    /** A wipe or the health verdict at the tactical clock. */
    finish: "wipe" | "survival";
    /** Compatibility field for older result consumers; always null. */
    captureCarrierSlot: number | null;
    winner: RiteSide | null;
    ticks: number;
    seconds: number;
    result: DuelResult;
}

export interface RiteCounterMove {
    side: RiteSide;
    afterClash: number;
    slot: number;
    petId: string;
    fromNode: number;
    toNode: number;
    observedOpponentSlot: number | null;
    observedOpponentPetId: string | null;
    evidence: "first-fall" | "lowest-health";
    threatEvidence: "last-hit" | "highest-damage" | "formation-fallback";
    formation: number[];
    deployment: number[];
}

export interface RiteResult {
    winner: RiteSide | null;
    clashes: RiteClash[];
    blueRounds: number;
    redRounds: number;
    /** Roster slot of the blue pet with the most knockouts, or null. */
    mvpSlot: number | null;
    mvpPetId: string | null;
    seed: number;
    totalTicks: number;
    totalSeconds: number;
    bluePlan: RitePlan;
    redPlan: RitePlan;
}

/** Deterministic per-clash seed. Integer ops only, so the mirror agrees. */
function clashSeed(matchSeed: number, index: number): number {
    let h = (matchSeed ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (index + 1), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

const isPermutation = (order: unknown, size: number): order is number[] => {
    if (!Array.isArray(order) || order.length !== size) return false;
    const seen = new Set<number>();
    for (const index of order) {
        if (!Number.isInteger(index) || index < 0 || index >= size || seen.has(index)) return false;
        seen.add(index);
    }
    return true;
};

const isDeployment = (nodes: unknown, size: number): nodes is number[] => {
    if (!Array.isArray(nodes) || nodes.length !== size) return false;
    const seen = new Set<number>();
    for (const node of nodes) {
        if (!Number.isInteger(node) || node < 0 || node >= WARFRONT_DEPLOYMENT_NODES.length || seen.has(node)) return false;
        seen.add(node);
    }
    return true;
};

const defaultDeployment = (size: number): number[] =>
    Array.from({ length: size }, (_, index) => WARFRONT_DEFAULT_DEPLOYMENT[index] ?? index);

/** One legal placement action. Occupied cells are deliberately rejected: with
 * six open marks on a four-pet half, every permutation remains possible without
 * silently moving a second pet the player did not choose. */
export function tryMoveRitePet(
    deployment: readonly number[],
    slot: number,
    node: number,
    bandSize = RITE_BAND_SIZE,
): number[] | null {
    if (!isDeployment(deployment, bandSize)
        || !Number.isInteger(slot) || slot < 0 || slot >= bandSize
        || !Number.isInteger(node) || node < 0 || node >= WARFRONT_DEPLOYMENT_NODES.length
        || deployment.includes(node)) return null;
    const next = [...deployment];
    next[slot] = node;
    return next;
}

export function isValidRitePlan(plan: RitePlan | null | undefined, bandSize = RITE_BAND_SIZE): boolean {
    if (!plan || !isPermutation(plan.formation, bandSize)) return false;
    if (plan.deployment !== undefined && plan.deployment !== null && !isDeployment(plan.deployment, bandSize)) return false;
    const at = plan.reformAfterClash;
    if (at !== null && at !== undefined) {
        if (!Number.isInteger(at) || at < 0 || at >= RITE_MAX_CLASHES) return false;
        if (plan.reform !== null && plan.reform !== undefined && !isPermutation(plan.reform, bandSize)) return false;
        if (plan.reformDeployment !== null && plan.reformDeployment !== undefined && !isDeployment(plan.reformDeployment, bandSize)) return false;
    } else if (plan.reformDeployment !== null && plan.reformDeployment !== undefined) {
        return false;
    }
    if (plan.reforms !== null && plan.reforms !== undefined) {
        if (!Array.isArray(plan.reforms) || plan.reforms.length > RITE_MAX_CLASHES - 1) return false;
        let previous = -1;
        for (const reform of plan.reforms) {
            if (!reform || !Number.isInteger(reform.afterClash)
                || reform.afterClash < 0 || reform.afterClash >= RITE_MAX_CLASHES - 1
                || reform.afterClash <= previous
                || !isPermutation(reform.formation, bandSize)
                || !isDeployment(reform.deployment, bandSize)) return false;
            previous = reform.afterClash;
        }
    }
    return true;
}

/** Reduce an illegal or missing plan to the default formation rather than
 *  throwing — a tampered transcript must degrade to a legal match, never crash
 *  settlement. */
export function sanitizeRitePlan(plan: RitePlan | null | undefined, bandSize = RITE_BAND_SIZE): RitePlan {
    if (isValidRitePlan(plan, bandSize)) {
        return {
            formation: [...plan!.formation],
            deployment: plan!.deployment ? [...plan!.deployment] : defaultDeployment(bandSize),
            reformAfterClash: plan!.reformAfterClash ?? null,
            reform: plan!.reform ? [...plan!.reform] : null,
            reformDeployment: plan!.reformDeployment ? [...plan!.reformDeployment] : null,
            reforms: plan!.reforms?.map((entry) => ({
                afterClash: entry.afterClash,
                formation: [...entry.formation],
                deployment: [...entry.deployment],
            })),
        };
    }
    return {
        formation: Array.from({ length: bandSize }, (_, i) => i),
        deployment: defaultDeployment(bandSize),
        reformAfterClash: null,
        reform: null,
        reformDeployment: null,
        reforms: [],
    };
}

/**
 * The AI's sealed plan, deterministic from the seed alone so the server mirror
 * reproduces it and it cannot read the player's hidden formation.
 *
 * It assigns pets by readable role fit. The plan is sealed and deterministic;
 * it cannot inspect or counter-pick the player's hidden jobs.
 */
export function aiRitePlan(band: readonly Pet[], seed: number): RitePlan {
    const remaining = band.map((_, index) => index);
    const takeBest = (score: (pet: Pet) => number): number => {
        let bestAt = 0;
        let bestScore = -Infinity;
        remaining.forEach((index, at) => {
            const tie = ((seed + index * 17) % 997) / 1_000_000;
            const value = score(band[index]) + tie;
            if (value > bestScore) { bestScore = value; bestAt = at; }
        });
        return remaining.splice(bestAt, 1)[0];
    };
    const vanguard = takeBest((pet) => (pet.hp ?? 1) + (pet.defense ?? 0) * 4 + (roleOf(pet) === "defender" ? 900 : 0));
    const anchor = takeBest((pet) => (pet.hp ?? 1) * 0.5 + (pet.defense ?? 0) * 3 + (roleOf(pet) === "sage" ? 1100 : 0));
    const flanker = takeBest((pet) => (pet.attack ?? 0) * 5 + (pet.speed ?? 0) * 4 + (roleOf(pet) === "assassin" ? 900 : roleOf(pet) === "tracker" ? 450 : 0));
    const warden = remaining[0];
    const formation = [vanguard, warden, flanker, anchor];
    const deployment = defaultDeployment(band.length);
    formation.forEach((slot, fieldIndex) => { deployment[slot] = WARFRONT_DEFAULT_DEPLOYMENT[fieldIndex]; });
    return { formation, deployment, reformAfterClash: null, reform: null, reformDeployment: null, reforms: [] };
}

/** A pet as it enters a clash: base stats scaled for pacing, by the health it
 *  carries in, and by its band bond. The engine reads `hp`/`attack` when it
 *  builds a fighter, so this is the whole modifier pipeline. */
function entrant(pet: Pet, entryHp: number, bond: RiteBond): Pet {
    const hp = Math.max(1, Math.round((pet.hp || 1) * RITE_SQUAD_HP_SCALE * entryHp * bond.hpMult));
    const attack = Math.max(1, Math.round((pet.attack || 1) * bond.attackMult));
    return { ...pet, hp, attack };
}

/** Final health of each fighter, as a 0..1 fraction of what it entered with. */
function exitFractions(result: DuelResult, team: "player" | "enemy"): Map<number, number> {
    const out = new Map<number, number>();
    const last = result.snapshots[result.snapshots.length - 1];
    if (!last) return out;
    for (const actor of last.actors) {
        if (actor.team !== team) continue;
        out.set(actor.slot, actor.maxHp > 0 ? Math.max(0, Math.min(1, actor.hp / actor.maxHp)) : 0);
    }
    return out;
}

/** Resolve a modern per-clash decision first, then the singular legacy command.
 * Keeping this seam centralized makes old settlement receipts replay exactly
 * while new matches can record both possible best-of-three handoffs. */
function riteReformAfter(plan: RitePlan, clashIndex: number): RiteReform | null {
    const modern = plan.reforms?.find((entry) => entry.afterClash === clashIndex);
    if (modern) return modern;
    if (plan.reformAfterClash !== clashIndex) return null;
    return {
        afterClash: clashIndex,
        formation: plan.reform ? [...plan.reform] : [...plan.formation],
        deployment: plan.reformDeployment
            ? [...plan.reformDeployment]
            : [...(plan.deployment ?? defaultDeployment(plan.formation.length))],
    };
}

/**
 * One public-evidence counter for the losing side between clashes.
 *
 * The first fallen pet retreats to an unoccupied rear mark farthest from the
 * rival that last hit it. If no knockout occurred, the lowest-health pet and
 * highest-damage rival provide deterministic fallbacks. Crucially this reads
 * only the completed clash object: a player's still-unsealed next formation is
 * not an argument and therefore cannot affect the move.
 */
export function deterministicRiteCounterMove(clash: RiteClash, side: RiteSide): RiteCounterMove | null {
    // A winner holds its proven line; a draw supplies no losing side. Keeping
    // this gate inside the pure helper makes live, spectator, replay and server
    // callers share the exact same counter policy.
    if (clash.winner === null || clash.winner === side) return null;
    const ownTeam = side === "blue" ? "player" : "enemy";
    const foeTeam = ownTeam === "player" ? "enemy" : "player";
    const own = side === "blue" ? clash.blue : clash.red;
    const foe = side === "blue" ? clash.red : clash.blue;
    const actorId = (team: "player" | "enemy", lane: number) => `${team}-${lane}`;
    const ownByActor = new Map(own.map((combatant) => [actorId(ownTeam, combatant.lane), combatant]));
    const foeByActor = new Map(foe.map((combatant) => [actorId(foeTeam, combatant.lane), combatant]));

    const firstFallEvent = clash.result.events.find((event) => event.type === "ko" && event.side === ownTeam);
    const firstFall = firstFallEvent ? ownByActor.get(firstFallEvent.actorId) ?? null : null;
    const mover = firstFall ?? [...own].sort((a, b) => a.exitHp - b.exitHp || a.slot - b.slot)[0] ?? null;
    if (!mover) return null;

    const moverActorId = actorId(ownTeam, mover.lane);
    let observedAttacker = null as RiteCombatant | null;
    let threatEvidence: RiteCounterMove["threatEvidence"] = "formation-fallback";
    for (const event of clash.result.events) {
        if (event.type !== "hit" || event.side !== foeTeam || event.targetId !== moverActorId) continue;
        observedAttacker = foeByActor.get(event.actorId) ?? observedAttacker;
        if (observedAttacker) threatEvidence = "last-hit";
    }
    if (!observedAttacker) {
        const damageByActor = new Map<string, number>();
        for (const event of clash.result.events) {
            if (event.type !== "hit" || event.side !== foeTeam || !event.dmg || event.dmg <= 0) continue;
            damageByActor.set(event.actorId, (damageByActor.get(event.actorId) ?? 0) + event.dmg);
        }
        const highestDamageActor = [...damageByActor.entries()]
            .sort((a, b) => b[1] - a[1] || (a[0] === b[0] ? 0 : a[0] < b[0] ? -1 : 1))[0]?.[0];
        observedAttacker = highestDamageActor ? foeByActor.get(highestDamageActor) ?? null : null;
        if (observedAttacker) threatEvidence = "highest-damage";
    }

    const occupied = new Set(own.map((combatant) => combatant.node));
    // A zero-data clash still gets a deterministic legal response, but it does
    // not invent an observed attacker. Centre line is the neutral public-board
    // fallback and the nullable metadata makes that distinction inspectable.
    const attackerY = observedAttacker
        ? WARFRONT_DEPLOYMENT_NODES[observedAttacker.node]?.[1] ?? 0
        : 0;
    const toNode = WARFRONT_DEPLOYMENT_NODES
        .map((node, index) => ({ index, node }))
        .filter(({ index }) => index % 2 === 0 && !occupied.has(index))
        .sort((a, b) => Math.abs(b.node[1] - attackerY) - Math.abs(a.node[1] - attackerY) || a.index - b.index)[0]?.index;
    if (toNode === undefined) return null;

    const formation = [...own].sort((a, b) => a.lane - b.lane).map((combatant) => combatant.slot);
    const deployment = Array.from({ length: own.length }, (_, slot) => own.find((combatant) => combatant.slot === slot)?.node ?? defaultDeployment(own.length)[slot]);
    deployment[mover.slot] = toNode;
    return {
        side,
        afterClash: clash.index,
        slot: mover.slot,
        petId: mover.petId,
        fromNode: mover.node,
        toNode,
        observedOpponentSlot: observedAttacker?.slot ?? null,
        observedOpponentPetId: observedAttacker?.petId ?? null,
        evidence: firstFall ? "first-fall" : "lowest-health",
        threatEvidence,
        formation,
        deployment,
    };
}

/**
 * Run a full Rite: up to three simultaneous 4v4 formation clashes, first to two.
 * A re-form changes every pet's starting cell without changing who is allowed
 * to participate.
 * Pure and deterministic given (bands, seed, plans).
 */
export function runWarfrontRite(
    blueBand: readonly Pet[],
    redBand: readonly Pet[],
    seed: number,
    bluePlanInput?: RitePlan | null,
    redPlanInput?: RitePlan | null,
): RiteResult {
    const bandSize = Math.min(blueBand.length, redBand.length);
    // Headless replays give both seats the same sealed AI planner. The live UI
    // always supplies the player's chosen plan, but symmetric fallback here is
    // essential for fair balance certification and server-side probes.
    const blueUsesAiPlan = !bluePlanInput;
    const bluePlan = bluePlanInput ? sanitizeRitePlan(bluePlanInput, bandSize) : aiRitePlan(blueBand, seed);
    const redUsesAiPlan = !redPlanInput;
    const redPlan = redPlanInput ? sanitizeRitePlan(redPlanInput, bandSize) : aiRitePlan(redBand, seed);

    // Health each roster slot carries between clashes. Everyone starts whole.
    const blueHp = new Map<number, number>(blueBand.map((_, slot) => [slot, 1]));
    const redHp = new Map<number, number>(redBand.map((_, slot) => [slot, 1]));
    let blueFormation = [...bluePlan.formation];
    let redFormation = [...redPlan.formation];
    let blueDeployment = [...(bluePlan.deployment ?? defaultDeployment(bandSize))];
    let redDeployment = [...(redPlan.deployment ?? defaultDeployment(bandSize))];

    let blueRounds = 0;
    let redRounds = 0;
    let totalTicks = 0;
    const clashes: RiteClash[] = [];
    const blueKos = new Map<number, number>();

    for (let index = 0; index < RITE_MAX_CLASHES; index++) {
        // All four formation entries fight; no pet is hidden on a bench.
        const entryOf = (hp: Map<number, number>, slot: number) =>
            Math.max(RITE_MIN_ENTRY_HP, hp.get(slot) || RITE_DOWNED_RETURN_HP);


        const buildSide = (band: readonly Pet[], formation: number[], deployment: number[], hp: Map<number, number>) => {
            const active = formation.slice(0, Math.min(RITE_ACTIVE_SIZE, formation.length));
            const standing = active.map((slot) => ({ pet: band[slot], slot })).filter((e) => Boolean(e.pet));
            return active.map((slot, lane) => {
                const pet = band[slot];
                const allies = standing.filter((e) => e.slot !== slot);
                return {
                    slot,
                    lane,
                    node: deployment[slot] ?? defaultDeployment(bandSize)[slot],
                    pet,
                    entryHp: entryOf(hp, slot),
                    bond: riteBond(pet, allies),
                };
            }).filter((e) => Boolean(e.pet));
        };

        const blueSide = buildSide(blueBand, blueFormation, blueDeployment, blueHp);
        const redSide = buildSide(redBand, redFormation, redDeployment, redHp);
        if (!blueSide.length || !redSide.length) break;

        const thisSeed = clashSeed(seed, index);
        const result = runPetSquadDuelCinematic(
            blueSide.map((e) => entrant(e.pet, e.entryHp, e.bond)),
            redSide.map((e) => entrant(e.pet, e.entryHp, e.bond)),
            thisSeed,
            /* applyItems */ false,
            /* accuracyEnabled */ true,
            /* debugTrace */ false,
            blueSide.map((entry) => entry.node),
            redSide.map((entry) => entry.node),
        );

        // The engine indexes fighters by their position in the squad array,
        // which IS the tactical job — map back to roster slots through formation.
        const blueExit = exitFractions(result, "player");
        const redExit = exitFractions(result, "enemy");

        const finish = (
            side: ReturnType<typeof buildSide>,
            exits: Map<number, number>,
            hp: Map<number, number>,
        ): RiteCombatant[] => side.map((entry, lane) => {
            const localExitRatio = exits.get(lane) ?? 0;
            // The duel actor's maxHp was already scaled by entryHp, so its
            // exit ratio is local to this clash. Convert it exactly once back
            // to roster-base health before any carry, report, or verdict reads
            // it. The survivor floor belongs only to its next entry; exitHp
            // remains the exact health shown by the final HUD and verdict.
            const exitHp = entry.entryHp * localExitRatio;
            hp.set(entry.slot, exitHp > 0 ? Math.max(RITE_MIN_ENTRY_HP, exitHp) : 0);
            return {
                slot: entry.slot,
                petId: String(entry.pet.id),
                lane,
                node: entry.node,
                entryHp: entry.entryHp,
                exitHp,
                bond: entry.bond,
            };
        });

        const blue = finish(blueSide, blueExit, blueHp);
        const red = finish(redSide, redExit, redHp);
        const blueStanding = blue.filter((c) => c.exitHp > 0).length;
        const redStanding = red.filter((c) => c.exitHp > 0).length;

        // Formation combat is settled by bodies standing, then remaining health.
        const blueHealth = blue.reduce((sum, c) => sum + c.exitHp, 0);
        const redHealth = red.reduce((sum, c) => sum + c.exitHp, 0);
        const winner: RiteSide | null = blueStanding !== redStanding
                ? (blueStanding > redStanding ? "blue" : "red")
                : Math.abs(blueHealth - redHealth) > 1e-9
                    ? (blueHealth > redHealth ? "blue" : "red")
                    : null;
        const finishKind: RiteClash["finish"] = blueStanding === 0 || redStanding === 0 ? "wipe" : "survival";

        if (winner === "blue") blueRounds++;
        else if (winner === "red") redRounds++;

        // ⛔ A `ko` event names the pet that FELL, not the pet that felled it:
        // the engine emits `{ side: f.team, actorId: f.id }` for the dying
        // fighter. Reading `actorId` as the killer therefore looked for
        // "player-<lane>" among ids that are always "enemy-<lane>", matched
        // nothing, and left the MVP permanently unawarded (measured: 0 of 25
        // matches, against 155 enemy KOs). Credit the last blue fighter to land
        // a hit on that pet instead — `hit` carries attacker in `actorId` and
        // victim in `targetId`, and events arrive in time order.
        const lastBlueToHit = new Map<string, string>();
        for (const event of result.events) {
            if (event.type === "hit" && event.side === "player" && event.targetId) {
                lastBlueToHit.set(String(event.targetId), String(event.actorId));
                continue;
            }
            if (event.type !== "ko" || event.side !== "enemy") continue;
            const killerId = lastBlueToHit.get(String(event.actorId));
            const actor = killerId ? blue.find((c) => `player-${c.lane}` === killerId) : undefined;
            if (actor) blueKos.set(actor.slot, (blueKos.get(actor.slot) ?? 0) + 1);
        }

        totalTicks += result.ticks;
        clashes.push({
            index, seed: thisSeed, blue, red,
            blueReserveSlot: blueFormation.length > RITE_ACTIVE_SIZE ? blueFormation[RITE_ACTIVE_SIZE] : -1,
            redReserveSlot: redFormation.length > RITE_ACTIVE_SIZE ? redFormation[RITE_ACTIVE_SIZE] : -1,
            blueStanding, redStanding, finish: finishKind,
            captureCarrierSlot: null,
            winner,
            ticks: result.ticks, seconds: result.ticks / DUEL_TPS, result,
        });

        if (blueRounds >= RITE_CLASHES_TO_WIN || redRounds >= RITE_CLASHES_TO_WIN) break;

        // Regroup. EVERYONE recovers a share of what they lost — the fallen from
        // RITE_DOWNED_RETURN_HP, survivors from whatever they held — and the
        // beaten side recovers more.
        //
        // Excluding the fallen from this was tried and MEASURED: it pushed 2-0
        // sweeps from 54% to 88% and cut comebacks to 8.3%, because a side that
        // lost two or three pets then walked into the next clash with them stuck
        // at 45% against a near-whole opponent. The compression this creates is
        // not a side effect — it IS the mechanism that keeps a best-of-three
        // live. A clash therefore starts near-fresh, and the wound a band carries
        // is a real edge rather than a sentence.
        const regroup = (hp: Map<number, number>, side: RiteSide) => {
            const share = winner === null ? RITE_REGROUP : winner === side ? RITE_REGROUP : RITE_LOSER_REGROUP;
            for (const [slot, value] of hp) {
                const base = value > 0 ? value : RITE_DOWNED_RETURN_HP;
                hp.set(slot, Math.min(1, base + (1 - base) * share));
            }
        };
        regroup(blueHp, "blue");
        regroup(redHp, "red");

        // Freeze both AI answers from the public clash BEFORE either side's
        // next sealed layout is applied. The counter helper cannot receive an
        // unsealed formation, and computing these together makes that fairness
        // boundary explicit rather than an incidental call order.
        const blueAiCounter = blueUsesAiPlan ? deterministicRiteCounterMove(clashes[index], "blue") : null;
        const redAiCounter = redUsesAiPlan ? deterministicRiteCounterMove(clashes[index], "red") : null;

        // Re-form between clashes from the ordered decision transcript. Both
        // seats use the same path so a PvP/shared replay cannot gain a side-only
        // simulation rule. Legacy one-reform receipts resolve through the same
        // helper and remain byte-identical.
        const blueReform = riteReformAfter(bluePlan, index);
        if (blueReform) {
            blueFormation = [...blueReform.formation];
            blueDeployment = [...blueReform.deployment];
        } else if (blueAiCounter) {
            blueFormation = [...blueAiCounter.formation];
            blueDeployment = [...blueAiCounter.deployment];
        }
        const redReform = riteReformAfter(redPlan, index);
        if (redReform) {
            redFormation = [...redReform.formation];
            redDeployment = [...redReform.deployment];
        } else if (redAiCounter) {
            redFormation = [...redAiCounter.formation];
            redDeployment = [...redAiCounter.deployment];
        }
    }

    const winner: RiteSide | null = blueRounds === redRounds ? null : blueRounds > redRounds ? "blue" : "red";

    let mvpSlot: number | null = null;
    let mvpKos = 0;
    for (const [slot, kos] of blueKos) {
        if (kos > mvpKos) { mvpKos = kos; mvpSlot = slot; }
    }
    const mvpPetId = mvpSlot === null ? null : String(blueBand[mvpSlot]?.id ?? "");

    return {
        winner, clashes, blueRounds, redRounds, mvpSlot, mvpPetId,
        seed, totalTicks, totalSeconds: totalTicks / DUEL_TPS,
        bluePlan, redPlan,
    };
}

/** Settlement view — everything the server needs to pay, with the per-clash
 *  snapshot streams (megabytes of them) dropped. */
export interface RiteVerdict {
    winner: RiteSide | null;
    blueRounds: number;
    redRounds: number;
    clashCount: number;
    totalSeconds: number;
    mvpSlot: number | null;
}

export function riteVerdict(result: RiteResult): RiteVerdict {
    return {
        winner: result.winner,
        blueRounds: result.blueRounds,
        redRounds: result.redRounds,
        clashCount: result.clashes.length,
        totalSeconds: result.totalSeconds,
        mvpSlot: result.mvpSlot,
    };
}
