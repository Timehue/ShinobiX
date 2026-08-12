import type { PetVisualQuality } from "./pet-visual-quality";

export type WarfrontPresentationBudget = Readonly<{
    hollowHoundRigs: number;
    laneHoundRigs: number;
    squadCameras: boolean;
    squadCameraRenderEvery: number;
    houndRigDistance: number;
}>;

export type WarfrontAdaptivePressure = 0 | 1 | 2;

export type WarfrontTeam = "blue" | "red";
export type WarfrontPaceMode = "1" | "1.5" | "2" | "smart";

type WarfrontTimedSnapshot = Readonly<{ t: number }>;

export type WarfrontSnapshotBounds<T extends WarfrontTimedSnapshot> = Readonly<{
    lower: T;
    upper: T;
    /** Real simulation tick, clamped to the captured replay frontier. */
    tick: number;
    /** Blend from `lower` to `upper`, derived from their real `.t` values. */
    alpha: number;
}>;

/** The replay frontier is simulation time, never an array index. */
export function warfrontSnapshotFrontier<T extends WarfrontTimedSnapshot>(snapshots: readonly T[]): number {
    const tick = snapshots[snapshots.length - 1]?.t;
    return Number.isFinite(tick) ? Math.max(0, tick) : 0;
}

/** Resolve the last captured state at or before a simulation tick. This is the
 * canonical lookup for discrete state (HP, alive, status, intent). */
export function warfrontSnapshotAtTick<T extends WarfrontTimedSnapshot>(
    snapshots: readonly T[],
    requestedTick: number,
): T | null {
    return warfrontSnapshotBoundsAtTick(snapshots, requestedTick)?.lower ?? null;
}

/** Resolve interpolation keyframes by their real simulation ticks. Captures
 * may be sparse and the terminal frame need not land on the regular stride. */
export function warfrontSnapshotBoundsAtTick<T extends WarfrontTimedSnapshot>(
    snapshots: readonly T[],
    requestedTick: number,
): WarfrontSnapshotBounds<T> | null {
    if (snapshots.length === 0) return null;
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const firstTick = Number.isFinite(first.t) ? first.t : 0;
    const lastTick = Number.isFinite(last.t) ? Math.max(firstTick, last.t) : firstTick;
    const finiteTick = Number.isFinite(requestedTick) ? requestedTick : firstTick;
    const tick = Math.max(firstTick, Math.min(lastTick, finiteTick));

    let lo = 0;
    let hi = snapshots.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (snapshots[mid].t <= tick) lo = mid;
        else hi = mid - 1;
    }
    const lower = snapshots[lo];
    const upper = snapshots[Math.min(snapshots.length - 1, lo + 1)];
    const gap = upper.t - lower.t;
    const alpha = gap > 0 ? Math.max(0, Math.min(1, (tick - lower.t) / gap)) : 0;
    return { lower, upper, tick, alpha };
}

/** Return the exclusive event cursor through a real simulation tick. Action
 * cues stay event-driven even when the tick itself is not a captured keyframe. */
export function warfrontEventCursorThroughTick<T extends Readonly<{ t: number }>>(
    events: readonly T[],
    start: number,
    requestedTick: number,
): number {
    let cursor = Math.max(0, Math.min(events.length, Number.isFinite(start) ? Math.floor(start) : 0));
    const tick = Number.isFinite(requestedTick) ? requestedTick : 0;
    while (cursor < events.length && events[cursor].t <= tick) cursor++;
    return cursor;
}

/** Binary-search an actor's pre-indexed action ticks. The result is stable for
 * forward playback and rewind, so render frames never consume or duplicate it. */
export function warfrontLatestTickAtOrBefore(ticks: readonly number[], requestedTick: number): number | null {
    if (ticks.length === 0) return null;
    const tick = Number.isFinite(requestedTick) ? requestedTick : 0;
    let lo = 0;
    let hi = ticks.length - 1;
    if (ticks[0] > tick) return null;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (ticks[mid] <= tick) lo = mid;
        else hi = mid - 1;
    }
    return ticks[lo];
}

export function warfrontPaceForMotion(mode: WarfrontPaceMode, reducedMotion: boolean): WarfrontPaceMode {
    return reducedMotion ? "1" : mode;
}

