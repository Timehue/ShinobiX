// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import type { Pet } from "../../types/pet";
import { lerp } from "../../lib/pet-coliseum-scene";
import { ARENA_X, ARENA_Y, type DuelResult, type DuelActorSnap } from "../../lib/pet-duel-sim";
import { type PetHeroMoveStyle } from "../../lib/pet-hero-moves";
import { HOLLOW_HOUND_SURFACE } from "../../lib/pet-model-surface";
import { isHollowHoundEncounterPet } from "../../../../shared/hollow-gate-contract";
import { type PetColiseumWeather } from "../../lib/pet-coliseum-weather";
import { type DuelClock, FLOOR_Y, type Vec3 } from "./stage";

 // mid-body height for impacts / casts

export function hollowHoundSurface(pet: Pick<Pet, "id" | "name">) {
    return isHollowHoundEncounterPet(pet)
        ? HOLLOW_HOUND_SURFACE
        : undefined;
}


export const findActor = (snap: { actors: DuelActorSnap[] }, id: string) => snap.actors.find((a) => a.id === id);



// ── Grounded 3D-coliseum duel placement ──────────────────────────────────────
// The duel now plays INSIDE the round renderer's 3D Arena (curved wall + lit
// floor + perspective camera), so fighters STAND on the floor with real contact
// shadows instead of floating over a painted wall. Map the sim field (±ARENA_X,
// ±ARENA_Y) onto the floor plane (x = left↔right, z = depth toward/away camera);
// perspective + grounding then come from the scene, not a faked projection.
export const DUEL_FLOOR_HALF_W = 7.2;

   // use more of the physical coliseum for crossfield runs
export const DUEL_FLOOR_HALF_D = 4.25;

  // deeper lanes make cover wraps and re-entry angles readable
export const DUEL_FLOOR_Z0 = -0.4;


// ── Opening choreography (render-only) — a still ranged face-off and restrained
// power gather. Movement begins only when the combat simulation starts.
export const INTRO_SPLASH_END = 1.05;

   // s — establish the matchup without delaying the first exchange
export const INTRO_PAUSE_END = 1.18;

    // s — one clean still face-off before the gather
export const INTRO_SIZEUP_END = 2.15;

   // s — readable power gather at the real starting positions
export const INTRO_TOTAL = 2.35;

        // s — brief lock-in beat, then FIGHT
export const INTRO_WIDE_DOLLY = 14.2;

   // camera pull-back distance for the wide size-up shot
export const DUEL_CAMERA_Y = 5.15;

      // eye height — lower + closer than the old 5.75 so the pets read BIG, near-side-on, not a tiny top-down diorama
export const DUEL_LOOK_Y = 0.9;


export const introWideHold = (introSec: number): number => introSec < INTRO_TOTAL ? 1 : 0;


export function duelFieldToFloor(fx: number, fy: number): { wx: number; wz: number } {
    return { wx: (fx / ARENA_X) * DUEL_FLOOR_HALF_W, wz: DUEL_FLOOR_Z0 + (fy / ARENA_Y) * DUEL_FLOOR_HALF_D };
}



/** Playback driver: advances the shared clock (with HIT-STOP on impact), spawns
 *  damage numbers + impact bursts + elemental VFX as the clock crosses events,
 *  nudges the fixed stage camera for screen-shake, and fires onEnd once. */
export type DuelSetPieceKind = "flameBurst" | "abyssBurst" | "tidalWave" | "tornado" | "lightningStorm" | "earthBurst" | "lunarBurst" | "elemental";


export type DuelElementBurstKind = "fire" | "water" | "wind" | "lightning" | "earth" | "abyss" | "arcane";


export type DuelMoveCalloutTone = "attack" | "support" | "maneuver" | "combo";


/** The move banner's visual grammar, keyed by what the move DOES.
 *
 *  This used to be keyed by side — blue for your pet, red for theirs — which meant a
 *  heal, a shield, a sidestep and a fireball were the same banner with different
 *  words. Owner feedback was exactly that: "you can't tell what is a buff or an
 *  attack". Colour and glyph now carry the category, so one glance classifies the
 *  beat; the actor's name carries the side. */
export const MOVE_CALLOUT_STYLE: Record<DuelMoveCalloutTone, { color: string; text: string; glyph: string; label: string }> = {
    attack: { color: "#fbbf24", text: "#fef3c7", glyph: "⚔", label: "" },
    support: { color: "#34d399", text: "#d1fae5", glyph: "▲", label: "POWER UP ·" },
    maneuver: { color: "#a78bfa", text: "#ede9fe", glyph: "↷", label: "SHIFT ·" },
    combo: { color: "#f472b6", text: "#fce7f3", glyph: "✦", label: "COMBO ·" },
};


export type DuelImpactMode = "impact" | "tell" | "dodge";


export type DuelSupportKind = "heal" | "shield";


export type DuelAttackWeight = "basic" | "ability" | "heavy";


export type DuelDashCue = {
    id: number;
    actorId?: string;
    from: Vec3;
    to: Vec3;
    /** The attacker lands at `to`; damage and the contact burst resolve on the
     * defender at `impactAt`. Keeping these separate prevents a safe body gap
     * from turning a successful hit into VFX that visibly detonates in empty air. */
    impactAt: Vec3;
    color: string;
    kind: DuelElementBurstKind;
    move?: string;
    style: PetHeroMoveStyle;
    impact: boolean;
    createdAt: number;
    duration: number;
    travelDuration: number;
    /** Simulation-clock ownership keeps the model, trail and contact on one
     * timeline instead of skipping travel frames during a slow render. */
    startTick: number;
    contactTick: number;
    endTick: number;
    /** Signed lateral bow plus a smaller counter-sweep. Both return to zero at contact. */
    bend: number;
    weave: number;
};


