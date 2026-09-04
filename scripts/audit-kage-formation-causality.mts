import assert from "node:assert/strict";
import type { Pet } from "../shinobij.client/src/types/pet";
import {
    DUEL_TPS,
    type DuelActorSnap,
    type DuelEvent,
    type DuelResult,
    type DuelSnapshot,
} from "../shinobij.client/src/lib/pet-duel-sim";
import {
    WARFRONT_CELL_X,
    WARFRONT_CELL_Y,
    petCinematicArchetype,
    runPetSquadDuelCinematic,
} from "../shinobij.client/src/lib/pet-duel-cinematic";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import {
    RITE_SQUAD_HP_SCALE,
    runWarfrontRite,
    type RitePlan,
} from "../shinobij.client/src/lib/pet-warfront-rite";
import { RITE_WORLD_SCALE } from "../shinobij.client/src/lib/pet-warfront-rite-presentation";

const POOL: Pet[] = rawPetPool
    .filter((entry) => entry.rarity !== "mythic")
    .map((entry) => balanceBuiltInPetTemplate(entry));
const band = (seed: number, prefix: string): Pet[] => {
    const picked: Pet[] = [];
    for (let index = 0; picked.length < 4 && index < POOL.length * 2; index++) {
        const candidate = POOL[(seed * 31 + index * 17) % POOL.length];
        if (!picked.some((entry) => entry.id === candidate.id)) picked.push(candidate);
    }
    // runWarfrontRite applies this at clash entry. The direct simulator call is
    // intentional for a clean one-variable placement pair, so mirror that live
    // pacing contract here rather than auditing an unshipped 1.0x HP duel.
    return picked.map((entry, slot) => ({
        ...entry,
        id: `${prefix}-${entry.id}-${slot}`,
        hp: Math.max(1, Math.round((entry.hp || 1) * RITE_SQUAD_HP_SCALE)),
    }));
};

const PAIRED_BASE = [3, 4, 7, 8] as const;
// The live default has these two occupied cells touching diagonally. Swapping
// slots zero and one moves each creature by exactly one Chebyshev board cell.
const PAIRED_SWAP = [4, 3, 7, 8] as const;

const attackTell = (event: DuelEvent) => (
    event.targetId
    && (event.type === "windup" || event.type === "cast" || event.type === "ultimate" || event.type === "hit")
);

const openingSignature = (result: DuelResult): string => {
    const firstTellByActor = new Map<string, DuelEvent>();
    for (const event of result.events) {
        if (!attackTell(event) || firstTellByActor.has(event.actorId)) continue;
        firstTellByActor.set(event.actorId, event);
    }
    const tells = [...firstTellByActor.values()]
        .sort((a, b) => a.t - b.t || a.actorId.localeCompare(b.actorId))
        .slice(0, 4)
        .map((event) => `${event.actorId}>${event.targetId}@${event.t}`);
    const contact = result.events.find((event) => event.type === "hit");
    return `${tells.join("|")}#${contact?.actorId ?? "none"}>${contact?.targetId ?? "none"}@${contact?.t ?? -1}`;
};

const cellOf = (actor: DuelActorSnap): string => `${Math.round(actor.x / WARFRONT_CELL_X)},${Math.round(actor.y / WARFRONT_CELL_Y)}`;

const deadTargetAttacks = (result: DuelResult): number => {
    const deadAt = new Map<string, number>();
    for (const event of result.events) if (event.type === "ko") deadAt.set(event.actorId, event.t);
    return result.events.filter((event) => {
        if (!attackTell(event)) return false;
        const deathTick = deadAt.get(String(event.targetId));
        return deathTick != null && event.t > deathTick;
    }).length;
};

const movementOscillations = (result: DuelResult): number => {
    let found = 0;
    const actorIds = result.snapshots[0]?.actors.map((actor) => actor.id) ?? [];
    for (const actorId of actorIds) {
        const compressed: string[] = [];
        for (const snapshot of result.snapshots) {
            const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
            if (!actor || actor.hp <= 0 || actor.state === "dash") continue;
            const cell = cellOf(actor);
            if (compressed.at(-1) !== cell) compressed.push(cell);
        }
        for (let index = 0; index + 5 < compressed.length; index++) {
            const [a, b, c, d, e, f] = compressed.slice(index, index + 6);
            if (a === c && c === e && b === d && d === f && a !== b) { found++; break; }
        }
    }
    return found;
};

/** Count actors whose published live target sequence contains the literal
 * A-B-A-B-A-B failure. Null handoff frames are ignored so clearing targetId for
 * one tick cannot hide tactical indecision from the gate. */
