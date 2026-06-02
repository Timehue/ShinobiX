/*
 * Pet-battle CAMERA director — pure functions that decide the stage-level
 * "camera" treatment for a single resolved frame + its current animation
 * event: which shake/focus/dim CSS class the stage wears, and how long the
 * timeline should FREEZE on a heavy impact (hit-stop / freeze-frame).
 *
 * Extracted from the inline logic in PetArenaBattlefield (App.tsx) so the
 * camera behavior is centralized, unit-tested, and extensible for later
 * cinematic phases — WITHOUT importing from App (keeps it node-testable and
 * free of a circular dep, like pet-battle-anim.ts).
 *
 * Pure + deterministic: every output is a function of its inputs only (no
 * RNG, no clock). The camera is a cosmetic DERIVE of the deterministic
 * simulator's frames — it never feeds back into battle resolution, so ranked
 * replays (identical canonical sim on both clients) are unaffected.
 */

import type { PetBattleAnimationEventType } from "../types/pet-battle";

/** Inputs the director reads — all already known to the renderer per frame. */
export type PetCameraInput = {
    /** A winner has been decided — the camera idles (no shake/focus). */
    resolved: boolean;
    /** This frame is a KO. */
    isKO: boolean;
    /** This frame's hit was a critical. */
    crit: boolean;
    /** This frame is a signature / flagship move. */
    signature: boolean;
    /** The hit removed a big chunk (>=18%) of the victim's max HP. */
    heavyHit: boolean;
    /** The animation event currently playing (drives shake vs. focus timing). */
    activeType?: PetBattleAnimationEventType | string;
    /** The signature wind-up beat is playing (charge event on a signature). */
    sigCharge: boolean;
};

/** What the renderer applies to the stage this tick. */
export type PetCameraState = {
    /** Space-separated CSS class list to append to `.pet-park-stage` ("" = none). */
    className: string;
    /** Extra ms to HOLD before the timeline advances past this beat (0 = none). */
    hitStopMs: number;
};

// Hit-stop durations (ms) by severity — the heavier the blow, the longer the
// freeze-frame. Tuned to read as a punch without stalling the fight.
const HITSTOP_KO = 220;
const HITSTOP_CRIT = 140;
const HITSTOP_HEAVY = 90;

/** True only for the contact beats that warrant a screen shake. */
function isShakeBeat(activeType?: string): boolean {
    return activeType === "impact" || activeType === "ko" || activeType === "screenShake";
}

/**
 * Hit-stop hold for a single animation-event type given the frame's severity.
 * Only the contact beat (impact) and a KO freeze; everything else flows. Pure
 * so the renderer can pre-sum holds across the queue to budget the timeline.
 */
export function petCameraHoldMs(
    activeType: PetBattleAnimationEventType | string | undefined,
    opts: { crit: boolean; signature: boolean; isKO: boolean; heavyHit: boolean },
): number {
    if (activeType === "ko" || opts.isKO) return HITSTOP_KO;
    if (activeType !== "impact") return 0;
    if (opts.crit || opts.signature) return HITSTOP_CRIT;
    if (opts.heavyHit) return HITSTOP_HEAVY;
    return 0;
}

/**
 * The stage camera treatment for the current beat. The signature wind-up
 * pushes in + dims (`battle-camera-focus`/`-background-dim`); contact beats get
 * a tiered IMPACT PUNCH — the `pet-stage-impact-{ko,crit,sig,hit}` keyframes
 * (scale-punch + shake + a touch of rotate) by severity — plus a hit-stop hold
 * on the heaviest blows. (Earlier this emitted the plainer translate-only
 * `battle-camera-shake-*`; the impact-punch set reads far more like a hit.)
 */
export function petBattleCamera(input: PetCameraInput): PetCameraState {
    if (input.resolved) return { className: "", hitStopMs: 0 };

    if (input.sigCharge) {
        return { className: "battle-camera-focus battle-background-dim", hitStopMs: 0 };
    }

    const hitStopMs = petCameraHoldMs(input.activeType, {
        crit: input.crit,
        signature: input.signature,
        isKO: input.isKO,
        heavyHit: input.heavyHit,
    });
    const shake = isShakeBeat(input.activeType);

    // Severity ladder: KO > crit > signature > merely-heavy. A KO punches even
    // if its beat isn't flagged a shake beat; the rest require the contact beat.
    if (input.isKO) return { className: "pet-stage-impact-ko", hitStopMs };
    if (shake && input.crit) return { className: "pet-stage-impact-crit", hitStopMs };
    if (shake && input.signature) return { className: "pet-stage-impact-sig", hitStopMs };
    if (shake && input.heavyHit) return { className: "pet-stage-impact-hit", hitStopMs };
    return { className: "", hitStopMs };
}
