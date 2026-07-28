import type { DuelEvent } from "./pet-duel-sim";
import type { PetCombatModelProfile } from "./pet-3d-models";
import { petCombatFamily } from "./pet-combat-family";

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
    | "heavy-slam"
    | "pouncer-stalk"
    | "pack-hunter-pressure"
    | "charger-drive"
    | "burrow-grapple"
    | "armored-counter"
    | "amphibious-slide"
    | "hopper-spring"
    | "reptile-snap"
    | "rodent-scramble"
    | "primate-combo"
    | "aquatic-undertow"
    | "dragon-overrun";

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
    // The starter keeps its persistent `starter-water` id through evolution.
    // Key the bespoke Selkie performance from the actual form name so Abyssal
    // Leviathan correctly graduates into the dragon package.
    const selkie = pet.includes("tidal selkie");

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
    const family = petCombatFamily({ name: petName, profile });
    if (family === "pouncer") return "pouncer-stalk";
    if (family === "pack-hunter") return "pack-hunter-pressure";
    if (family === "charger") return "charger-drive";
    if (family === "burrow-grappler") return "burrow-grapple";
    if (family === "armored") return "armored-counter";
    if (family === "amphibious") return "amphibious-slide";
    if (family === "hopper") return "hopper-spring";
    if (family === "reptilian") return "reptile-snap";
    if (family === "rodent") return "rodent-scramble";
    if (family === "primate") return "primate-combo";
    if (family === "aquatic") return "aquatic-undertow";
    if (family === "dragon") return "dragon-overrun";
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
    if (style === "pouncer-stalk") {
        const stalk = motion === "idle" ? 0.5 + Math.sin(timeline * 2.4) * 0.5 : 0;
        return {
            lift: motion === "dash" ? dashArc * 0.11 : striking ? attackPulse * 0.105 : 0,
            pitch: winding ? -0.24 : striking ? 0.12 + attackPulse * 0.2 : motion === "idle" ? -0.035 - stalk * 0.025 : 0,
            roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.08 : striking ? -attackPulse * 0.04 : 0,
            yaw: motion === "idle" ? Math.sin(timeline * 1.75) * 0.035 : 0,
            drive: striking ? attackPulse * 0.165 : motion === "dash" ? dashArc * 0.045 : winding ? -0.06 : 0,
            scaleX: striking ? 0.96 : 1,
            scaleY: winding ? 0.9 : striking ? 1.075 : motion === "idle" ? 0.985 : 1,
            scaleZ: winding ? 0.88 : striking ? 1.19 : motion === "dash" ? 1.12 : motion === "idle" ? 1.025 : 1,
        };
    }
    if (style === "pack-hunter-pressure") {
        const circle = motion === "idle" ? Math.sin(timeline * 2.1) : 0;
        return {
            lift: motion === "dash" ? dashArc * 0.075 : striking ? attackPulse * 0.055 : 0,
            pitch: winding ? -0.13 : striking ? 0.09 + attackPulse * 0.13 : 0,
            roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.11 : circle * 0.018,
            yaw: motion === "idle" ? circle * 0.075 : winding ? -0.12 : striking ? attackPulse * 0.24 : 0,
            drive: striking ? attackPulse * 0.13 : motion === "dash" ? dashArc * 0.055 : 0,
            scaleX: striking ? 1.035 : 1,
            scaleY: winding ? 0.94 : striking ? 1.045 : 1,
            scaleZ: winding ? 0.93 : striking || motion === "dash" ? 1.11 : 1,
        };
    }
    if (style === "charger-drive") return {
        lift: striking ? attackPulse * 0.035 : motion === "dash" ? dashArc * 0.045 : 0,
        pitch: winding ? -0.19 : striking ? -0.08 + attackPulse * 0.18 : motion === "dash" ? -0.12 : 0,
        roll: striking ? -attackPulse * 0.025 : 0,
        yaw: winding ? Math.sin(timeline * 10) * 0.018 : 0,
        drive: striking ? attackPulse * 0.19 : motion === "dash" ? dashArc * 0.08 : winding ? -0.075 : 0,
        scaleX: winding ? 1.07 : striking ? 1.04 : 1,
        scaleY: winding ? 0.88 : striking ? 1.08 : 1,
        scaleZ: winding ? 0.9 : striking || motion === "dash" ? 1.2 : 1,
    };
    if (style === "burrow-grapple") return {
        lift: striking ? attackPulse * 0.13 : motion === "dodge" ? dashArc * 0.06 : 0,
        pitch: winding ? -0.24 : striking ? 0.18 + attackPulse * 0.14 : 0,
        roll: motion === "dodge" ? Math.sin(dashP * Math.PI * 2) * 0.18 : striking ? attackPulse * 0.09 : 0,
        yaw: winding ? -0.1 : striking ? attackPulse * 0.22 : 0,
        drive: striking ? attackPulse * 0.12 : winding ? -0.035 : 0,
        scaleX: winding ? 1.09 : striking ? 1.05 : 1,
        scaleY: winding ? 0.82 : striking ? 1.16 : 1,
        scaleZ: winding ? 0.94 : striking ? 1.08 : 1,
    };
    if (style === "armored-counter") {
        const brace = winding || casting;
        return {
            lift: striking ? attackPulse * 0.025 : 0,
            pitch: brace ? -0.12 : striking ? 0.08 + attackPulse * 0.09 : 0,
            roll: striking ? -attackPulse * 0.025 : 0,
            yaw: striking ? attackPulse * 0.055 : 0,
            drive: striking ? attackPulse * 0.135 : brace ? -0.025 : 0,
            scaleX: brace ? 1.12 : striking ? 1.1 : 1,
            scaleY: brace ? 0.84 : striking ? 1.12 : 1,
            scaleZ: brace ? 0.94 : striking ? 1.09 : 1,
        };
    }
    if (style === "amphibious-slide") return {
        lift: motion === "dash" ? dashArc * 0.065 : striking ? attackPulse * 0.035 : 0,
        pitch: motion === "dash" || motion === "run" ? -0.13 : winding ? -0.07 : striking ? attackPulse * 0.06 : 0,
        roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.16 : motion === "run" ? Math.sin(timeline * 7) * 0.055 : striking ? attackPulse * 0.17 : 0,
        yaw: winding ? -0.13 : striking ? -0.1 + attackPulse * 0.38 : 0,
        drive: striking ? attackPulse * 0.085 : motion === "dash" ? dashArc * 0.05 : 0,
        scaleX: striking ? 1.065 : 1,
        scaleY: motion === "dash" ? 0.93 : striking ? 0.98 : 1,
        scaleZ: motion === "dash" || motion === "run" ? 1.12 : striking ? 1.09 : 1,
    };
    if (style === "hopper-spring") {
        const listen = motion === "idle" ? 0.5 + Math.sin(timeline * 3.1) * 0.5 : 0;
        return {
            lift: motion === "dash" ? dashArc * 0.19 : striking ? attackPulse * 0.15 : listen * 0.012,
            pitch: winding ? -0.2 : motion === "dash" ? -0.08 + dashP * 0.18 : striking ? attackPulse * 0.16 : 0,
            roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.055 : 0,
            yaw: motion === "idle" ? Math.sin(timeline * 2.2) * 0.045 : striking ? attackPulse * 0.1 : 0,
            drive: striking ? attackPulse * 0.14 : motion === "dash" ? dashArc * 0.055 : winding ? -0.07 : 0,
            scaleX: winding ? 1.05 : 1,
            scaleY: winding ? 0.8 : motion === "dash" || striking ? 1.14 : 1,
            scaleZ: winding ? 0.93 : motion === "dash" || striking ? 1.12 : 1,
        };
    }
    if (style === "reptile-snap") {
        const freeze = motion === "idle" ? Math.max(0, Math.sin(timeline * 0.85)) : 0;
        return {
            lift: motion === "dash" ? dashArc * 0.045 : striking ? attackPulse * 0.035 : 0,
            pitch: winding ? -0.1 : striking ? -0.035 + attackPulse * 0.13 : 0,
            roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.09 : striking ? attackPulse * 0.07 : 0,
            yaw: winding ? -0.18 : striking ? -0.15 + attackPulse * 0.48 : motion === "idle" ? freeze * 0.025 : 0,
            drive: striking ? attackPulse * 0.155 : motion === "dash" ? dashArc * 0.065 : 0,
            scaleX: striking ? 1.08 : 1,
            scaleY: winding ? 0.92 : striking ? 1.035 : 1,
            scaleZ: winding ? 0.91 : striking || motion === "dash" ? 1.17 : 1,
        };
    }
    if (style === "rodent-scramble") {
        const juke = motion === "idle" ? Math.sin(timeline * 4.6) : 0;
        return {
            lift: motion === "dash" ? dashArc * 0.075 : striking ? attackPulse * 0.065 : 0,
            pitch: winding ? -0.14 : striking ? attackPulse * 0.11 : motion === "dash" ? -0.09 : 0,
            roll: motion === "dash" ? Math.sin(dashP * Math.PI * 4) * 0.12 : juke * 0.022,
            yaw: motion === "dash" ? Math.sin(dashP * Math.PI * 4) * 0.16 : motion === "idle" ? juke * 0.07 : striking ? attackPulse * 0.28 : 0,
            drive: striking ? attackPulse * 0.105 : motion === "dash" ? dashArc * 0.05 : 0,
            scaleX: winding ? 1.07 : striking ? 1.04 : 1,
            scaleY: winding ? 0.86 : striking ? 1.08 : 1,
            scaleZ: winding ? 0.95 : motion === "dash" || striking ? 1.1 : 1,
        };
    }
    if (style === "primate-combo") return {
        lift: motion === "dash" ? dashArc * 0.11 : striking ? attackPulse * 0.075 : 0,
        pitch: winding ? -0.095 : striking ? -0.025 + attackPulse * 0.13 : recovering ? -0.04 : 0,
        roll: winding ? -0.09 : striking ? -0.14 + attackPulse * 0.31 : motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.09 : 0,
        yaw: winding ? -0.16 : striking ? -0.12 + attackPulse * 0.55 : 0,
        drive: striking ? attackPulse * 0.145 : motion === "dash" ? dashArc * 0.045 : 0,
        scaleX: winding ? 1.06 : striking ? 1.1 : 1,
        scaleY: winding ? 0.91 : striking ? 1.07 : 1,
        scaleZ: winding ? 0.94 : striking ? 1.08 : 1,
    };
    if (style === "aquatic-undertow") return {
        lift: motion === "dash" ? dashArc * 0.09 : striking ? attackPulse * 0.045 : 0,
        pitch: motion === "dash" ? -0.1 + dashP * 0.12 : winding ? 0.045 : striking ? -0.08 + attackPulse * 0.12 : 0,
        roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.2 : striking ? attackPulse * 0.22 : 0,
        yaw: winding ? -0.2 : motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.24 : striking ? -0.18 + attackPulse * 0.46 : 0,
        drive: striking ? attackPulse * 0.11 : motion === "dash" ? dashArc * 0.05 : 0,
        scaleX: striking ? 1.11 : 1,
        scaleY: winding ? 0.95 : striking ? 1.04 : 1,
        scaleZ: winding ? 0.9 : motion === "dash" || striking ? 1.16 : 1,
    };
    if (style === "dragon-overrun") {
        const loom = winding || casting;
        return {
            lift: motion === "dash" ? dashArc * 0.115 : striking ? attackPulse * 0.085 : loom ? 0.025 : 0,
            pitch: loom ? -0.14 : motion === "dash" ? -0.1 : striking ? 0.04 + attackPulse * 0.16 : 0,
            roll: motion === "dash" ? Math.sin(dashP * Math.PI * 2) * 0.08 : striking ? -attackPulse * 0.045 : 0,
            yaw: loom ? Math.sin(timeline * 2.6) * 0.055 : striking ? attackPulse * 0.14 : 0,
            drive: striking ? attackPulse * 0.19 : motion === "dash" ? dashArc * 0.075 : loom ? -0.06 : 0,
            scaleX: loom ? 1.1 : striking ? 1.11 : 1,
            scaleY: loom ? 0.9 : striking ? 1.13 : 1,
            scaleZ: loom ? 0.91 : motion === "dash" || striking ? 1.2 : 1,
        };
    }
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