export type WarfrontEventSignal = Readonly<{
    type: string;
    t?: number;
    stolen?: boolean;
    kind?: string;
}>;

const EVENT_SALIENCE: Readonly<Record<string, number>> = Object.freeze({
    coredown: 10, verdict: 9, ascendance: 9, wardenkill: 9, coreexposed: 8, mercy: 8,
    counterstrikeclaim: 8, shutdown: 7, siegebreak: 7, techniqueused: 7,
    counterstrike: 6, statuedown: 6, guardiandown: 6, minikill: 6,
    kill: 5, sigilawake: 5, wardenphase: 5, phase: 5,
    gank: 4, ultimate: 4, wardensoon: 4, minimarch: 4, elemsig: 3,
    opening: 2, round: 2, sigilsoon: 2,
});

/** One shared importance scale for director cuts, recaps and smart pacing. */
export function warfrontEventSalience(event: WarfrontEventSignal): number {
    if (event.type === "wardenkill" && event.stolen) return 10;
    if (event.type === "bosssig") return event.kind === "roar" || event.kind === "quakeland" ? 0 : 3;
    return EVENT_SALIENCE[event.type] ?? 0;
}

/** Brief presentation-only time dilation for readable impact beats. */
export function warfrontHitStopSeconds(event: WarfrontEventSignal, reducedMotion: boolean): number {
    if (reducedMotion) return 0;
    if (event.type === "coredown") return .46;
    if (event.type === "wardenkill" || event.type === "ascendance" || event.type === "siegebreak" || event.type === "counterstrikeclaim") return .34;
    if (event.type === "statuedown" || event.type === "guardiandown" || event.type === "coreexposed" || event.type === "minikill" || event.type === "techniqueused" || event.type === "counterstrike") return .26;
    if (event.type === "kill" || event.type === "shutdown") return .22;
    return event.type === "ultimate" ? .14 : 0;
}

/** A fallen Seal belongs to the victim, but its broadcast credit and color
 * always belong to the attacker. Keeping this pure prevents perspective flips. */
export function warfrontSealBreakPresentation(event: Readonly<{ team: WarfrontTeam; by: WarfrontTeam }>) {
    const team = event.by;
    return { team, label: `${team === "blue" ? "Blue" : "Red"} shattered the Seal`, color: team === "blue" ? "#93c5fd" : "#fca5a5" } as const;
}

export function warfrontPipHealthColor(team: WarfrontTeam, hpShare: number): string {
    return hpShare < .35 ? "#f87171" : team === "blue" ? "#93c5fd" : "#fca5a5";
}