const targetOscillations = (result: DuelResult): Array<{ actorId: string; sequence: string[] }> => {
    const found: Array<{ actorId: string; sequence: string[] }> = [];
    const actorIds = result.snapshots[0]?.actors.map((actor) => actor.id) ?? [];
    for (const actorId of actorIds) {
        const compressed: string[] = [];
        for (const snapshot of result.snapshots) {
            const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
            if (!actor || actor.hp <= 0 || !actor.targetId) continue;
            if (compressed.at(-1) !== actor.targetId) compressed.push(actor.targetId);
        }
        for (let index = 0; index + 5 < compressed.length; index++) {
            const [a, b, c, d, e, f] = compressed.slice(index, index + 6);
            if (a === c && c === e && b === d && d === f && a !== b) {
                found.push({ actorId, sequence: compressed });
                break;
            }
        }
    }
    return found;
};

const outOfRangeIdleTicks = (result: DuelResult, roles: ReadonlyMap<string, "melee" | "ranged">): { ticks: number; actorId: string | null } => {
    const runByActor = new Map<string, number>();
    let longest = 0, actorId: string | null = null;
    for (const snapshot of result.snapshots) {
        const aliveById = new Map(snapshot.actors.filter((actor) => actor.hp > 0).map((actor) => [actor.id, actor]));
        for (const actor of snapshot.actors) {
            const target = actor.targetId ? aliveById.get(actor.targetId) : undefined;
            const range = target
                ? Math.max(Math.abs(actor.x - target.x) / WARFRONT_CELL_X, Math.abs(actor.y - target.y) / WARFRONT_CELL_Y)
                : 0;
            const reach = roles.get(actor.id) === "ranged" ? 3.05 : 1.05;
            const stranded = actor.hp > 0 && actor.state === "idle" && Boolean(target) && range > reach;
            const run = stranded ? (runByActor.get(actor.id) ?? 0) + 1 : 0;
            runByActor.set(actor.id, run);
            if (run > longest) { longest = run; actorId = actor.id; }
        }
    }
    return { ticks: longest, actorId };
};

const routeSignature = (result: DuelResult): string => {
    const parts: string[] = [];
    const prior = new Map<string, string>();
    for (const snapshot of result.snapshots) {
        for (const actor of snapshot.actors) {
            if (actor.hp <= 0 || actor.state === "dash") continue;
            const cell = cellOf(actor);
            if (prior.get(actor.id) === cell) continue;
            prior.set(actor.id, cell);
            if (parts.length < 18) parts.push(`${actor.id}:${cell}`);
        }
        if (parts.length >= 18) break;
    }
    return parts.join("|");
};

const roleMap = (blue: readonly Pet[], red: readonly Pet[]): Map<string, "melee" | "ranged"> => {
    const result = new Map<string, "melee" | "ranged">();
    const add = (side: "player" | "enemy", roster: readonly Pet[]) => roster.forEach((entry, slot) => {
        const archetype = petCinematicArchetype(entry);
        const ranged = entry.role === "sage" || entry.subRole === "support" || entry.subRole === "kite"
            || archetype === "support" || archetype === "kiter";
        result.set(`${side}-${slot}`, ranged ? "ranged" : "melee");
    });
    add("player", blue); add("enemy", red);
    return result;
};

type OpeningShape = "front" | "rear" | "lateral";
type OpeningShapeAudit = {
    shape: OpeningShape;
    seed: number;
    samples: number;
    frontContactRun: number;
    playerCrossCoverRun: number;
    enemyCrossCoverRun: number;
    playerOutsideRun: number;
    enemyOutsideRun: number;
    playerFlankThreatRun: number;
    enemyFlankThreatRun: number;
    bothHalvesSamples: number;
    pileFreeFraction: number;
};

const openingCell = (actor: DuelActorSnap) => ({
    col: actor.x / WARFRONT_CELL_X + 3,
    row: actor.y / WARFRONT_CELL_Y + 2,
});
const openingRange = (a: DuelActorSnap, b: DuelActorSnap) => {
    const ac = openingCell(a), bc = openingCell(b);
    return Math.max(Math.abs(ac.col - bc.col), Math.abs(ac.row - bc.row));
};
const longestRun = (samples: readonly boolean[]): number => {
    let longest = 0, current = 0;
    for (const sample of samples) {
        current = sample ? current + 1 : 0;
        longest = Math.max(longest, current);
    }
    return longest;
};
const openingActor = (snapshot: DuelSnapshot, team: "player" | "enemy", slot: number) =>
    snapshot.actors.find((actor) => actor.team === team && actor.slot === slot);

