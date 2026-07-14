/*
 * Pet evolution cutscene — the pure, deterministic TIMELINE (the "engine").
 *
 * Digivolution cadence (owner-specified):
 *   1. the current pet starts to SPIN and washes into a white glow
 *   2. after the glow begins, a big TUBE OF LIGHT rises up around it
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

// The old form spins/glows into white, then the evolved form takes over as a
// white spinning silhouette inside the tube before color returns.
const OLD_FORM_BEATS = new Set<EvolutionBeat>(["charge", "spinup", "morph"]);
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

/** 0..1 old -> evolved handoff once the old form is fully white. */
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
 * 0..1 brightness of the big TUBE OF LIGHT. The opening charge is deliberately
 * tube-free: the pet starts the transformation on its own, then the column rises
 * once the spin/white glow is underway. It holds through the evolved-white spin
 * and drops during the reveal so the new form steps out onto a clean stage.
 */
export function tubeIntensity(phase: EvolutionPhase): number {
    switch (phase.beat) {
        case "charge": return 0;                                     // no opening tube
        case "spinup": return easeOut(phase.progress);               // rises after the glow starts
        case "morph":
        case "slowdown": return 1;                                   // fully up
        case "burst": return Math.max(0, 1 - phase.progress * 1.4);  // collapses with the boom
        case "reveal": return Math.max(0, 0.45 - phase.progress * 0.45); // tube goes down as evolved form steps out
        default: return 0;                                           // settle: gone
    }
}

/** 0..1 of the tube's "rise" — how far up the column has travelled into place. */
export function tubeRise(phase: EvolutionPhase): number {
    if (phase.beat === "charge") return 0;
    if (phase.beat === "spinup") return easeOut(phase.progress);
    if (phase.beat === "reveal") return 1 - easeOut(phase.progress);
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

// -- 2.5D stage motion -------------------------------------------------------
// PetEvolutionStage3D renders flat pet art as grounded, lit HD-2D billboards.
// During the white/tube phases we intentionally allow the billboard to go
// through a faster multi-turn "energy spin"; the renderer presents that as an
// anime squash/flip illusion so the 2D art never sits invisible edge-on. Once
// color returns, it lands back on a front-facing 2.5D hero pose.

export interface EvolutionStageMotion {
    /** 0..1 sprite opacity (0 means the form is off-stage this beat). */
    opacity: number;
    /** Small world-space lift used while the light tube is active. */
    riseY: number;
    /** Visible Y rotation in degrees. Full turns happen only while blown out. */
    spinDeg: number;
    /** Uniform scale for charge growth and reveal pop. */
    scale: number;
    /** 0..1 element-aura glow intensity behind the form. */
    glow: number;
    /** 0..1 additive self-flash for the white silhouette/boom read. */
    flash: number;
    /** Which generated pose frame to prefer when available. */
    pose: "idle" | "cast";
}

const HIDDEN_STAGE: EvolutionStageMotion = {
    opacity: 0,
    riseY: 0,
    spinDeg: 0,
    scale: 1,
    glow: 0,
    flash: 0,
    pose: "idle",
};

function stageSpinDeg(phase: EvolutionPhase): number {
    if (phase.beat === "burst" || phase.beat === "reveal" || phase.beat === "settle") return 0;
    return evolutionSpin(phase) * 1.5 * 180 / Math.PI;
}

export function evolutionStageMotion(phase: EvolutionPhase, isNew: boolean): EvolutionStageMotion {
    const white = whiteness(phase);
    const tube = tubeIntensity(phase);
    const tunnel = tunnelIntensity(phase);
    const base = {
        riseY: tubeRise(phase) * 0.12,
        spinDeg: stageSpinDeg(phase),
        scale: morphScale(phase),
        glow: Math.min(1, 0.25 + tunnel * 0.35 + tube * 0.45 + white * 0.25),
        flash: white,
        pose: phase.beat === "charge" ? "cast" as const : "idle" as const,
    };

    if (isNew) {
        if (!isNewFormVisible(phase.beat)) return HIDDEN_STAGE;
        const opacity = phase.beat === "morph" ? morphProgress(phase) : 1;
        return {
            ...base,
            opacity,
            // Keep spinning as a white silhouette in the tube, then come out
            // front-facing as color returns.
            riseY: phase.beat === "reveal" || phase.beat === "settle" ? 0 : base.riseY,
            spinDeg: phase.beat === "reveal" || phase.beat === "settle" ? 0 : base.spinDeg,
        };
    }

    if (!isOldFormVisible(phase.beat)) return HIDDEN_STAGE;
    return {
        ...base,
        opacity: phase.beat === "morph" ? 1 - morphProgress(phase) : 1,
    };
}
