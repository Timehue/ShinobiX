/*
 * Presentation helpers for the Hollow Warfront Rite stage.
 *
 * These are pure and live outside the component so they can be unit-tested —
 * `sampleActor` in particular IS the jitter fix, and a renderer-only regression
 * there is invisible until someone watches a fight and calls it "jittery" again.
 */
import type { DuelActorSnap, DuelEvent, DuelProjSnap, DuelResult } from "./pet-duel-sim";

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

/** World scale: retain the sim's full arena instead of compressing eight pets
 *  into the cramped duel pocket used by the first Rite renderer. */
export const RITE_WORLD_SCALE = 0.7;

export type ActorPose = {
    x: number;
    z: number;
    faceX: number;
    faceZ: number;
    targetId: string | null;
    hp: number;
    maxHp: number;
    state: DuelActorSnap["state"];
    statuses: readonly string[];
};

const EMPTY_POSE: ActorPose = { x: 0, z: 0, faceX: 1, faceZ: 0, targetId: null, hp: 0, maxHp: 1, state: "idle", statuses: [] };

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
        return { x: a.x, z: a.y, faceX: a.faceX, faceZ: a.faceY, targetId: a.targetId ?? null, hp: a.hp, maxHp: a.maxHp, state: a.state, statuses: a.statuses };
    }
    const mix = (p: number, q: number) => p + (q - p) * f;
    return {
        x: mix(a.x, b.x),
        z: mix(a.y, b.y),
        // Facing is interpolated too, or a fighter snaps around between ticks.
        faceX: mix(a.faceX, b.faceX),
        faceZ: mix(a.faceY, b.faceY),
        targetId: (f > 0.5 ? b.targetId : a.targetId) ?? null,
        hp: mix(a.hp, b.hp),
        maxHp: a.maxHp,
        // Discrete fields take the leading snapshot so a state change lands on
        // the frame it actually happens rather than a frame late.
        state: f > 0.5 ? b.state : a.state,
        statuses: f > 0.5 ? b.statuses : a.statuses,
    };
}

export type SquadFocusOrder = {
    team: "player" | "enemy";
    target: { team: "player" | "enemy"; lane: number };
    attackers: Array<{ team: "player" | "enemy"; lane: number }>;
};

/** The replay-native squad order visible at one tick. Requiring two attackers
 * filters ordinary 1v1 pressure out of the high-priority focus-fire language. */
export function squadFocusAt(result: DuelResult, team: "player" | "enemy", t: number): SquadFocusOrder | null {
    const snaps = result.snapshots;
    if (!snaps.length) return null;
    const snapshot = snaps[Math.max(0, Math.min(snaps.length - 1, Math.floor(t)))];
    const enemies = new Map((snapshot?.actors ?? [])
        .filter((actor) => actor.team !== team && actor.hp > 0)
        .map((actor) => [actor.id, actor]));
    const claims = new Map<string, DuelActorSnap[]>();
    for (const actor of snapshot?.actors ?? []) {
        if (actor.team !== team || actor.hp <= 0 || !actor.targetId || !enemies.has(actor.targetId)) continue;
        const list = claims.get(actor.targetId);
        if (list) list.push(actor);
        else claims.set(actor.targetId, [actor]);
    }
    const strongest = [...claims.entries()]
        .filter(([, attackers]) => attackers.length >= 2)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
    if (!strongest) return null;
    const target = enemies.get(strongest[0]);
    if (!target) return null;
    return {
        team,
        target: { team: target.team, lane: target.slot },
        attackers: strongest[1].map((actor) => ({ team: actor.team, lane: actor.slot })),
    };
}

export type SquadClashExplanation = {
    headline: string;
    detail: string;
    playerFocusKos: number;
    enemyFocusKos: number;
};

function focusClaimsAt(result: DuelResult, team: "player" | "enemy", targetId: string, t: number): number {
    const snapshots = result.snapshots;
    if (!snapshots.length) return 0;
    const snapshot = snapshots[Math.max(0, Math.min(snapshots.length - 1, Math.floor(t)))];
    return snapshot.actors.filter((actor) => actor.team === team && actor.hp > 0 && actor.targetId === targetId).length;
}

/** A short, evidence-backed answer to "why did that side win?" Focus KOs outrank
 * generic damage because they are both strategically meaningful and visible. */
export function explainSquadClash(
    result: DuelResult,
    winner: "player" | "enemy" | null,
): SquadClashExplanation {
    let playerFocusKos = 0;
    let enemyFocusKos = 0;
    let firstBreak: "player" | "enemy" | null = null;
    for (const event of result.events) {
        if (event.type !== "ko") continue;
        const scoringTeam = event.side === "player" ? "enemy" : "player";
        if (!firstBreak) firstBreak = scoringTeam;
        if (focusClaimsAt(result, scoringTeam, event.actorId, event.t - 1) >= 2) {
            if (scoringTeam === "player") playerFocusKos++;
            else enemyFocusKos++;
        }
    }
    if (!winner) {
        return { headline: "Neither formation created a clean break", detail: "Cover, range and protection held on both sides through the tactical clock.", playerFocusKos, enemyFocusKos };
    }
    const winnerFocus = winner === "player" ? playerFocusKos : enemyFocusKos;
    const loserFocus = winner === "player" ? enemyFocusKos : playerFocusKos;
    const subject = winner === "player" ? "Your band" : "Their band";
    if (winnerFocus > loserFocus) {
        return {
            headline: `${subject} converted coordinated focus`,
            detail: `${winnerFocus} coordinated ${winnerFocus === 1 ? "break" : "breaks"} created the numbers advantage; the losing formation could not recover.`,
            playerFocusKos,
            enemyFocusKos,
        };
    }
    if (firstBreak === winner) {
        return {
            headline: `${subject} secured the opening break`,
            detail: "The first knockout opened a file, letting the surviving pets cross-cover and attack the exposed back line.",
            playerFocusKos,
            enemyFocusKos,
        };
    }
    return {
        headline: `${subject} survived the counter-collapse`,
        detail: "They absorbed the first loss, preserved more total health through cover and support, and won the final outnumbered exchanges.",
        playerFocusKos,
        enemyFocusKos,
    };
}

/** Projectiles at a fractional tick. They are part of the simulation snapshots
 *  but the first Rite renderer never drew them, which made every ranged move
 *  look like unexplained remote damage. */
export function sampleProjectiles(result: DuelResult, t: number): DuelProjSnap[] {
    const snaps = result.snapshots;
    if (!snaps.length) return [];
    const clamped = Math.max(0, Math.min(snaps.length - 1, t));
    const i = Math.floor(clamped);
    const f = clamped - i;
    const current = snaps[i]?.projectiles ?? [];
    const next = snaps[Math.min(i + 1, snaps.length - 1)]?.projectiles ?? current;
    const nextById = new Map(next.map((projectile) => [projectile.id, projectile]));
    const mixed = current.map((projectile) => {
        const b = nextById.get(projectile.id);
        if (!b || f <= 0) return projectile;
        return {
            ...projectile,
            x: projectile.x + (b.x - projectile.x) * f,
            y: projectile.y + (b.y - projectile.y) * f,
        };
    });
    // A projectile born in the next snapshot appears only after the midpoint,
    // matching the discrete-state convention used by sampleActor.
    if (f > 0.5) {
        const ids = new Set(current.map((projectile) => projectile.id));
        for (const projectile of next) if (!ids.has(projectile.id)) mixed.push(projectile);
    }
    return mixed;
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