/** Choose by consequence first, then put the chosen beats back in story order. */
export function warfrontTurningPoints<T extends WarfrontEventSignal>(events: readonly T[], limit: number): T[] {
    return events
        .map((event, index) => ({ event, index, score: warfrontEventSalience(event) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || (b.event.t ?? 0) - (a.event.t ?? 0) || b.index - a.index)
        .slice(0, Math.max(0, limit))
        .sort((a, b) => (a.event.t ?? 0) - (b.event.t ?? 0) || a.index - b.index)
        .map((entry) => entry.event);
}

export type WarfrontJudgmentState = Readonly<{
    leader: WarfrontTeam | null;
    blueShare: number;
    label: string;
}>;

/** Mirrors the authoritative verdict order: structures first, coins only on a tie. */
export function warfrontJudgmentState(
    score: Readonly<Record<WarfrontTeam, number>>,
    coins: Readonly<Record<WarfrontTeam, number>>,
): WarfrontJudgmentState {
    const leader = score.blue !== score.red
        ? (score.blue > score.red ? "blue" : "red")
        : coins.blue !== coins.red ? (coins.blue > coins.red ? "blue" : "red") : null;
    const blueShare = leader === "blue" ? 68 : leader === "red" ? 32 : 50;
    const basis = score.blue === score.red ? `points tied; coins ${coins.blue}-${coins.red}` : `points ${score.blue}-${score.red}`;
    return { leader, blueShare, label: leader ? `${leader === "blue" ? "Blue" : "Red"} leads Judgment, ${basis}` : `Judgment tied, ${basis}` };
}

type QuietActor = Readonly<{ team: WarfrontTeam; state: string; x: number; y: number }>;
type QuietObjective = Readonly<{ active: boolean; alive: boolean; x: number; y: number }>;
type QuietMini = Readonly<{ alive: boolean; awake: boolean; ally: WarfrontTeam | null; siegeDowns: number; x: number; y: number }>;

/** Conservative smart-pacing gate: never accelerate a live fight, objective
 * contact, exposed Seal, or a four-second major-event pre-roll. */
export function warfrontSmartPaceIsQuiet(snapshot: Readonly<{
    actors: readonly QuietActor[];
    structures: Readonly<Record<WarfrontTeam, Readonly<{ core: Readonly<{ exposed: boolean }> }>>>;
    warden: QuietObjective;
    minis: readonly QuietMini[];
}>, majorEventNearby: boolean): boolean {
    if (majorEventNearby || snapshot.structures.blue.core.exposed || snapshot.structures.red.core.exposed) return false;
    const alive = snapshot.actors.filter((actor) => actor.state !== "respawning");
    for (const blue of alive) {
        if (blue.team !== "blue") continue;
        for (const red of alive) if (red.team === "red" && Math.hypot(blue.x - red.x, blue.y - red.y) < 8) return false;
    }
    if (snapshot.warden.active && snapshot.warden.alive
        && alive.some((actor) => Math.hypot(actor.x - snapshot.warden.x, actor.y - snapshot.warden.y) < 9)) return false;
    for (const mini of snapshot.minis) {
        if (!mini.alive || (!mini.awake && !(mini.ally && mini.siegeDowns === 0))) continue;
        if (alive.some((actor) => Math.hypot(actor.x - mini.x, actor.y - mini.y) < 8)) return false;
    }
    return true;
}

/** Perspective-safe Ward Seal callout for the live broadcast HUD. */
export function warfrontWardSealInstruction(
    exposedTeam: WarfrontTeam | null,
    localTeam: WarfrontTeam,
): string | null {
    if (!exposedTeam) return null;
    const action = exposedTeam === localTeam ? "DEFEND" : "BREAK";
    return `${action} ${exposedTeam.toUpperCase()}'S WARD SEAL`;
}

export type WarfrontMvpCandidate = Readonly<{
    id: string;
    dmg: number;
    kills: number;
    assists?: number;
    coins: number;
}>;

export type WarfrontMotionFilterState = {
    initialized: boolean;
    x: number;
    z: number;
    vx: number;
    vz: number;
};

export function createWarfrontMotionFilter(): WarfrontMotionFilterState {
    return { initialized: false, x: 0, z: 0, vx: 0, vz: 0 };
}

/**
 * Low-pass the authoritative 30 Hz position stream without changing gameplay.
 * The position stage removes single-tick A-to-B-to-A corrections; the velocity
 * stage keeps model facing and locomotion clips from reacting to the remainder.
 * Both coefficients are frame-rate independent.
 */
export function advanceWarfrontMotionFilter(
    state: WarfrontMotionFilterState,
    targetX: number,
    targetZ: number,
    delta: number,
    snap = false,
): WarfrontMotionFilterState {
    const dt = Math.max(1 / 240, Math.min(0.05, Number.isFinite(delta) ? delta : 1 / 60));
    if (!state.initialized || snap || !Number.isFinite(state.x) || !Number.isFinite(state.z)) {
        state.initialized = true;
        state.x = targetX;
        state.z = targetZ;
        state.vx = 0;
        state.vz = 0;
        return state;
    }
    const previousX = state.x;
    const previousZ = state.z;
    // The replay stream advances at 30 Hz while the renderer can run far
    // faster. A slightly longer visual half-life absorbs alternating separation
    // corrections at choke points without touching authoritative movement.
    const positionAlpha = 1 - Math.pow(0.88, Math.min(3, dt * 60));
    state.x += (targetX - state.x) * positionAlpha;
    state.z += (targetZ - state.z) * positionAlpha;
    const rawVx = (state.x - previousX) / dt;
    const rawVz = (state.z - previousZ) / dt;
    const velocityAlpha = 1 - Math.pow(0.92, Math.min(3, dt * 60));
    state.vx += (rawVx - state.vx) * velocityAlpha;
    state.vz += (rawVz - state.vz) * velocityAlpha;
    if (Math.abs(state.vx) < 0.015) state.vx = 0;
    if (Math.abs(state.vz) < 0.015) state.vz = 0;
    return state;
}

export function warfrontMotionFilterSpeed(state: WarfrontMotionFilterState): number {
    return Math.hypot(state.vx, state.vz);
}

/** MVP values decisive contributions instead of simply awarding the damage
 * crown. Kills, assists, and economy can now surface a tank/support who enabled
 * the winning push while damage remains the strongest single component. */
export function warfrontMvpId(rows: readonly WarfrontMvpCandidate[]): string | null {
    let best: WarfrontMvpCandidate | null = null;
    let bestScore = -Infinity;
    for (const row of rows) {
        const score = row.dmg + row.kills * 450 + (row.assists ?? 0) * 180 + row.coins * 0.35;
        if (score > bestScore) {
            best = row;
            bestScore = score;
        }
    }
    return best?.id ?? null;
}

const WARFRONT_BUDGETS: Readonly<Record<PetVisualQuality, WarfrontPresentationBudget>> = Object.freeze({
    low: Object.freeze({
        hollowHoundRigs: 0,
        laneHoundRigs: 0,
        squadCameras: false,
        squadCameraRenderEvery: 4,
        houndRigDistance: 0,
    }),
    medium: Object.freeze({
        hollowHoundRigs: 2,
        laneHoundRigs: 3,
        // Medium is the highest player-facing preset, so expose the broadcast
        // wall here at its cheaper cadence. Adaptive pressure still sheds it
        // first; High remains available only as a QA override.
        squadCameras: true,
        squadCameraRenderEvery: 3,
        houndRigDistance: 22,
    }),
    high: Object.freeze({
        hollowHoundRigs: 4,
        laneHoundRigs: 6,
        squadCameras: true,
        squadCameraRenderEvery: 2,
        houndRigDistance: 28,
    }),
});

export function warfrontPresentationBudget(quality: PetVisualQuality): WarfrontPresentationBudget {
    return WARFRONT_BUDGETS[quality];
}

/** Shed secondary spectacle before touching combat readability. Pressure 1 is
 * the normal thermal/fps fallback; pressure 2 is the emergency mobile path. */
export function adaptWarfrontPresentationBudget(
    budget: WarfrontPresentationBudget,
    pressure: WarfrontAdaptivePressure,
): WarfrontPresentationBudget {
    if (pressure === 0) return budget;
    if (pressure === 2) return WARFRONT_BUDGETS.low;
    return Object.freeze({
        hollowHoundRigs: Math.min(2, budget.hollowHoundRigs),
        laneHoundRigs: Math.min(3, budget.laneHoundRigs),
        squadCameras: false,
        squadCameraRenderEvery: Math.max(3, budget.squadCameraRenderEvery),
        houndRigDistance: Math.min(22, budget.houndRigDistance),
    });
}

export function shouldRenderWarfrontHoundRig(
    index: number,
    distanceToCamera: number,
    rigBudget: number,
    maxDistance: number,
): boolean {
    return index >= 0
        && index < rigBudget
        && distanceToCamera <= maxDistance;
}

/**
 * Keep a pooled render slot attached to the same simulation id until that id
 * disappears. Indexing directly into a filtered mob array makes every later
 * slot jump to a different creature whenever an earlier mob dies.
 */
export function reconcileWarfrontMobSlots(
    current: readonly (number | null)[],
    availableIds: readonly number[],
    capacity = current.length,
): Array<number | null> {
    const live = new Set(availableIds);
    const next = Array.from({ length: capacity }, (_, index) => {
        const id = current[index];
        return id !== null && id !== undefined && live.has(id) ? id : null;
    });
    const claimed = new Set(next.filter((id): id is number => id !== null));
    let open = 0;
    for (const id of availableIds) {
        if (claimed.has(id)) continue;
        while (open < next.length && next[open] !== null) open++;
        if (open >= next.length) break;
        next[open] = id;
        claimed.add(id);
    }
    return next;
}
