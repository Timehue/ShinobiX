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
const RECOIL_TICKS = Math.round(DUEL_TPS * 0.24);
const DODGE_TICKS = Math.round(DUEL_TPS * 0.32);
const WINDUP_LOOKAHEAD = Math.round(DUEL_TPS * 1.35);
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

function addMove(track: Track, start: number, end: number, to: Point, state: DuelState, priority: number) {
    const safeStart = Math.max(0, Math.round(start));
    const safeEnd = Math.max(safeStart + 1, Math.round(end));
    const from = trackPosition(track, safeStart);
    const target = keepOnFloor(to);
    // A later authored beat wins. Trim an older overlapping segment so two
    // movement decisions never blend into a jittery change of mind.
    for (const segment of track.segments) {
        if (segment.end > safeStart && segment.start < safeStart && segment.priority <= priority) {
            const p = ease((safeStart - segment.start) / Math.max(1, segment.end - segment.start));
            segment.to = {
                x: segment.from.x + (segment.to.x - segment.from.x) * p,
                y: segment.from.y + (segment.to.y - segment.from.y) * p,
            };
            segment.end = safeStart;
        }
    }
    track.segments = track.segments.filter((segment) => segment.end <= safeStart || segment.start >= safeEnd || segment.priority > priority);
    track.segments.push({ start: safeStart, end: safeEnd, from, to: target, state, priority });
    track.segments.sort((a, b) => a.start - b.start || a.priority - b.priority);
    addState(track, safeStart, safeEnd, state, priority);
}

function nextMark(track: Track, salt = 0): Point {
    const marks = track.team === "player" ? PLAYER_MARKS : ENEMY_MARKS;
    track.markIndex = (track.markIndex + 1 + salt) % marks.length;
    return copyPoint(marks[track.markIndex]);
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
                addMove(actor, resolveTick - Math.round(DUEL_TPS * 0.3), resolveTick, contactPoint(actorAt, targetAtResolve, 2.45), "dash", 52);
            }
            return;
        }

        if (event.type === "cast" && (event.kind === "buff" || event.kind === "haste" || event.kind === "heal" || event.kind === "barrier")) {
            // Setup is a distance break: sprint out, turn, then power up.  The
            // rival explicitly does not follow the retreating caster.
            const disengage = nextMark(actor, 1);
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
                addMove(actor, event.t - Math.round(DUEL_TPS * 0.25), event.t, contactPoint(hitActor, hitFoe, 2.35), "dash", 55);
            }
            addState(actor, event.t - 2, event.t + 5, "strike", 80);
            addState(foe, event.t, event.t + 8, "stagger", 82);
            const impactAttacker = trackPosition(actor, event.t);
            const impactTarget = trackPosition(foe, event.t);
            addMove(foe, event.t, event.t + RECOIL_TICKS, recoilPoint(impactTarget, impactAttacker, side), "stagger", 72);
            // The attacker relinquishes the contact lane immediately.  A wide,
            // different mark makes the next exchange a fresh composition.
            addMove(actor, event.t + 5, event.t + 5 + EXIT_TICKS, nextMark(actor), "idle", 34);
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
            addMove(actor, event.t + 5, event.t + 5 + EXIT_TICKS, nextMark(actor, 1), "idle", 36);
            return;
        }

        if (event.type === "buff" || event.type === "heal" || event.type === "shield") {
            addState(actor, event.t - 4, event.t + Math.round(DUEL_TPS * 0.55), "windup", 55);
            addState(foe, event.t - 2, event.t + Math.round(DUEL_TPS * 0.38), "idle", 24);
            return;
        }

        if (event.type === "ko") addState(actor, event.t, result.ticks + 1, "dead", 100);
    });

    // Give long quiet stretches purposeful single-actor lane changes.  These are
    // sparse establishing beats, not continuous orbiting; they also prevent a
    // defensive matchup from becoming two static models waiting on cooldowns.
    let previousPrimary = 0;
    let initiative = ids.player;
    for (const event of result.events.filter((candidate) => candidate.type === "windup" || candidate.type === "cast" || candidate.type === "hit" || candidate.type === "whiff")) {
        const gap = event.t - previousPrimary;
        if (gap > DUEL_TPS * 2.1) {
            const mover = tracks.get(initiative)!;
            const start = previousPrimary + Math.round(DUEL_TPS * 0.7);
            const end = Math.min(event.t - Math.round(DUEL_TPS * 0.45), start + MOVE_TICKS);
            if (end > start + 3) addMove(mover, start, end, nextMark(mover), "idle", 14);
            initiative = initiative === ids.player ? ids.enemy : ids.player;
        }
        previousPrimary = event.t;
    }

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