/** A visual pile is a connected overlap component, not merely three actors in
 * adjacent board cells. The stage maps simulation space through WORLD_SCALE;
 * these fixtures normalize to 1.7 world units tall, whose conservative body
 * radius is 65% of that height. */
const hasThreeModelPile = (snapshot: DuelSnapshot): boolean => {
    const live = snapshot.actors.filter((actor) => actor.hp > 0);
    const visualRadius = 1.7 * 0.65;
    const neighbors = live.map(() => [] as number[]);
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
        const dx = (live[a].x - live[b].x) * RITE_WORLD_SCALE;
        const dy = (live[a].y - live[b].y) * RITE_WORLD_SCALE;
        if (Math.hypot(dx, dy) <= visualRadius * 2) {
            neighbors[a].push(b); neighbors[b].push(a);
        }
    }
    const seen = new Set<number>();
    for (let start = 0; start < live.length; start++) {
        if (seen.has(start)) continue;
        const pending = [start]; seen.add(start);
        let size = 0;
        while (pending.length) {
            const index = pending.pop()!; size++;
            for (const neighbor of neighbors[index]) if (!seen.has(neighbor)) {
                seen.add(neighbor); pending.push(neighbor);
            }
        }
        if (size >= 3) return true;
    }
    return false;
};

const auditOpeningShape = (shape: OpeningShape, seed: number, result: DuelResult): OpeningShapeAudit => {
    const snapshots = result.snapshots.slice(0, DUEL_TPS * 6 + 1);
    const frontContact: boolean[] = [];
    const crossCover = { player: [] as boolean[], enemy: [] as boolean[] };
    const outside = { player: [] as boolean[], enemy: [] as boolean[] };
    const flankThreat = { player: [] as boolean[], enemy: [] as boolean[] };
    let bothHalvesSamples = 0;
    let pileFreeSamples = 0;
    for (const snapshot of snapshots) {
        const liveById = new Map(snapshot.actors.filter((actor) => actor.hp > 0).map((actor) => [actor.id, actor]));
        const playerFront = openingActor(snapshot, "player", 0);
        const enemyFront = openingActor(snapshot, "enemy", 0);
        frontContact.push(Boolean(playerFront?.hp && enemyFront?.hp
            && playerFront.targetId === enemyFront.id && enemyFront.targetId === playerFront.id
            && openingRange(playerFront, enemyFront) <= 1.25));

        for (const team of ["player", "enemy"] as const) {
            const direction = team === "player" ? 1 : -1;
            const screen = [openingActor(snapshot, team, 0), openingActor(snapshot, team, 2)]
                .filter((actor): actor is DuelActorSnap => Boolean(actor?.hp));
            const firingRank = [openingActor(snapshot, team, 1), openingActor(snapshot, team, 3)]
                .filter((actor): actor is DuelActorSnap => Boolean(actor?.hp));
            const covered = firingRank.some((rear) => {
                const target = rear.targetId ? liveById.get(rear.targetId) : undefined;
                if (!target) return false;
                const rearCell = openingCell(rear), targetRange = openingRange(rear, target);
                return screen.some((front) => {
                    const frontCell = openingCell(front);
                    return front.targetId === rear.targetId
                        && direction * (frontCell.col - rearCell.col) >= 0.45
                        && Math.abs(frontCell.row - rearCell.row) >= 0.55
                        && Math.abs(frontCell.row - rearCell.row) <= 2.25
                        && targetRange >= 1.45 && targetRange <= 3.25;
                });
            });
            crossCover[team].push(covered);

            const shadow = openingActor(snapshot, team, 2);
            const shadowTarget = shadow?.targetId ? liveById.get(shadow.targetId) : undefined;
            const shadowCell = shadow ? openingCell(shadow) : null;
            const targetCell = shadowTarget ? openingCell(shadowTarget) : null;
            const targetsBackline = shadowTarget?.slot === 1 || shadowTarget?.slot === 3;
            const isOutside = Boolean(shadow?.hp && shadowTarget && targetsBackline && shadowCell
                && (shadowCell.row <= 0.65 || shadowCell.row >= 3.35));
            outside[team].push(isOutside);
            flankThreat[team].push(Boolean(isOutside && targetCell && shadowCell
                // Crossing the near edge of midfield while keeping a real
                // backliner selected is a visible flank threat; requiring the
                // shadow to stand directly behind that body would turn this
                // into another mirrored one-on-one socket.
                && direction * (shadowCell.col - 3) >= -1));
        }

        let northActive = false, southActive = false;
        for (const actor of snapshot.actors) {
            const target = actor.hp > 0 && actor.targetId ? liveById.get(actor.targetId) : undefined;
            if (!target || openingRange(actor, target) > 3.25) continue;
            const midpointRow = (openingCell(actor).row + openingCell(target).row) / 2;
            if (midpointRow <= 1.75) northActive = true;
            if (midpointRow >= 2.25) southActive = true;
        }
        if (northActive && southActive) bothHalvesSamples++;
        if (!hasThreeModelPile(snapshot)) pileFreeSamples++;
    }
    return {
        shape,
        seed,
        samples: snapshots.length,
        frontContactRun: longestRun(frontContact),
        playerCrossCoverRun: longestRun(crossCover.player),
        enemyCrossCoverRun: longestRun(crossCover.enemy),
        playerOutsideRun: longestRun(outside.player),
        enemyOutsideRun: longestRun(outside.enemy),
        playerFlankThreatRun: longestRun(flankThreat.player),
        enemyFlankThreatRun: longestRun(flankThreat.enemy),
        bothHalvesSamples,
        pileFreeFraction: snapshots.length ? pileFreeSamples / snapshots.length : 0,
    };
};

