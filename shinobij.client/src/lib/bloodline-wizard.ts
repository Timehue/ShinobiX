/*
 * Bloodline Maker wizard — the pure step model for the staged builder.
 *
 * The Awakening Stone (CentralHub) already hands the maker a locked rank; the
 * maker then walks the player through, one screen at a time:
 *   step 0           → bloodline details (name / lore / element / offense / image)
 *   steps 1..N       → one jutsu each, N = jutsuCountForRank(rank) (B 4, A/S 5)
 *   final step       → review & save
 *
 * Kept pure (no React) so the screen stays thin and the step math is unit-tested.
 */

import { jutsuCountForRank } from "./jutsu-points";
import type { Rank } from "../types/core";

export type WizardStepKind = "details" | "jutsu" | "review";

/** Total wizard steps: details + one per jutsu + review. */
export function bloodlineWizardStepCount(rank: Rank): number {
    return 1 + jutsuCountForRank(rank) + 1;
}

/** What kind of step `step` (0-based) is. */
export function bloodlineWizardStepKind(step: number, rank: Rank): WizardStepKind {
    if (step <= 0) return "details";
    if (step >= bloodlineWizardStepCount(rank) - 1) return "review";
    return "jutsu";
}

/** Jutsu index a "jutsu" step edits, or -1 for the details / review steps. */
export function bloodlineWizardJutsuIndex(step: number, rank: Rank): number {
    return bloodlineWizardStepKind(step, rank) === "jutsu" ? step - 1 : -1;
}

/** Short label for the step indicator / header. */
export function bloodlineWizardStepLabel(step: number, rank: Rank): string {
    const kind = bloodlineWizardStepKind(step, rank);
    if (kind === "details") return "Details";
    if (kind === "review") return "Review";
    return `Jutsu ${bloodlineWizardJutsuIndex(step, rank) + 1}`;
}

/** Whether the details step is filled in enough to advance. */
export function canLeaveBloodlineDetails(name: string): boolean {
    return name.trim().length > 0;
}

/** Clamp a step index into the valid range for a rank (used when rank changes). */
export function clampBloodlineWizardStep(step: number, rank: Rank): number {
    const max = bloodlineWizardStepCount(rank) - 1;
    return Math.max(0, Math.min(step, max));
}
