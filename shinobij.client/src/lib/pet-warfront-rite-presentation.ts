/*
 * Presentation helpers for the Hollow Warfront Rite stage.
 *
 * These are pure and live outside the component so they can be unit-tested —
 * `sampleActor` in particular IS the jitter fix, and a renderer-only regression
 * there is invisible until someone watches a fight and calls it "jittery" again.
 */
import type { DuelActorSnap, DuelEvent, DuelProjSnap, DuelResult } from "./pet-duel-sim";
import type { RiteClash } from "./pet-warfront-rite";

export const RITE_TEAM_COLOR = { player: "#4cc9f0", enemy: "#ff5470" } as const;
export const RITE_REVEAL_FIGHTER_COUNT = 8;

/** An atomic 4v4 reveal is ready only when each distinct expected rig has
 * survived its model Suspense boundary and painted behind the curtain. Extra
 * or duplicate callbacks cannot make a partial formation look complete. */
export function allRiteFighterModelsReady(
    fighters: readonly { team: "player" | "enemy"; lane: number }[],
    readyFighterIds: ReadonlySet<string>,
    committedActorIds: ReadonlySet<string>,
): boolean {
    const expected = new Set(fighters.map((fighter) => `${fighter.team}-${fighter.lane}`));
    return fighters.length === RITE_REVEAL_FIGHTER_COUNT
        && expected.size === RITE_REVEAL_FIGHTER_COUNT
        && [...expected].every((fighterId) => readyFighterIds.has(fighterId) && committedActorIds.has(fighterId));
}

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

export const riteGroundingAoCameraForwardOffset = (
    element: string | null | undefined,
    actorSize: number,
): number => element === "Water" ? actorSize * 0.10 : 0;

export const riteCanvasGroundingAoDepthScale = (
    element: string | null | undefined,
): number => element === "Water" ? 0.22 : 0.18;

export function riteCanvasLivingWaterFootAnchorY(
    element: string | null | undefined,
    projectedY: number,
    canvasWidth: number,
    canvasHeight: number,
    alive: boolean,
    koExiting: boolean,
): number {
    if (canvasHeight <= canvasWidth || element !== "Water" || !alive || koExiting) return projectedY;
    return Math.max(projectedY, canvasHeight * 0.32);
}

/**
 * A fighter's faction rune is a momentary combat read, never a unit pedestal.
 * Idle and KO states deliberately return an exact zero so both renderers can
 * prove that slate remains visible beneath actors outside an active phrase.
 * Recovery owns the fade while the actor is still recovering; there is no
 * residual ring once the replay returns to idle.
 */
export function riteGroundingFocusStrength(
    state: DuelActorSnap["state"],
    alive: boolean,
    stateAgeTicks = 0,
): number {
    if (!alive || state === "idle" || state === "dead") return 0;
    const age = Math.max(0, stateAgeTicks);
    switch (state) {
        case "windup": return Math.min(1, 0.34 + age * 0.11);
        case "strike": return 1;
        case "recover": return Math.max(0, 0.5 - age * 0.1);
        case "stagger": return 0.58;
        case "dash": return 0.34;
        case "dodge": return 0.3;
        default: return 0;
    }
}

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

/** One mutable pose slot for render loops. The ordinary `sampleActor` wrapper
 * remains convenient for tests, while the eight-fighter stage reuses these
 * slots instead of allocating 480+ short-lived objects every second. */
export const createActorPoseSample = (): ActorPose => ({ ...EMPTY_POSE });

function copyEmptyPose(out: ActorPose): ActorPose {
    out.x = EMPTY_POSE.x;
    out.z = EMPTY_POSE.z;
    out.faceX = EMPTY_POSE.faceX;
    out.faceZ = EMPTY_POSE.faceZ;
    out.targetId = EMPTY_POSE.targetId;
    out.hp = EMPTY_POSE.hp;
    out.maxHp = EMPTY_POSE.maxHp;
    out.state = EMPTY_POSE.state;
    out.statuses = EMPTY_POSE.statuses;
    return out;
}

