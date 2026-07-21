import type { DuelEvent } from "./pet-duel-sim";
import type { PetCombatModelProfile } from "./pet-3d-models";

export type PetHeroMoveStyle =
    | "generic"
    | "kitsune-shadow-step"
    | "kitsune-eclipse-pounce"
    | "kitsune-tail-cast"
    | "selkie-surf"
    | "selkie-tail-strike"
    | "selkie-wave-launch"
    | "quadruped-rush"
    | "biped-combo"
    | "avian-dive"
    | "serpentine-surge"
    | "heavy-slam";

export type PetHeroMoveWindow = Readonly<{
    start: number;
    end: number;
    move: string;
    style: PetHeroMoveStyle;
}>;

export type PetHeroBodyPose = Readonly<{
    lift: number;
    pitch: number;
    roll: number;
    yaw: number;
    drive: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}>;

const normalize = (value?: string | null) => String(value ?? "").trim().toLowerCase();

/**
 * Presentation-only move vocabulary. The two showcase pets retain their
 * bespoke performances, while every certified roster model receives a
 * species-shaped professional fallback instead of the old generic pose/VFX.
 * Combat remains data-driven; this classification only chooses presentation.
 */
export function petHeroMoveStyle({
    petId,
    petName,
    move,
    kind,
    profile,
}: {
    petId?: string;
    petName?: string;
    move?: string;
    kind?: string | null;
    profile?: PetCombatModelProfile | null;
}): PetHeroMoveStyle {
    const id = normalize(petId);
    const pet = normalize(petName);
    const technique = normalize(move);
    const moveKind = normalize(kind);
    const kitsune = id.startsWith("mythic-0") || pet.includes("eclipse kitsune");
    const selkie = id.startsWith("starter-water") || pet.includes("tidal selkie");

    if (kitsune) {
        if (/phantom|phase|shadow step|feint/.test(technique) || moveKind === "move") return "kitsune-shadow-step";
        if (/eclipse fang|fang|pounce|rend/.test(technique) || moveKind === "damage" || moveKind === "crush") return "kitsune-eclipse-pounce";
        return "kitsune-tail-cast";
    }
    if (selkie) {
        if (/tidal crash|tidal wave|tsunami|maelstrom/.test(technique) || moveKind === "push") return "selkie-wave-launch";
        if (/riptide shift|surf|current step/.test(technique) || moveKind === "move") return "selkie-surf";
        if (/riptide fang|tail|flipper|fang/.test(technique) || moveKind === "damage" || moveKind === "crush") return "selkie-tail-strike";
        return "selkie-surf";
    }
    if (profile === "quadruped") return "quadruped-rush";
    if (profile === "biped") return "biped-combo";
    if (profile === "avian") return "avian-dive";
    if (profile === "serpentine") return "serpentine-surge";
    if (profile === "heavy") return "heavy-slam";
    return "generic";
}

const MOVE_OPENERS = new Set<DuelEvent["type"]>(["windup", "cast", "ultimate", "maneuver"]);
const MOVE_RESOLUTIONS = new Set<DuelEvent["type"]>(["hit", "whiff", "heal", "shield", "buff"]);

/** Build compact action windows once per replay so a renderer can ask which
 * named move currently owns a model without searching the event stream each
 * frame. Repeated uses of the same move remain separate phrases. */
