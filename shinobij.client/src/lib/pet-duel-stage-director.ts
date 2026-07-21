/*
 * Render-only stage manager for Pet Coliseum replays.
 *
 * The combat simulation remains the truth for damage, cooldowns, statuses and
 * the winner.  This module gives that truth a deliberately staged performance:
 * one fighter owns pressure, the other reads/reacts, and every exchange ends on
 * a new arena mark.  It prevents the visually weak failure mode produced by two
 * independent steering agents: one pet walks away while the other follows at a
 * nearly constant distance.
 */
import {
    ARENA_X,
    ARENA_Y,
    DUEL_TPS,
    type DuelActorSnap,
    type DuelEvent,
    type DuelResult,
    type DuelState,
} from "./pet-duel-sim";

type Team = "player" | "enemy";
type Point = { x: number; y: number };
type MotionSegment = {
    start: number;
    end: number;
    from: Point;
    to: Point;
    state: DuelState;
    priority: number;
};
type StateWindow = { start: number; end: number; state: DuelState; priority: number };
type Track = {
    id: string;
    team: Team;
    start: Point;
    segments: MotionSegment[];
    states: StateWindow[];
    markIndex: number;
};

const MOVE_TICKS = Math.round(DUEL_TPS * 0.52);
const EXIT_TICKS = Math.round(DUEL_TPS * 0.58);
const RECOIL_TICKS = Math.round(DUEL_TPS * 0.34);
const DODGE_TICKS = Math.round(DUEL_TPS * 0.44);
const RECOVERY_TICKS = Math.round(DUEL_TPS * 0.3);
const WINDUP_LOOKAHEAD = Math.round(DUEL_TPS * 1.35);
// Melee travel begins well before contact. At the old 0.25-0.30 s lead, even a
// continuous route crossed the screen in too few rendered poses and therefore
// read as a teleport. Contact timing and combat truth remain unchanged.
const MELEE_DASH_LEAD = Math.round(DUEL_TPS * 0.44);
const MELEE_FALLBACK_LEAD = Math.round(DUEL_TPS * 0.4);
// At 30 simulation ticks per second this is still a very fast anime burst, but
// it remains a visible crossing rather than covering half the arena in one frame.
// Leave enough authored samples for feet, turns and elemental wakes to read at
// 30 fps. Long routes begin earlier; their contact tick and combat truth stay
// unchanged.
const MAX_STAGE_STEP = 0.64;
const EPS = 1 / 256;

