/*
 * Pet evolution cutscene — the pure, deterministic TIMELINE (the "engine").
 *
 * Mirrors the digivolution beat structure (see
 * docs/pet-starter-evolution-plan.md §4): the old form charges and rises, a
 * tube of light + silhouette morph engulfs it, a white burst, the new form is
 * revealed with its name, then a full 360° hero spin before it settles.
 *
 * This module is renderer-agnostic and side-effect-free so it can be unit
 * tested. The view (components/PetEvolutionCutscene.tsx) reads `evolutionPhaseAt`
 * each frame and drives CSS/transform from it. Same split as
 * pet-coliseum-scene.ts (pure) ↔ PetColiseum.tsx (view).
 */

export type EvolutionBeat =
    | "charge"     // old form glows, void fades in, old name shown
    | "ascend"     // old form rises + slow spin
    | "tube"       // tube of light + silhouette morph (camera "crash-zoom")
    | "burst"      // white flash at the peak
    | "reveal"     // new form appears, new name slams in
    | "turntable"  // new form makes a full 360° hero spin
    | "settle";    // eases to a hero angle and holds; Continue available

export interface EvolutionBeatSpec {
    beat: EvolutionBeat;
    startMs: number;
    durationMs: number;
}

// Beat timings (ms). Tuned to the §4.3 table. Sum === EVOLUTION_TOTAL_MS.
export const EVOLUTION_BEATS: EvolutionBeatSpec[] = [
    { beat: "charge", startMs: 0, durationMs: 1200 },
    { beat: "ascend", startMs: 1200, durationMs: 1000 },
    { beat: "tube", startMs: 2200, durationMs: 1200 },
    { beat: "burst", startMs: 3400, durationMs: 400 },
    { beat: "reveal", startMs: 3800, durationMs: 400 },
    { beat: "turntable", startMs: 4200, durationMs: 2300 },
    { beat: "settle", startMs: 6500, durationMs: 1500 },
];

export const EVOLUTION_TOTAL_MS = 8000;

export interface EvolutionPhase {
    beat: EvolutionBeat;
    /** 0..1 progress within the current beat. */
    progress: number;
    elapsedMs: number;
    /** True once the whole sequence has finished (Continue can show). */
    done: boolean;
}

/** Resolve the current beat + within-beat progress at an elapsed time. Pure. */
export function evolutionPhaseAt(elapsedMs: number): EvolutionPhase {
    const t = Math.max(0, elapsedMs);
    if (t >= EVOLUTION_TOTAL_MS) {
        return { beat: "settle", progress: 1, elapsedMs: t, done: true };
    }
    for (const spec of EVOLUTION_BEATS) {
        if (t < spec.startMs + spec.durationMs) {
            const progress = spec.durationMs > 0
                ? Math.min(1, Math.max(0, (t - spec.startMs) / spec.durationMs))
                : 1;
            return { beat: spec.beat, progress, elapsedMs: t, done: false };
        }
    }
    return { beat: "settle", progress: 1, elapsedMs: t, done: true };
}

const NEW_FORM_BEATS = new Set<EvolutionBeat>(["reveal", "turntable", "settle"]);
const OLD_FORM_BEATS = new Set<EvolutionBeat>(["charge", "ascend", "tube"]);

/** The new (evolved) form is on screen from the reveal onward. */
export function isNewFormVisible(beat: EvolutionBeat): boolean {
    return NEW_FORM_BEATS.has(beat);
}

/** The old form is on screen up to and including the tube of light. */
export function isOldFormVisible(beat: EvolutionBeat): boolean {
    return OLD_FORM_BEATS.has(beat);
}

/** Whether the old name caption shows (charge → tube). */
export function showOldName(beat: EvolutionBeat): boolean {
    return OLD_FORM_BEATS.has(beat);
}

/** Whether the new name caption shows (reveal onward). */
export function showNewName(beat: EvolutionBeat): boolean {
    return NEW_FORM_BEATS.has(beat);
}

const TAU = Math.PI * 2;
// Hero rest angle after the spin — a slight 3/4 turn reads as "3D", not flat-on.
const SETTLE_ANGLE = TAU * 0.06;

/**
 * Y-axis rotation (radians) for the hero turntable. One full circle across the
 * `turntable` beat (eased), then a gentle ease into the SETTLE_ANGLE hero pose.
 * Other beats return 0 (the old form's slow ascend spin is handled separately).
 */
export function turntableRotation(phase: EvolutionPhase): number {
    if (phase.beat === "turntable") {
        // ease-in-out so the spin starts/ends smooth.
        const e = phase.progress;
        const eased = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
        return eased * TAU;
    }
    if (phase.beat === "settle") {
        // Continue the last bit of rotation into the resting hero angle.
        return TAU + SETTLE_ANGLE * phase.progress;
    }
    return 0;
}

/** Slow ascend spin for the OLD form (radians) — a lazy turn while it rises. */
export function ascendRotation(phase: EvolutionPhase): number {
    if (phase.beat === "ascend") return phase.progress * Math.PI;        // half turn
    if (phase.beat === "tube") return Math.PI + phase.progress * Math.PI; // finishes the turn
    return 0;
}

/** 0..1 intensity of the white burst flash (peaks mid-burst, fades by reveal). */
export function burstIntensity(phase: EvolutionPhase): number {
    if (phase.beat === "burst") {
        // ramp up over the first half, hold, then start to fall.
        return Math.min(1, phase.progress * 1.6);
    }
    if (phase.beat === "reveal") return Math.max(0, 1 - phase.progress); // fade out
    return 0;
}