export function petHeroMoveWindows(
    events: readonly DuelEvent[],
    actorId: string,
    pet: { id?: string; name?: string; profile?: PetCombatModelProfile | null },
): readonly PetHeroMoveWindow[] {
    const windows: PetHeroMoveWindow[] = [];
    const actorEvents = events.filter((event) => event.actorId === actorId && event.move);

    actorEvents.forEach((event, index) => {
        if (!event.move || !MOVE_OPENERS.has(event.type)) return;
        let end = event.t + 20;
        for (let nextIndex = index + 1; nextIndex < actorEvents.length; nextIndex++) {
            const candidate = actorEvents[nextIndex];
            if (candidate.t - event.t > 66) break;
            if (candidate.move !== event.move) continue;
            if (MOVE_RESOLUTIONS.has(candidate.type)) {
                end = candidate.t + 16;
                break;
            }
        }
        windows.push({
            start: Math.max(0, event.t - 3),
            end,
            move: event.move,
            style: petHeroMoveStyle({ petId: pet.id, petName: pet.name, move: event.move, kind: event.kind, profile: pet.profile }),
        });
    });

    // A named hit can exist without an explicit opener in older replay payloads.
    for (const event of actorEvents) {
        if (event.type !== "hit" || !event.move) continue;
        if (windows.some((window) => window.move === event.move && event.t >= window.start && event.t <= window.end)) continue;
        windows.push({
            start: Math.max(0, event.t - 12),
            end: event.t + 16,
            move: event.move,
            style: petHeroMoveStyle({ petId: pet.id, petName: pet.name, move: event.move, kind: event.kind, profile: pet.profile }),
        });
    }

    return windows.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function petHeroMoveAt(windows: readonly PetHeroMoveWindow[], tick: number): PetHeroMoveWindow | null {
    let active: PetHeroMoveWindow | null = null;
    for (const window of windows) {
        if (window.start > tick) break;
        if (tick <= window.end) active = window;
    }
    return active;
}

const EMPTY_POSE: PetHeroBodyPose = Object.freeze({
    lift: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    drive: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
});

/** Layered centre-of-mass performance for showcase moves. Values are deliberately
 * restrained enough to preserve the certified mesh, but large enough to make a
 * move readable in silhouette from the arena camera. */
export function petHeroBodyPose({
    style,
    motion,
    motionAge,
    timeline,
    attackPulse,
    casting,
}: {
    style?: PetHeroMoveStyle;
    motion: string;
    motionAge: number;
    timeline: number;
    attackPulse: number;
    casting: boolean;
}): PetHeroBodyPose {
    if (!style || style === "generic") return EMPTY_POSE;
    const dashP = Math.min(1, motionAge / 0.58);
    const dashArc = Math.sin(Math.PI * dashP);
    const striking = motion === "strike";
    const winding = motion === "windup" || casting;
    const recovering = motion === "recover";

    if (style === "kitsune-shadow-step") return {
        lift: motion === "dash" ? dashArc * 0.1 : 0,
        pitch: motion === "dash" ? -0.17 + dashP * 0.08 : winding ? -0.08 : 0,
        roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.095 : 0,
        yaw: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.13 : 0,
        drive: motion === "dash" ? dashArc * 0.035 : 0,
        scaleX: 1,
        scaleY: motion === "dash" ? 0.94 + dashArc * 0.04 : 1,
        scaleZ: motion === "dash" ? 1.08 : 1,
    };
    if (style === "kitsune-eclipse-pounce") return {
        lift: striking ? attackPulse * 0.13 : 0,
        pitch: winding ? -0.22 : striking ? 0.08 + attackPulse * 0.2 : recovering ? -0.06 : 0,
        roll: striking ? -attackPulse * 0.055 : 0,
        yaw: winding ? Math.sin(timeline * 7) * 0.025 : 0,
        drive: striking ? attackPulse * 0.15 : winding ? -0.055 : 0,
        scaleX: striking ? 0.96 : 1,
        scaleY: winding ? 0.93 : striking ? 1.07 : 1,
        scaleZ: winding ? 0.9 : striking ? 1.16 : 1,
    };
    if (style === "kitsune-tail-cast") {
        const surge = winding ? 0.5 + Math.sin(timeline * 7.5) * 0.5 : 0;
        return {
            lift: surge * 0.045,
            pitch: winding ? -0.075 + surge * 0.035 : 0,
            roll: winding ? Math.sin(timeline * 4.2) * 0.045 : 0,
            yaw: winding ? Math.sin(timeline * 3.4) * 0.11 : 0,
            drive: winding ? -0.025 : 0,
            scaleX: winding ? 1.02 : 1,
            scaleY: winding ? 1.04 + surge * 0.035 : 1,
            scaleZ: winding ? 0.97 : 1,
        };
    }
    if (style === "selkie-surf") return {
        lift: motion === "dash" ? dashArc * 0.075 : 0,
        pitch: motion === "dash" || motion === "run" ? -0.12 + dashP * 0.05 : winding ? -0.06 : 0,
        roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.14 : motion === "run" ? Math.sin(timeline * 8) * 0.045 : 0,
        yaw: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.08 : 0,
        drive: motion === "dash" ? dashArc * 0.045 : 0,
        scaleX: 1,
        scaleY: motion === "dash" ? 0.94 : 1,
        scaleZ: motion === "dash" || motion === "run" ? 1.09 : 1,
    };
    if (style === "selkie-tail-strike") return {
        lift: striking ? attackPulse * 0.04 : 0,
        pitch: winding ? -0.13 : striking ? attackPulse * 0.08 : 0,
        roll: winding ? -0.12 : striking ? attackPulse * 0.28 : recovering ? -0.08 : 0,
        yaw: winding ? -0.24 : striking ? -0.16 + attackPulse * 0.55 : recovering ? 0.12 : 0,
        drive: striking ? attackPulse * 0.08 : 0,
        scaleX: striking ? 1.08 : 1,
        scaleY: striking ? 0.96 : 1,
        scaleZ: winding ? 0.94 : striking ? 1.08 : 1,
    };
    if (style === "quadruped-rush") return {
        lift: motion === "dash" ? dashArc * 0.085 : striking ? attackPulse * 0.055 : 0,
        pitch: winding ? -0.12 : striking ? 0.1 + attackPulse * 0.12 : recovering ? -0.035 : motion === "dash" ? -0.08 : 0,
        roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.045 : 0,
        yaw: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.075 : 0,
        drive: striking ? attackPulse * 0.105 : motion === "dash" ? dashArc * 0.025 : winding ? -0.035 : 0,
        scaleX: striking ? 0.98 : 1,
        scaleY: winding ? 0.95 : striking ? 1.045 : 1,
        scaleZ: winding ? 0.94 : striking || motion === "dash" ? 1.075 : 1,
    };
    if (style === "biped-combo") return {
        lift: motion === "dash" ? dashArc * 0.075 : striking ? attackPulse * 0.045 : 0,
        pitch: winding ? -0.08 : striking ? attackPulse * 0.08 : recovering ? -0.025 : 0,
        roll: striking ? -0.1 + attackPulse * 0.2 : motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.065 : 0,
        yaw: winding ? -0.11 : striking ? -0.08 + attackPulse * 0.34 : motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.09 : 0,
        drive: striking ? attackPulse * 0.115 : motion === "dash" ? dashArc * 0.03 : 0,
        scaleX: striking ? 1.035 : 1,
        scaleY: winding ? 0.96 : striking ? 1.035 : 1,
        scaleZ: winding ? 0.95 : striking ? 1.07 : 1,
    };
    if (style === "avian-dive") return {
        lift: motion === "dash" ? dashArc * 0.17 : striking ? attackPulse * 0.07 : winding ? 0.035 : 0,
        pitch: motion === "dash" ? -0.2 + dashP * 0.28 : winding ? 0.08 : striking ? -0.12 + attackPulse * 0.2 : 0,
        roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.13 : striking ? attackPulse * 0.08 : 0,
        yaw: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.12 : 0,
        drive: striking ? attackPulse * 0.12 : motion === "dash" ? dashArc * 0.045 : 0,
        scaleX: motion === "dash" || winding || striking ? 1.08 : 1,
        scaleY: motion === "dash" ? 0.95 : striking ? 1.06 : 1,
        scaleZ: motion === "dash" ? 1.12 : striking ? 1.07 : 1,
    };
    if (style === "serpentine-surge") return {
        lift: motion === "dash" ? dashArc * 0.105 : striking ? attackPulse * 0.04 : 0,
        pitch: winding ? -0.075 : striking ? attackPulse * 0.07 : motion === "dash" ? -0.055 : 0,
        roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.16 : striking ? attackPulse * 0.18 : 0,
        yaw: winding ? -0.12 : motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.18 : striking ? -0.14 + attackPulse * 0.36 : 0,
        drive: striking ? attackPulse * 0.095 : motion === "dash" ? dashArc * 0.04 : 0,
        scaleX: striking ? 1.06 : 1,
        scaleY: winding ? 0.96 : striking ? 1.035 : 1,
        scaleZ: winding ? 0.94 : motion === "dash" || striking ? 1.11 : 1,
    };
    if (style === "heavy-slam") return {
        lift: striking ? attackPulse * 0.035 : motion === "dash" ? dashArc * 0.045 : 0,
        pitch: winding ? -0.15 : striking ? 0.08 + attackPulse * 0.12 : recovering ? -0.04 : 0,
        roll: striking ? -attackPulse * 0.035 : 0,
        yaw: winding ? -0.045 : striking ? attackPulse * 0.065 : 0,
        drive: striking ? attackPulse * 0.125 : winding ? -0.05 : motion === "dash" ? dashArc * 0.02 : 0,
        scaleX: winding ? 1.055 : striking ? 1.08 : 1,
        scaleY: winding ? 0.9 : striking ? 1.1 : 1,
        scaleZ: winding ? 0.92 : striking ? 1.08 : 1,
    };
    return {
        lift: striking ? attackPulse * 0.13 : 0,
        pitch: winding ? -0.2 : striking ? 0.08 + attackPulse * 0.18 : recovering ? -0.055 : 0,
        roll: winding ? Math.sin(timeline * 4) * 0.035 : 0,
        yaw: winding ? Math.sin(timeline * 3.2) * 0.055 : 0,
        drive: striking ? attackPulse * 0.1 : winding ? -0.045 : 0,
        scaleX: striking ? 1.05 : 1,
        scaleY: winding ? 0.92 : striking ? 1.1 : 1,
        scaleZ: winding ? 0.9 : striking ? 1.12 : 1,
    };
}
