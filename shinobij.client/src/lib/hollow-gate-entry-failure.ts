import { isChunkLoadError } from "./chunk-load-recovery";

/*
 * Hollow Gate entry is fired and forgotten from the world map
 * (`void enterHollowGateShrine(...)` in App). Every awaited step inside
 * lib/hollow-gate-entry.ts handles its own failure, but anything that still
 * escapes used to vanish as an unhandled rejection: the player pressed Descend
 * and nothing happened.
 *
 * The likeliest escape is a code chunk the browser failed to download. The
 * browser caches that failure for the life of the page, so pressing Descend
 * again cannot fetch it (lib/lazyWithRetry.ts). Only a reload can, which is why
 * both messages ask for one rather than a retry.
 */
const CHUNK_FAILED =
    "The Hollow Gate could not open because part of the game failed to download. Reload the page to continue. A run you already paid for resumes without spending another key.";
const UNEXPECTED =
    "The Hollow Gate could not open. Reload the page to continue. A run you already paid for resumes without spending another key.";

export function hollowGateEntryFailureMessage(error: unknown): string {
    return isChunkLoadError(error) ? CHUNK_FAILED : UNEXPECTED;
}

export function reportHollowGateEntryFailure(
    error: unknown,
    notify: (message: string) => void = (message) => { if (typeof window !== "undefined") window.alert(message); },
): void {
    notify(hollowGateEntryFailureMessage(error));
}
