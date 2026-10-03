export type RallyQualitySample = { warmup: number; elapsed: number; frames: number; slowWindows: number; stalledFrames: number };
export const newRallyQualitySample = (): RallyQualitySample => ({ warmup: 0, elapsed: 0, frames: 0, slowWindows: 0, stalledFrames: 0 });
export const RALLY_ADAPTIVE_QUALITY_FPS = 48;

/** Two slow windows after warmup, or three consecutive active GPU stalls.
 * An isolated load spike and frames outside an active race never downgrade. */
export function sampleRallyQuality(sample: RallyQualitySample, delta: number, racing: boolean): boolean {
    if (!racing || !Number.isFinite(delta) || delta <= 0) {
        sample.elapsed = 0; sample.frames = 0; sample.slowWindows = 0;
        sample.stalledFrames = 0;
        return false;
    }
    if (delta > .5) {
        sample.elapsed = 0; sample.frames = 0; sample.slowWindows = 0;
        sample.stalledFrames = Math.min(3, sample.stalledFrames + 1);
        return sample.stalledFrames >= 3;
    }
    sample.stalledFrames = 0;
    sample.warmup += delta;
    if (sample.warmup < 2) return false;
    sample.elapsed += delta; sample.frames++;
    if (sample.elapsed < 2) return false;
    sample.slowWindows = sample.frames / sample.elapsed < RALLY_ADAPTIVE_QUALITY_FPS ? sample.slowWindows + 1 : 0;
    sample.elapsed = 0; sample.frames = 0;
    return sample.slowWindows >= 2;
}

export function rallyStartsLight(cores?: number, memoryGB?: number): boolean {
    return !!(cores && cores <= 4 || memoryGB && memoryGB <= 4);
}