export function dashCueTravelProgress(cue: Pick<DuelDashCue, "startTick" | "contactTick">, tick: number): number {
    return Math.min(1, Math.max(0, (tick - cue.startTick) / Math.max(1, cue.contactTick - cue.startTick)));
}


export type DuelPressureCue = { id: number; from: Vec3; to: Vec3; leftColor: string; rightColor: string; leftKind: DuelElementBurstKind; rightKind: DuelElementBurstKind };


export type DuelWeatherCue = {
    id: number;
    weather: PetColiseumWeather;
    actorId: string;
    move: string;
    startTick: number;
    endTick: number;
};


function dashTravelEase(progress: number): number {
    const p = Math.min(1, Math.max(0, progress));
    // Cubic smoothstep keeps the burst fast but spreads its displacement across
    // more visible frames than the old quadratic ease, whose steep midpoint read
    // like a teleport at 50-60 fps.
    return p * p * (3 - 2 * p);
}


export function dashPathPoint(cue: Pick<DuelDashCue, "from" | "to" | "bend" | "weave" | "impact">, progress: number, y = FLOOR_Y): Vec3 {
    const p = dashTravelEase(progress);
    const dx = cue.to[0] - cue.from[0], dz = cue.to[2] - cue.from[2];
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const sideX = -dz / length, sideZ = dx / length;
    // The first sine bows into a lane; the second crosses that lane once, creating
    // an authored anime S-step rather than random locomotion noise. Both are zero
    // at launch/contact, so the deterministic simulation endpoints stay exact.
    const lateral = Math.sin(Math.PI * p) * cue.bend + Math.sin(Math.PI * 2 * p) * cue.weave;
    const hop = Math.sin(Math.PI * p) * (cue.impact ? 0.3 : 0.42);
    return [
        lerp(cue.from[0], cue.to[0], p) + sideX * lateral,
        y + hop,
        lerp(cue.from[2], cue.to[2], p) + sideZ * lateral,
    ];
}


export function duelElementBurstKind(element?: string | null, move?: string): DuelElementBurstKind {
    const name = String(move ?? "").toLowerCase();
    // Some pets deliberately subvert their roster element. The Oni Hound is an
    // Earth-slot assassin, but a move named Hellhound Execution should erupt in
    // abyssal hellfire instead of throwing generic tan rocks at the opponent.
    if (/hell|oni|abyss|demon|soul|corruption/.test(name)) return "abyss";
    // Move identity takes precedence over the roster element. Eclipse Kitsune is
    // catalogued as Wind, but a lunar signature should carry the same violet,
    // celestial language through anticipation, dash trail and contact payoff.
    if (/lunar|eclipse|moon|ninetail|kitsune/.test(name)) return "arcane";
    const key = String(element ?? "").toLowerCase();
    if (key === "fire" || key === "water" || key === "wind" || key === "lightning" || key === "earth") return key;
    return "arcane";
}


export function liveDuelEffectPosition(duel: DuelResult, clock: { current: DuelClock }, actorId?: string): { wx: number; wz: number } | null {
    if (!actorId || duel.snapshots.length === 0) return null;
    const snapshot = duel.snapshots[Math.min(duel.snapshots.length - 1, Math.max(0, Math.floor(clock.current.t)))];
    const actor = snapshot?.actors.find((candidate) => candidate.id === actorId);
    return actor ? duelFieldToFloor(actor.x, actor.y) : null;
}


export function duelSetPieceKind(element?: string | null, move?: string): DuelSetPieceKind {
    const name = String(move ?? "").toLowerCase();
    if (/hell|oni|abyss|demon|soul|corruption/.test(name)) return "abyssBurst";
    if (/lunar|eclipse|moon|ninetail|kitsune/.test(name)) return "lunarBurst";
    if (/tidal|wave|tsunami|torrent|undertow/.test(name) || element === "Water") return "tidalWave";
    if (/tornado|cyclone|tempest|gale|vortex/.test(name) || element === "Wind") return "tornado";
    if (/flame|fire|inferno|blaze|cinder|burst/.test(name) || element === "Fire") return "flameBurst";
    if (/lightning|thunder|volt|storm|static/.test(name) || element === "Lightning") return "lightningStorm";
    if (/earth|stone|rock|quake|cataclysm/.test(name) || element === "Earth") return "earthBurst";
    return "elemental";
}


export function arenaScaleMove(move?: string): boolean {
    // Do not promote ordinary attacks just because an elemental word appears in
    // the pet's prefixed move name (for example "Tempest Hawk Force Pulse").
    // Ultimate events already receive a set piece; this gate is only for the few
    // explicitly arena-scale named attacks that arrive through a regular hit.
    return /\b(tidal wave|tsunami|maelstrom|tornado|cyclone|flame burst|inferno|eruption|cataclysm|thunderstorm|hellhound execution|hellgate|soul devour)\b/i.test(String(move ?? ""));
}



export function duelSetPieceTiming(kind: DuelSetPieceKind): { durationSec: number; contactDelayMs: number } {
    if (kind === "tidalWave") return { durationSec: 1.95, contactDelayMs: 560 };
    if (kind === "tornado") return { durationSec: 2.05, contactDelayMs: 280 };
    if (kind === "lunarBurst") return { durationSec: 1.86, contactDelayMs: 230 };
    return { durationSec: 1.86, contactDelayMs: 180 };
}
