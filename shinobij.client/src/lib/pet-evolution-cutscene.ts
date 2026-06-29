/*
 * Pet evolution cutscene — the pure, deterministic TIMELINE (the "engine").
 *
 * Digivolution cadence (owner-specified):
 *   1. the current pet starts to SPIN and washes into a white glow
 *   2. a big TUBE OF LIGHT rises up around it
 *   3. it keeps spinning (white silhouette) inside the tube
 *   4. the EVOLVED form appears (cross-fades in, still spinning)
 *   5. the spin SLOWS DOWN (still a white glow)
 *   6. BOOM — a white burst, then the new evolved pet is revealed in colour
 *
 * The spin is ONE continuous rotation (accelerate → fast → decelerate) that
 * lands front-facing for the burst, so the flat sprite is only ever edge-on
 * while it is a glowing white silhouette (where it reads as energy, not a
 * paper-thin sprite). The colour frames (charge start, reveal/settle) stay front.
 *
 * Renderer-agnostic and side-effect-free so it can be unit tested. The view
 * (components/PetEvolutionCutscene.tsx) reads `evolutionPhaseAt` each frame and
 * drives CSS/transform from it.
 */

export type EvolutionBeat =
    | "charge"     // old pet starts to spin, colour → white glow; old name shown
    | "spinup"     // white silhouette spins up as the big tube of light rises
    | "morph"      // still spinning; the evolved form cross-fades in (appears)
    | "slowdown"   // the spin decelerates, still a white glow
    | "burst"      // BOOM — white flash at the peak
    | "reveal"     // the new evolved pet's colour floods in; new name slams
    | "settle";    // holds the new form; Continue available

export interface EvolutionBeatSpec {
    beat: EvolutionBeat;
    startMs: number;
    durationMs: number;
}

// Beat timings (ms). Sum === EVOLUTION_TOTAL_MS.
export const EVOLUTION_BEATS: EvolutionBeatSpec[] = [
    { beat: "charge", startMs: 0, durationMs: 1200 },
    { beat: "spinup", startMs: 1200, durationMs: 1400 },
    { beat: "morph", startMs: 2600, durationMs: 2000 },
    { beat: "slowdown", startMs: 4600, durationMs: 1400 },
    { beat: "burst", startMs: 6000, durationMs: 500 },
    { beat: "reveal", startMs: 6500, durationMs: 900 },
    { beat: "settle", startMs: 7400, durationMs: 1300 },
];

export const EVOLUTION_TOTAL_MS = 8700;

// The continuous spin runs from the start through the end of `slowdown`, then
// holds front-facing for the burst/reveal/settle.
const SPIN_END_MS = 6000;
const SPIN_TURNS = 6;

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

