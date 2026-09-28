import { serverNow } from "./server-clock";
import { setSharedBoostEventPayload, sharedBoostEventPayload } from "./world-state";
import { isBoostEventActive, sanitizeBoostEvent, type BoostEvent } from "../../../shared/boost-event";

// Kept apart from world-state.ts, which is in the startup bundle: only lazy
// screens (the banner, Training, the admin panel) import this, so the
// boost-event module stays out of the initial-graph gzip budget in
// scripts/check-build-size.mjs.

/** The running timed boost event, or null once it has ended. The server
 *  applies the boost; this copy only drives the banner and previews. It
 *  re-checks endsAt against the server clock, so a cached frame never shows
 *  an event that already ended. */
export function loadBoostEvent(nowMs: number = serverNow()): BoostEvent | null {
    const event = sanitizeBoostEvent(sharedBoostEventPayload());
    return isBoostEventActive(event, nowMs) ? event : null;
}

/** Adopt the event an admin just started or stopped, ahead of the next poll. */
export function setSharedBoostEvent(event: unknown): void {
    setSharedBoostEventPayload(sanitizeBoostEvent(event));
}
