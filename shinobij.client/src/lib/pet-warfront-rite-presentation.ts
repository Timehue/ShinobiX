/*
 * Presentation helpers for the Hollow Warfront Rite stage.
 *
 * These are pure and live outside the component so they can be unit-tested —
 * `sampleActor` in particular IS the jitter fix, and a renderer-only regression
 * there is invisible until someone watches a fight and calls it "jittery" again.
 */
import type { DuelActorSnap, DuelEvent, DuelResult } from "./pet-duel-sim";

export const RITE_TEAM_COLOR = { player: "#4cc9f0", enemy: "#ff5470" } as const;

const ELEMENT_COLOR: Readonly<Record<string, string>> = {
    Fire: "#ff7a45",
    Water: "#4cc2ff",
    Wind: "#6ff0c8",
    Lightning: "#ffe066",
    Earth: "#d9a566",
    None: "#c9d6de",
};

export const elementColor = (element: string | null | undefined): string =>
    ELEMENT_COLOR[String(element ?? "None")] ?? ELEMENT_COLOR.None;

/** World scale: the sim's ±14 X range compressed to a readable duel pocket. */
export const RITE_WORLD_SCALE = 0.42;

export type ActorPose = {
    x: number;
    z: number;
    faceX: number;
    faceZ: number;
    hp: number;
    maxHp: number;
    state: DuelActorSnap["state"];
    statuses: readonly string[];
};

const EMPTY_POSE: ActorPose = { x: 0, z: 0, faceX: 1, faceZ: 0, hp: 0, maxHp: 1, state: "idle", statuses: [] };

/**
 * Position of one actor at a FRACTIONAL tick, linearly interpolated between the
 * two bracketing snapshots. This is the whole jitter fix: the renderer asks for
 * t = 41.63 and gets the real position at 41.63, not the one from tick 41 with a
 * smoothing filter chasing it.
 *
 * `lane` is the fighter's index within its side — a 4v4 clash has four per team,
 * so team alone no longer identifies an actor.
 */
export function sampleActor(result: DuelResult, team: "player" | "enemy", lane: number, t: number): ActorPose {
    const snaps = result.snapshots;
    if (!snaps.length) return EMPTY_POSE;
    const clamped = Math.max(0, Math.min(snaps.length - 1, t));
    const i = Math.floor(clamped);
    const f = clamped - i;
    const match = (actor: DuelActorSnap) => actor.team === team && actor.slot === lane;
    const a = snaps[i]?.actors.find(match);
    const b = snaps[Math.min(i + 1, snaps.length - 1)]?.actors.find(match);
    if (!a) return EMPTY_POSE;
    if (!b || f <= 0) {
        return { x: a.x, z: a.y, faceX: a.faceX, faceZ: a.faceY, hp: a.hp, maxHp: a.maxHp, state: a.state, statuses: a.statuses };
    }
    const mix = (p: number, q: number) => p + (q - p) * f;
    return {
        x: mix(a.x, b.x),
        z: mix(a.y, b.y),
        // Facing is interpolated too, or a fighter snaps around between ticks.
        faceX: mix(a.faceX, b.faceX),
        faceZ: mix(a.faceY, b.faceY),
        hp: mix(a.hp, b.hp),
        maxHp: a.maxHp,
        // Discrete fields take the leading snapshot so a state change lands on
        // the frame it actually happens rather than a frame late.
        state: f > 0.5 ? b.state : a.state,
        statuses: f > 0.5 ? b.statuses : a.statuses,
    };
}

/** Events bucketed by tick — an O(1) lookup instead of the per-frame linear
 *  scan over every event so far that made the lane war slower as it ran. */
export function bucketEvents(events: readonly DuelEvent[]): Map<number, DuelEvent[]> {
    const byTick = new Map<number, DuelEvent[]>();
    for (const event of events) {
        const list = byTick.get(event.t);
        if (list) list.push(event);
        else byTick.set(event.t, [event]);
    }
    return byTick;
}

/** The tick of the killing blow, so the director can arm slow-mo BEFORE it
 *  lands instead of reacting after the fact. */
export function lethalTick(result: DuelResult): number | null {
    for (let i = result.events.length - 1; i >= 0; i--) {
        if (result.events[i].type === "ko") return result.events[i].t;
    }
    return null;
}


/** Every actor alive at `t`, as {team, lane} — what the camera has to frame. */
export function livingActors(result: DuelResult, t: number): Array<{ team: "player" | "enemy"; lane: number }> {
    const snaps = result.snapshots;
    if (!snaps.length) return [];
    const snap = snaps[Math.max(0, Math.min(snaps.length - 1, Math.floor(t)))];
    return (snap?.actors ?? [])
        .filter((actor) => actor.hp > 0)
        .map((actor) => ({ team: actor.team, lane: actor.slot }));
}

/** Every actor in the clash, alive or not — the renderer mounts one rig each. */
export function clashRoster(result: DuelResult): Array<{ team: "player" | "enemy"; lane: number }> {
    const first = result.snapshots[0];
    return (first?.actors ?? []).map((actor) => ({ team: actor.team, lane: actor.slot }));
}

/**
 * The centre and radius of the LIVING action at `t`.
 *
 * A squad clash has no single pair to frame, so the camera tracks the cloud of
 * fighters still standing: as pets fall the shot naturally tightens onto what is
 * left, which is the behaviour a hand-placed camera would need scripting to get.
 */
export function actionFocus(result: DuelResult, t: number): { x: number; z: number; radius: number; count: number } {
    const living = livingActors(result, t);
    if (!living.length) return { x: 0, z: 0, radius: 3, count: 0 };
    let sx = 0;
    let sz = 0;
    const points: Array<{ x: number; z: number }> = [];
    for (const who of living) {
        const pose = sampleActor(result, who.team, who.lane, t);
        points.push({ x: pose.x, z: pose.z });
        sx += pose.x;
        sz += pose.z;
    }
    const cx = sx / points.length;
    const cz = sz / points.length;
    let radius = 0;
    for (const p of points) radius = Math.max(radius, Math.hypot(p.x - cx, p.z - cz));
    return { x: cx, z: cz, radius, count: points.length };
}