const TAU = Math.PI * 2;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Cubic ease-in-out: slow start, fast middle, slow end. */
function easeInOut(e: number): number {
    const x = clamp01(e);
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
/** Quadratic ease-out: fast start, gentle finish. */
function easeOut(e: number): number {
    const x = clamp01(e);
    return 1 - Math.pow(1 - x, 2);
}

// The old form is on stage from charge through the morph (fading OUT across it).
const OLD_FORM_BEATS = new Set<EvolutionBeat>(["charge", "spinup", "morph"]);
// The new (evolved) form is on stage from the morph onward (fading IN there).
const NEW_FORM_BEATS = new Set<EvolutionBeat>(["morph", "slowdown", "burst", "reveal", "settle"]);

export function isOldFormVisible(beat: EvolutionBeat): boolean {
    return OLD_FORM_BEATS.has(beat);
}
export function isNewFormVisible(beat: EvolutionBeat): boolean {
    return NEW_FORM_BEATS.has(beat);
}
/** Old name shows while the old form is on stage (charge → morph). */
export function showOldName(beat: EvolutionBeat): boolean {
    return OLD_FORM_BEATS.has(beat);
}
/** New name is held back until the boom reveal (suspense through the spin). */
export function showNewName(beat: EvolutionBeat): boolean {
    return beat === "reveal" || beat === "settle";
}

/**
 * The ONE continuous spin (radians). Accelerates from 0, spins fast through the
 * tube/morph, decelerates across the slowdown, and LANDS on a whole number of
 * turns (≡ front-facing) at SPIN_END_MS — held there for the burst/reveal/settle
 * so the colour form faces front. Shared by both the old and new silhouettes.
 */
export function evolutionSpin(phase: EvolutionPhase): number {
    const t = Math.min(1, phase.elapsedMs / SPIN_END_MS);
    return easeInOut(t) * SPIN_TURNS * TAU;
}

/**
 * 0..1 progress of the old→new cross-fade. 0 before the morph, eased across it,
 * 1 after (the evolved form is fully present from the slowdown on).
 */
export function morphProgress(phase: EvolutionPhase): number {
    if (phase.beat === "morph") return easeInOut(phase.progress);
    return isNewFormVisible(phase.beat) ? 1 : 0;
}

/**
 * 0..1 "whiteness": 0 = the pet is shown in full COLOUR, 1 = a pure white glow
 * silhouette. The old pet washes to white over the first half of the charge (so
 * it is white before the spin turns it edge-on), stays white through the burst,
 * then the new pet's colour floods in across the reveal.
 */
export function whiteness(phase: EvolutionPhase): number {
    switch (phase.beat) {
        case "charge": return Math.min(1, phase.progress * 2);   // colour → white over the first half
        case "spinup":
        case "morph":
        case "slowdown":
        case "burst": return 1;                                  // full white glow
        case "reveal": return 1 - easeInOut(phase.progress);     // white → colour (the boom reveal)
        default: return 0;                                       // settle: full colour
    }
}

/**
 * 0..1 brightness of the big TUBE OF LIGHT. Kindles faint in the charge, RISES
 * to full as the pet spins up (the tube "comes up"), holds through the morph +
 * slowdown (the pet spins enveloped in it), then collapses with the burst. Gone
 * by the reveal so the new form steps out onto a clean stage.
 */
export function tubeIntensity(phase: EvolutionPhase): number {
    switch (phase.beat) {
        case "charge": return 0;                                     // NO tube yet — the pet starts its slow spin first
        case "spinup": return easeOut(phase.progress);               // tube RISES up once the spin is under way (0 → 1)
        case "morph":
        case "slowdown": return 1;                                   // fully up
        case "burst": return Math.max(0, 1 - phase.progress * 1.4);  // collapses with the boom
        default: return 0;                                           // reveal / settle: gone
    }
}

/** 0..1 of the tube's "rise" — how far up the column has travelled into place. */
export function tubeRise(phase: EvolutionPhase): number {
    if (phase.beat === "charge") return 0;                  // hidden — the pet spins up first
    if (phase.beat === "spinup") return easeOut(phase.progress);
    return tubeIntensity(phase) > 0 ? 1 : 0;
}

/**
 * 0..1 intensity of the rushing data-tunnel backdrop. Builds with the spin/tube,
 * peaks in the slowdown, fades through the burst, gone by the hero settle.
 */
export function tunnelIntensity(phase: EvolutionPhase): number {
    switch (phase.beat) {
        case "charge": return 0.1 + phase.progress * 0.2;             // 0.10 → 0.30
        case "spinup": return 0.3 + phase.progress * 0.4;             // 0.30 → 0.70
        case "morph": return 0.7 + phase.progress * 0.3;              // 0.70 → 1.00
        case "slowdown": return 1;
        case "burst": return Math.max(0, 1 - phase.progress * 0.7);
        case "reveal": return Math.max(0, 0.4 - phase.progress * 0.4);
        default: return 0;
    }
}

/** 0..1 white burst flash — the BOOM. Peaks in the burst, fades early in reveal. */
export function burstIntensity(phase: EvolutionPhase): number {
    if (phase.beat === "burst") return Math.min(1, phase.progress * 1.8);
    if (phase.beat === "reveal") return Math.max(0, 1 - phase.progress * 1.4);
    return 0;
}

/**
 * Scale of the form. Rests at 1, grows a touch as it spins up + morphs, holds
 * through the burst, then the reveal "pops" it (a slightly bigger boom impact
 * easing back to 1).
 */
export function morphScale(phase: EvolutionPhase): number {
    switch (phase.beat) {
        case "charge": return 1;
        case "spinup": return 1 + easeOut(phase.progress) * 0.06;        // 1 → 1.06
        case "morph": return 1.06 + easeInOut(phase.progress) * 0.06;    // 1.06 → 1.12
        case "slowdown":
        case "burst": return 1.12;
        case "reveal": return 1.18 - 0.18 * easeOut(phase.progress);     // boom pop 1.18 → 1.0
        default: return 1;                                               // settle
    }
}