// Marks deliberately vary both range and depth.  Keeping each team on a stable
// screen side preserves match readability; the deep flanks and near pockets make
// the arena feel spatial without spinning the combatants around one another.
const PLAYER_MARKS: readonly Point[] = [
    { x: -8.7, y: -1.5 },
    { x: -5.0, y: 4.8 },
    { x: -10.1, y: 2.1 },
    { x: -3.8, y: -5.0 },
    { x: -8.0, y: -4.4 },
    { x: -2.2, y: 3.2 },
];
const ENEMY_MARKS: readonly Point[] = [
    { x: 8.7, y: 1.5 },
    { x: 5.0, y: -4.8 },
    { x: 10.1, y: -2.1 },
    { x: 3.8, y: 5.0 },
    { x: 8.0, y: 4.4 },
    { x: 2.2, y: -3.2 },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const ease = (t: number) => {
    const p = clamp(t, 0, 1);
    return p * p * (3 - 2 * p);
};
const copyPoint = (point: Point): Point => ({ x: point.x, y: point.y });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (x: number, y: number): Point => {
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
};
const keepOnFloor = (point: Point): Point => ({
    x: clamp(point.x, -ARENA_X + 0.8, ARENA_X - 0.8),
    y: clamp(point.y, -ARENA_Y + 0.65, ARENA_Y - 0.65),
});

function trackPosition(track: Track, tick: number): Point {
    let point = track.start;
    for (const segment of track.segments) {
        if (tick < segment.start) break;
        if (tick >= segment.end) {
            point = segment.to;
            continue;
        }
        const p = ease((tick - segment.start) / Math.max(1, segment.end - segment.start));
        return {
            x: segment.from.x + (segment.to.x - segment.from.x) * p,
            y: segment.from.y + (segment.to.y - segment.from.y) * p,
        };
    }
    return copyPoint(point);
}
function stateAt(track: Track, tick: number): DuelState {
    let selected: StateWindow | undefined;
    for (const window of track.states) {
        if (tick < window.start || tick > window.end) continue;
        if (!selected || window.priority > selected.priority) selected = window;
    }
    return selected?.state ?? "idle";
}

function addState(track: Track, start: number, end: number, state: DuelState, priority: number) {
    track.states.push({ start: Math.max(0, start), end: Math.max(start, end), state, priority });
}

function pointOnSegment(segment: MotionSegment, tick: number): Point {
    const p = ease((tick - segment.start) / Math.max(1, segment.end - segment.start));
    return {
        x: segment.from.x + (segment.to.x - segment.from.x) * p,
        y: segment.from.y + (segment.to.y - segment.from.y) * p,
    };
}

/**
 * Motion segments are a single edit list, not animation layers. Keeping them
 * disjoint is important: trackPosition deliberately evaluates one segment at a
 * time, so an overlap would make the actor jump between unrelated `from` marks.
 * Re-link every segment after an edit so gaps hold the preceding destination and
 * the next move always launches from the pet's visible position.
 */
function normalizeTrack(track: Track) {
    track.segments.sort((a, b) => a.start - b.start || b.priority - a.priority);
    let point = copyPoint(track.start);
    let previousEnd = -1;
    for (const segment of track.segments) {
        if (segment.start < previousEnd) {
            throw new Error(`Overlapping stage motion for ${track.id} at tick ${segment.start}`);
        }
        segment.from = copyPoint(point);
        point = copyPoint(segment.to);
        previousEnd = segment.end;
    }
}

/**
 * A later high-priority beat can re-link an earlier segment from a new launch
 * mark. Its original duration then may no longer be long enough for the new
 * distance, even though addMove validated it when it was first authored. Run a
 * final reachability pass after the complete event list is known so those late
 * edits cannot reintroduce a one-tick snap.
 */
function capFinalTrackVelocity(track: Track) {
    normalizeTrack(track);
    let point = copyPoint(track.start);
    for (const segment of track.segments) {
        segment.from = copyPoint(point);
        const ticks = Math.max(1, segment.end - segment.start);
        const routeDistance = distance(segment.from, segment.to);
        const reachableDistance = ticks * MAX_STAGE_STEP / 1.6;
        if (routeDistance > reachableDistance) {
            const direction = norm(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
            segment.to = keepOnFloor({
                x: segment.from.x + direction.x * reachableDistance,
                y: segment.from.y + direction.y * reachableDistance,
            });
        }
        point = copyPoint(segment.to);
    }
}

function addMove(track: Track, start: number, end: number, to: Point, state: DuelState, priority: number) {
    const requestedStart = Math.max(0, Math.round(start));
    const safeEnd = Math.max(requestedStart + 1, Math.round(end));
    const target = keepOnFloor(to);
    let safeStart = requestedStart;
    // Smoothstep peaks at 1.5x its average velocity. Pull a long traversal's
    // launch earlier (never its contact later) until the fastest authored tick is
    // within the visible burst-speed budget. Re-evaluate because an earlier tick
    // can sit on a different stage mark.
    for (let pass = 0; pass < 3; pass++) {
        const launch = trackPosition(track, safeStart);
        const minimumTicks = Math.ceil(distance(launch, target) * 1.6 / MAX_STAGE_STEP);
        const expandedStart = Math.max(0, Math.min(requestedStart, safeEnd - Math.max(1, minimumTicks)));
        if (expandedStart === safeStart) break;
        safeStart = expandedStart;
    }
    const from = trackPosition(track, safeStart);
    const overlaps = track.segments.filter((segment) => segment.end > safeStart && segment.start < safeEnd);
    // A planted dodge/contact route owns its time window. Quiet geography beats
    // are optional and must never be layered underneath a higher-priority move.
    if (overlaps.some((segment) => segment.priority > priority)) return;

    const retained: MotionSegment[] = [];
    for (const segment of track.segments) {
        if (segment.end <= safeStart || segment.start >= safeEnd) {
            retained.push(segment);
            continue;
        }
        // Preserve the already-visible portion of a route that is interrupted by
        // a more important beat. Its endpoint is exactly the new route's launch
        // point, which makes the handoff continuous on the interruption tick.
        if (segment.start < safeStart) {
            retained.push({
                ...segment,
                end: safeStart,
                to: pointOnSegment(segment, safeStart),
            });
        }
        // Do not resume the discarded tail after the authored beat. Resuming an
        // obsolete destination is what made pets reverse or snap after contact.
    }
    track.segments = retained;
    track.segments.push({ start: safeStart, end: safeEnd, from, to: target, state, priority });
    normalizeTrack(track);
    addState(track, safeStart, safeEnd, state, priority);
}

function nextMark(track: Track, salt = 0): Point {
    const marks = track.team === "player" ? PLAYER_MARKS : ENEMY_MARKS;
    track.markIndex = (track.markIndex + 1 + salt) % marks.length;
    return copyPoint(marks[track.markIndex]);
}

function breakawayMark(track: Track, from: Point, threat: Point): Point {
    const marks = track.team === "player" ? PLAYER_MARKS : ENEMY_MARKS;
    let selectedIndex = track.markIndex;
    let selectedScore = -Infinity;
    for (let index = 0; index < marks.length; index++) {
        const mark = marks[index];
        // Distance from the opponent is the dominant read; a smaller travel term
        // favors a decisive retreat over a tiny local shuffle. Avoid selecting the
        // current mark again even when it happens to be the geometric maximum.
        const travel = distance(from, mark);
        const score = distance(mark, threat) * 1.5 + travel * 0.24 + (index === track.markIndex ? -2.5 : 0);
        if (score > selectedScore) {
            selectedScore = score;
            selectedIndex = index;
        }
    }
    track.markIndex = selectedIndex;
    return copyPoint(marks[selectedIndex]);
}

function recoilPoint(from: Point, awayFrom: Point, side: number): Point {
    const away = norm(from.x - awayFrom.x, from.y - awayFrom.y);
    const lateral = { x: -away.y * side, y: away.x * side };
    return keepOnFloor({
        x: from.x + away.x * 2.1 + lateral.x * 1.25,
        y: from.y + away.y * 2.1 + lateral.y * 1.25,
    });
}

function dodgePoint(from: Point, threat: Point, side: number): Point {
    const toThreat = norm(threat.x - from.x, threat.y - from.y);
    return keepOnFloor({
        x: from.x - toThreat.y * side * 3.0 - toThreat.x * 0.5,
        y: from.y + toThreat.x * side * 3.0 - toThreat.y * 0.5,
    });
}

function contactPoint(attacker: Point, target: Point, gap: number): Point {
    const toward = norm(target.x - attacker.x, target.y - attacker.y);
    return keepOnFloor({ x: target.x - toward.x * gap, y: target.y - toward.y * gap });
}

function matchingResolution(events: readonly DuelEvent[], index: number): DuelEvent | undefined {
    const windup = events[index];
    for (let i = index + 1; i < events.length; i++) {
        const candidate = events[i];
        if (candidate.t - windup.t > WINDUP_LOOKAHEAD) break;
        if (candidate.actorId !== windup.actorId) continue;
        if (candidate.type === "hit" || candidate.type === "whiff" || candidate.type === "cast") return candidate;
    }
    return undefined;
}

function fighterIds(result: DuelResult): { player: string; enemy: string } | null {
    const first = result.snapshots[0];
    if (!first || first.actors.length !== 2) return null;
    const player = first.actors.find((actor) => actor.team === "player");
    const enemy = first.actors.find((actor) => actor.team === "enemy");
    return player && enemy ? { player: player.id, enemy: enemy.id } : null;
}

function buildTracks(result: DuelResult, ids: { player: string; enemy: string }): Map<string, Track> {
    const tracks = new Map<string, Track>([
        [ids.player, { id: ids.player, team: "player", start: copyPoint(PLAYER_MARKS[0]), segments: [], states: [], markIndex: 0 }],
        [ids.enemy, { id: ids.enemy, team: "enemy", start: copyPoint(ENEMY_MARKS[0]), segments: [], states: [], markIndex: 0 }],
    ]);
    const opponent = (id: string) => tracks.get(id === ids.player ? ids.enemy : ids.player)!;

    result.events.forEach((event, index) => {
        const actor = tracks.get(event.actorId);
        if (!actor) return;
        const foe = event.targetId ? tracks.get(event.targetId) ?? opponent(event.actorId) : opponent(event.actorId);
        const actorAt = trackPosition(actor, event.t);
        const foeAt = trackPosition(foe, event.t);
        const side = ((index + (actor.team === "player" ? 0 : 1)) % 2 === 0) ? 1 : -1;

        if (event.type === "maneuver") {
            // A traversal is an independent destination, never a move toward the
            // opponent's current coordinates.  The opponent plants and watches.
            const target = nextMark(actor, index % 3 === 0 ? 1 : 0);
            addMove(actor, event.t - 4, event.t + MOVE_TICKS, target, "dash", 22);
            addState(foe, event.t - 3, event.t + MOVE_TICKS, "idle", 12);
            return;
        }

        if (event.type === "dodge") {
            const target = dodgePoint(actorAt, foeAt, side);
            addMove(actor, event.t - Math.round(DODGE_TICKS * 0.45), event.t + DODGE_TICKS, target, "dodge", 60);
            addState(actor, event.t - 3, event.t + DODGE_TICKS, "dodge", 65);
            return;
        }

        if (event.type === "windup") {
            const resolve = matchingResolution(result.events, index);
            const resolveTick = resolve?.t ?? event.t + Math.round(DUEL_TPS * 0.55);
            addState(actor, event.t, Math.max(event.t + 5, resolveTick - 3), "windup", 45);
            addState(foe, event.t, Math.max(event.t + 4, resolveTick - 5), "idle", 18);
            if (resolve?.type === "hit" && !resolve.ranged) {
                const targetAtResolve = trackPosition(foe, resolveTick);
                addMove(actor, resolveTick - MELEE_DASH_LEAD, resolveTick, contactPoint(actorAt, targetAtResolve, 2.45), "dash", 52);
            }
            return;
        }

        if (event.type === "cast" && (event.kind === "buff" || event.kind === "haste" || event.kind === "heal" || event.kind === "barrier")) {
            // Setup is a distance break: sprint out, turn, then power up.  The
            // rival explicitly does not follow the retreating caster.
            const disengage = breakawayMark(actor, actorAt, foeAt);
            addMove(actor, event.t - MOVE_TICKS, event.t - 3, disengage, "dash", 38);
            addState(actor, event.t - 3, event.t + Math.round(DUEL_TPS * 0.55), "windup", 48);
            addState(foe, event.t - MOVE_TICKS, event.t + Math.round(DUEL_TPS * 0.45), "idle", 28);
            return;
        }

        if (event.type === "cast") {
            addState(actor, event.t - 5, event.t + 7, "windup", 44);
            addState(foe, event.t - 2, event.t + 5, "idle", 16);
            return;
        }

        if (event.type === "hit") {
            const hitActor = trackPosition(actor, event.t);
            const hitFoe = trackPosition(foe, event.t);
            if (!event.ranged && distance(hitActor, hitFoe) > 2.7) {
                addMove(actor, event.t - MELEE_FALLBACK_LEAD, event.t, contactPoint(hitActor, hitFoe, 2.35), "dash", 55);
            }
            addState(actor, event.t - 2, event.t + 4, "strike", 80);
            addState(actor, event.t + 5, event.t + 5 + RECOVERY_TICKS, "recover", 74);
            addState(foe, event.t, event.t + RECOIL_TICKS + 2, "stagger", 82);
            const impactAttacker = trackPosition(actor, event.t);
            const impactTarget = trackPosition(foe, event.t);
            addMove(foe, event.t, event.t + RECOIL_TICKS, recoilPoint(impactTarget, impactAttacker, side), "stagger", 72);
            // The attacker relinquishes the contact lane immediately.  A wide,
            // different mark makes the next exchange a fresh composition.
            const exitStart = event.t + 5 + RECOVERY_TICKS;
            addMove(actor, exitStart, exitStart + EXIT_TICKS, nextMark(actor), "idle", 34);
            return;
        }

        if (event.type === "whiff") {
            const attackFrom = trackPosition(actor, event.t - 5);
            const targetAt = trackPosition(foe, event.t);
            const through = norm(targetAt.x - attackFrom.x, targetAt.y - attackFrom.y);
            addMove(actor, event.t - 6, event.t + 3, {
                x: targetAt.x + through.x * 2.5,
                y: targetAt.y + through.y * 2.5,
            }, "dash", 58);
            addState(actor, event.t - 2, event.t + 5, "strike", 78);
            addState(actor, event.t + 5, event.t + 5 + RECOVERY_TICKS, "recover", 72);
            const exitStart = event.t + 5 + RECOVERY_TICKS;
            addMove(actor, exitStart, exitStart + EXIT_TICKS, nextMark(actor, 1), "idle", 36);
            return;
        }

        if (event.type === "buff" || event.type === "heal" || event.type === "shield") {
            addState(actor, event.t - 4, event.t + Math.round(DUEL_TPS * 0.55), "windup", 55);
            addState(foe, event.t - 2, event.t + Math.round(DUEL_TPS * 0.38), "idle", 24);
            return;
        }

        if (event.type === "ko") addState(actor, event.t, result.ticks + 1, "dead", 100);
    });

    // Give quiet stretches a short read -> burst -> plant phrase. One fighter
    // shows intent, crosses to a new lane, and settles while the rival holds the
    // eyeline. This fills cooldown air without inventing attacks or returning to
    // constant two-agent circling.
    let previousPrimary = 0;
    let initiative = ids.player;
    for (const event of result.events.filter((candidate) => candidate.type === "windup" || candidate.type === "cast" || candidate.type === "hit" || candidate.type === "whiff")) {
        const gap = event.t - previousPrimary;
        if (gap > DUEL_TPS * 1.25) {
            const mover = tracks.get(initiative)!;
            const watcher = opponent(initiative);
            const start = previousPrimary + Math.round(DUEL_TPS * 0.4);
            const end = Math.min(event.t - Math.round(DUEL_TPS * 0.3), start + Math.round(DUEL_TPS * 0.42));
            if (end > start + 3) {
                addState(mover, start - Math.round(DUEL_TPS * 0.16), start - 1, "windup", 17);
                // Locomotion is inferred from segment velocity; the simulation
                // state union intentionally has no separate `run` state.
                addMove(mover, start, end, nextMark(mover), "idle", 16);
                addState(mover, end, Math.min(event.t - 1, end + Math.round(DUEL_TPS * 0.18)), "idle", 16);
                addState(watcher, start - 2, end + 2, "idle", 15);
            }
            initiative = initiative === ids.player ? ids.enemy : ids.player;
        }
        previousPrimary = event.t;
    }

    for (const track of tracks.values()) capFinalTrackVelocity(track);
    return tracks;
}

function directedProjectiles(result: DuelResult, tracks: Map<string, Track>, ids: { player: string; enemy: string }) {
    const life = new Map<number, { first: number; last: number; team: Team }>();
    for (const snapshot of result.snapshots) for (const projectile of snapshot.projectiles) {
        const current = life.get(projectile.id);
        if (current) current.last = snapshot.t;
        else life.set(projectile.id, { first: snapshot.t, last: snapshot.t, team: projectile.team });
    }
    const sourceFor = (team: Team) => tracks.get(team === "player" ? ids.player : ids.enemy)!;
    const targetFor = (team: Team) => tracks.get(team === "player" ? ids.enemy : ids.player)!;
    return { life, sourceFor, targetFor };
}

/**
 * Re-stage a 1v1 replay without changing any gameplay result. Party fights keep
 * their simulation coordinates until they receive a dedicated multi-actor shot
 * grammar; applying a 1v1 lane system to four pets would reduce, not add, clarity.
 */
export function directPetDuelPresentation(result: DuelResult): DuelResult {
    const ids = fighterIds(result);
    if (!ids || result.snapshots.length < 2) return result;
    const tracks = buildTracks(result, ids);
    const projectilePlan = directedProjectiles(result, tracks, ids);
    const snapshots = result.snapshots.map((snapshot) => {
        const positions = new Map<string, Point>();
        for (const actor of snapshot.actors) {
            const track = tracks.get(actor.id)!;
            positions.set(actor.id, trackPosition(track, snapshot.t));
        }
        const actors: DuelActorSnap[] = snapshot.actors.map((actor) => {
            const point = positions.get(actor.id)!;
            const otherId = actor.id === ids.player ? ids.enemy : ids.player;
            const foe = positions.get(otherId)!;
            const facing = norm(foe.x - point.x, foe.y - point.y);
            const scriptedState = stateAt(tracks.get(actor.id)!, snapshot.t);
            return {
                ...actor,
                x: Math.round(point.x / EPS) * EPS,
                y: Math.round(point.y / EPS) * EPS,
                faceX: Math.round(facing.x / EPS) * EPS,
                faceY: Math.round(facing.y / EPS) * EPS,
                state: actor.state === "dead" ? "dead" : scriptedState,
                ai: actor.ai ? {
                    ...actor.ai,
                    state: scriptedState === "idle" ? "hold position" : scriptedState === "dash" ? "reposition" : actor.ai.state,
                    plan: scriptedState === "idle" ? "hold the assigned stage mark" : actor.ai.plan,
                    reason: scriptedState === "idle" ? "opponent owns the current pressure beat" : actor.ai.reason,
                } : undefined,
            };
        });
        const projectiles = snapshot.projectiles.map((projectile) => {
            const info = projectilePlan.life.get(projectile.id);
            if (!info) return projectile;
            const source = trackPosition(projectilePlan.sourceFor(info.team), info.first);
            const target = trackPosition(projectilePlan.targetFor(info.team), info.last);
            const p = ease((snapshot.t - info.first) / Math.max(1, info.last - info.first));
            const lateral = (projectile.id % 2 === 0 ? 1 : -1) * Math.sin(Math.PI * p) * 0.45;
            const axis = norm(target.x - source.x, target.y - source.y);
            return {
                ...projectile,
                x: source.x + (target.x - source.x) * p - axis.y * lateral,
                y: source.y + (target.y - source.y) * p + axis.x * lateral,
            };
        });
        return { ...snapshot, actors, projectiles };
    });
    return { ...result, snapshots };
}
