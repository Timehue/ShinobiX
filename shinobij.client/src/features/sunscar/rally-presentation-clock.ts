/** Match the authored victory mixer, including on slow renderers. Keep this
 * free of 3D dependencies so the raster renderer can share the same clock. */
export const RALLY_FINISH_PRESENTATION_SECONDS = 2.5;

export function rallyPresentationDelta(delta: number): number {
    return Number.isFinite(delta) ? Math.max(0, Math.min(delta, .05)) : 0;
}

/** Only a displayed frame can advance the finish. Preparation and pauses keep
 * elapsed time intact, and replacing the renderer starts a fresh presentation. */
export function advanceRallyFinishPresentation(elapsed: number, delta: number, active: boolean): number {
    return active ? Math.min(RALLY_FINISH_PRESENTATION_SECONDS, elapsed + rallyPresentationDelta(delta)) : elapsed;
}