function sampleActorMatchingInto(
    result: DuelResult,
    t: number,
    out: ActorPose,
    team: "player" | "enemy" | null,
    lane: number,
    actorId: string | null,
): ActorPose {
    const snaps = result.snapshots;
    if (!snaps.length) return copyEmptyPose(out);
    const clamped = Math.max(0, Math.min(snaps.length - 1, t));
    const i = Math.floor(clamped);
    const f = clamped - i;
    const aActors = snaps[i]?.actors ?? [];
    const bActors = snaps[Math.min(i + 1, snaps.length - 1)]?.actors ?? [];
    let a: DuelActorSnap | undefined;
    let b: DuelActorSnap | undefined;
    for (let index = 0; index < aActors.length; index++) {
        const candidate = aActors[index];
        if (actorId !== null ? candidate.id === actorId : candidate.team === team && candidate.slot === lane) { a = candidate; break; }
    }
    if (!a) return copyEmptyPose(out);
    for (let index = 0; index < bActors.length; index++) {
        const candidate = bActors[index];
        if (actorId !== null ? candidate.id === actorId : candidate.team === team && candidate.slot === lane) { b = candidate; break; }
    }
    if (!b || f <= 0) {
        out.x = a.x; out.z = a.y; out.faceX = a.faceX; out.faceZ = a.faceY;
        out.targetId = a.targetId ?? null; out.hp = a.hp; out.maxHp = a.maxHp;
        out.state = a.state; out.statuses = a.statuses;
        return out;
    }
    out.x = a.x + (b.x - a.x) * f;
    out.z = a.y + (b.y - a.y) * f;
    out.faceX = a.faceX + (b.faceX - a.faceX) * f;
    out.faceZ = a.faceY + (b.faceY - a.faceY) * f;
    out.targetId = (f > 0.5 ? b.targetId : a.targetId) ?? null;
    out.hp = a.hp + (b.hp - a.hp) * f;
    out.maxHp = a.maxHp;
    out.state = f > 0.5 ? b.state : a.state;
    out.statuses = f > 0.5 ? b.statuses : a.statuses;
    return out;
}

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
    return sampleActorMatchingInto(result, t, createActorPoseSample(), team, lane, null);
}

/** Allocation-free team/lane sampler for a render-owned mutable pose slot. */
export function sampleActorInto(result: DuelResult, team: "player" | "enemy", lane: number, t: number, out: ActorPose): ActorPose {
    return sampleActorMatchingInto(result, t, out, team, lane, null);
}

/** Allocation-free target sampler. Actor ids are authoritative replay ids, so
 * this avoids splitting/parsing that string for every fighter every frame. */