const REPRESENTATIVE_IDS = ["standard-0", "standard-1", "standard-2", "standard-3"] as const;
const representativeBand = () => REPRESENTATIVE_IDS.map((id) => {
    const pet = POOL.find((candidate) => candidate.id === id);
    assert.ok(pet, `missing representative pet ${id}`);
    return { ...pet };
});
const OPENING_DEPLOYMENTS: Readonly<Record<OpeningShape, readonly number[]>> = {
    front: [5, 2, 9, 6],
    rear: [4, 2, 8, 6],
    lateral: [3, 4, 9, 0],
};
const OPENING_SEEDS = [7, 19, 43, 97, 211, 509, 1021, 4093] as const;
const openingPlan = (deployment: readonly number[]): RitePlan => ({
    formation: [0, 1, 2, 3],
    deployment: [...deployment],
    reformAfterClash: null,
    reform: null,
    reformDeployment: null,
});

const runOpeningShapeAudit = (): OpeningShapeAudit[] => {
    const blue = representativeBand(), red = representativeBand();
    const enemyPlan = openingPlan(OPENING_DEPLOYMENTS.front);
    const audits: OpeningShapeAudit[] = [];
    for (const shape of Object.keys(OPENING_DEPLOYMENTS) as OpeningShape[]) for (const seed of OPENING_SEEDS) {
        const rite = runWarfrontRite(blue, red, seed, openingPlan(OPENING_DEPLOYMENTS[shape]), enemyPlan);
        const clash = rite.clashes[0];
        assert.ok(clash, `${shape}/${seed} did not produce an opening clash`);
        audits.push(auditOpeningShape(shape, seed, clash.result));
    }
    return audits;
};

export function runKageFormationCausalityHarness() {
    let openingChanges = 0;
    let winnerReversals = 0;
    let deadTargetAttackCount = 0;
    let movementOscillationCount = 0;
    let targetOscillationCount = 0;
    const targetOscillationExamples: string[] = [];
    let worstStrandedTicks = 0;
    let worstStrandedExample: string | null = null;
    const durations: number[] = [];

    for (let index = 0; index < 20; index++) {
        const seed = index + 1;
        const blue = band(seed, "blue");
        const red = blue.map((entry, slot) => ({ ...entry, id: `red-${entry.id}-${slot}` }));
        const base = runPetSquadDuelCinematic(blue, red, seed, false, true, false, PAIRED_BASE, PAIRED_BASE);
        const swap = runPetSquadDuelCinematic(blue, red, seed, false, true, false, PAIRED_SWAP, PAIRED_BASE);
        if (openingSignature(base) !== openingSignature(swap)) openingChanges++;
        if (base.winner && swap.winner && base.winner !== swap.winner) winnerReversals++;
        for (const [variant, result] of [["base", base], ["swap", swap]] as const) {
            deadTargetAttackCount += deadTargetAttacks(result);
            movementOscillationCount += movementOscillations(result);
            const targetLoops = targetOscillations(result);
            targetOscillationCount += targetLoops.length;
            for (const loop of targetLoops) {
                targetOscillationExamples.push(`seed=${seed}/${variant}/${loop.actorId}:${loop.sequence.join(">")}`);
            }
            const stranded = outOfRangeIdleTicks(result, roleMap(blue, red));
            if (stranded.ticks > worstStrandedTicks) {
                worstStrandedTicks = stranded.ticks;
                worstStrandedExample = `seed=${seed}/${variant}/${stranded.actorId ?? "unknown"}`;
            }
            durations.push(result.ticks / DUEL_TPS);
        }
    }

    durations.sort((a, b) => a - b);
    const medianSeconds = (durations[19] + durations[20]) / 2;
    const blue = band(424242, "shape-blue");
    const red = blue.map((entry, slot) => ({ ...entry, id: `shape-red-${entry.id}-${slot}` }));
    const engagementPlans = {
        front: runPetSquadDuelCinematic(blue, red, 424242, false, true, false, [1, 3, 5, 7], [1, 3, 5, 7]),
        rear: runPetSquadDuelCinematic(blue, red, 424242, false, true, false, [0, 2, 4, 6], [1, 3, 5, 7]),
        lateral: runPetSquadDuelCinematic(blue, red, 424242, false, true, false, [1, 5, 7, 9], [1, 3, 5, 7]),
    };
    const distinctEngagements = new Set(Object.values(engagementPlans).map((result) => `${openingSignature(result)}#${routeSignature(result)}`)).size;
    const openingAudits = runOpeningShapeAudit();
    const openingGeometry = Object.fromEntries((Object.keys(OPENING_DEPLOYMENTS) as OpeningShape[]).map((shape) => {
        const audits = openingAudits.filter((audit) => audit.shape === shape);
        return [shape, {
            runs: audits.length,
            minSamples: Math.min(...audits.map((audit) => audit.samples)),
            minFrontContactRun: Math.min(...audits.map((audit) => audit.frontContactRun)),
            minCrossCoverRun: Math.min(...audits.flatMap((audit) => [audit.playerCrossCoverRun, audit.enemyCrossCoverRun])),
            minOutsideRun: Math.min(...audits.flatMap((audit) => [audit.playerOutsideRun, audit.enemyOutsideRun])),
            minFlankThreatRun: Math.min(...audits.flatMap((audit) => [audit.playerFlankThreatRun, audit.enemyFlankThreatRun])),
            minBothHalvesSamples: Math.min(...audits.map((audit) => audit.bothHalvesSamples)),
            minPileFreePercent: Number((Math.min(...audits.map((audit) => audit.pileFreeFraction)) * 100).toFixed(1)),
        }];
    }));
    const openingGeometryFailures = openingAudits.filter((audit) => audit.samples < DUEL_TPS * 6 + 1
        || audit.frontContactRun < DUEL_TPS * 2
        || audit.playerCrossCoverRun < DUEL_TPS || audit.enemyCrossCoverRun < DUEL_TPS
        || audit.playerOutsideRun < DUEL_TPS || audit.enemyOutsideRun < DUEL_TPS
        || audit.playerFlankThreatRun < DUEL_TPS || audit.enemyFlankThreatRun < DUEL_TPS
        || audit.bothHalvesSamples < 90
        || audit.pileFreeFraction < 0.8);

    return {
        pairedMatches: 20,
        openingChanges,
        winnerReversals,
        deadTargetAttackCount,
        movementOscillationCount,
        targetOscillationCount,
        targetOscillationExamples,
        worstStrandedTicks,
        worstStrandedMs: Math.round(worstStrandedTicks / DUEL_TPS * 1000),
        worstStrandedExample,
        medianSeconds,
        distinctEngagements,
        openingGeometry,
        openingGeometryFailures,
    };
}

const report = runKageFormationCausalityHarness();
console.log(JSON.stringify(report, null, 2));
assert.ok(report.openingChanges >= 16, `formation opening changed ${report.openingChanges}/20; required >=16/20`);
assert.ok(report.winnerReversals >= 5, `formation reversed ${report.winnerReversals}/20 winners; required >=5/20`);
assert.equal(report.deadTargetAttackCount, 0, "an attack tell targeted an already-dead actor");
assert.equal(report.movementOscillationCount, 0, "an actor entered a permanent two-cell movement oscillation");
assert.equal(report.targetOscillationCount, 0, "an actor published a literal A-B-A-B-A-B target loop");
assert.ok(report.worstStrandedTicks <= DUEL_TPS / 2, `an actor was stranded for ${report.worstStrandedMs}ms`);
assert.ok(report.medianSeconds >= 12 && report.medianSeconds <= 25, `median clash was ${report.medianSeconds.toFixed(2)}s; required 12-25s`);
assert.equal(report.distinctEngagements, 3, "front, rear and lateral plans did not produce three different engagements");
assert.equal(report.openingGeometryFailures.length, 0,
    `opening role geometry failed: ${JSON.stringify(report.openingGeometryFailures, null, 2)}`);