export function sampleActorByIdInto(result: DuelResult, actorId: string, t: number, out: ActorPose): ActorPose {
    return sampleActorMatchingInto(result, t, out, null, -1, actorId);
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

export type RiteTacticalReport = {
    winner: "player" | "enemy" | null;
    firstKo: { team: "player" | "enemy"; slot: number; petId: string; tick: number } | null;
    highestDamageThreat: { team: "enemy"; slot: number; petId: string; damage: number } | null;
    opponentFormation: Array<{ slot: number; petId: string; node: number }>;
};

const combatantForActor = (clash: RiteClash, team: "player" | "enemy", actorId: string) => {
    const side = team === "player" ? clash.blue : clash.red;
    return side.find((combatant) => `${team}-${combatant.lane}` === actorId) ?? null;
};

/** Compact facts for the between-clash decision. Every value is derived from
 * the authoritative event stream and the exact combatants that just fought;
 * no forecast or local combat estimate enters this report. */
export function riteTacticalReport(clash: RiteClash): RiteTacticalReport {
    const firstKoEvent = clash.result.events.find((event) => event.type === "ko") ?? null;
    const firstKoCombatant = firstKoEvent
        ? combatantForActor(clash, firstKoEvent.side, firstKoEvent.actorId)
        : null;
    const damageByActor = new Map<string, { damage: number; firstTick: number }>();
    for (const event of clash.result.events) {
        if (event.type !== "hit" || event.side !== "enemy" || !event.dmg || event.dmg <= 0) continue;
        const current = damageByActor.get(event.actorId);
        if (current) current.damage += event.dmg;
        else damageByActor.set(event.actorId, { damage: event.dmg, firstTick: event.t });
    }
    const topDamage = [...damageByActor.entries()]
        .map(([actorId, totals]) => ({ actorId, ...totals, combatant: combatantForActor(clash, "enemy", actorId) }))
        .filter((entry): entry is typeof entry & { combatant: NonNullable<typeof entry.combatant> } => Boolean(entry.combatant))
        .sort((a, b) => b.damage - a.damage || a.firstTick - b.firstTick
            || (a.actorId === b.actorId ? 0 : a.actorId < b.actorId ? -1 : 1))[0] ?? null;

    return {
        winner: clash.winner === "blue" ? "player" : clash.winner === "red" ? "enemy" : null,
        firstKo: firstKoEvent && firstKoCombatant ? {
            team: firstKoEvent.side,
            slot: firstKoCombatant.slot,
            petId: firstKoCombatant.petId,
            tick: firstKoEvent.t,
        } : null,
        highestDamageThreat: topDamage ? {
            team: "enemy",
            slot: topDamage.combatant.slot,
            petId: topDamage.combatant.petId,
            damage: topDamage.damage,
        } : null,
        opponentFormation: clash.red.map((combatant) => ({
            slot: combatant.slot,
            petId: combatant.petId,
            node: combatant.node,
        })),
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

/** Allocation-free projectile interpolation for a fixed render pool. Returns
 * the number of populated slots; entries at and above that count are stale. */
export function sampleProjectilesInto(
    result: DuelResult,
    t: number,
    out: DuelProjSnap[],
    capacity = out.length,
): number {
    const snaps = result.snapshots;
    if (!snaps.length || capacity <= 0) return 0;
    const clamped = Math.max(0, Math.min(snaps.length - 1, t));
    const i = Math.floor(clamped);
    const f = clamped - i;
    const current = snaps[i]?.projectiles ?? [];
    const next = snaps[Math.min(i + 1, snaps.length - 1)]?.projectiles ?? current;
    let count = 0;
    for (let currentIndex = 0; currentIndex < current.length && count < capacity; currentIndex++) {
        const projectile = current[currentIndex];
        let following: DuelProjSnap | undefined;
        for (let nextIndex = 0; nextIndex < next.length; nextIndex++) {
            if (next[nextIndex].id === projectile.id) { following = next[nextIndex]; break; }
        }
        const slot = out[count] ?? (out[count] = { id: -1, x: 0, y: 0, team: "player", kind: "damage", element: null });
        slot.id = projectile.id;
        slot.x = following ? projectile.x + (following.x - projectile.x) * f : projectile.x;
        slot.y = following ? projectile.y + (following.y - projectile.y) * f : projectile.y;
        slot.team = projectile.team;
        slot.kind = projectile.kind;
        slot.element = projectile.element;
        count++;
    }
    if (f > 0.5) {
        for (let nextIndex = 0; nextIndex < next.length && count < capacity; nextIndex++) {
            const projectile = next[nextIndex];
            let existed = false;
            for (let currentIndex = 0; currentIndex < current.length; currentIndex++) {
                if (current[currentIndex].id === projectile.id) { existed = true; break; }
            }
            if (!existed) {
                const slot = out[count] ?? (out[count] = { id: -1, x: 0, y: 0, team: "player", kind: "damage", element: null });
                slot.id = projectile.id;
                slot.x = projectile.x;
                slot.y = projectile.y;
                slot.team = projectile.team;
                slot.kind = projectile.kind;
                slot.element = projectile.element;
                count++;
            }
        }
    }
    return count;
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
