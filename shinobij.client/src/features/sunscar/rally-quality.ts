export type RallyQualitySample = { warmup: number; elapsed: number; frames: number; slowWindows: number };
export const newRallyQualitySample = (): RallyQualitySample => ({ warmup: 0, elapsed: 0, frames: 0, slowWindows: 0 });

/** Two sustained slow windows after warmup; pause/load spikes do not count. */
export function sampleRallyQuality(sample: RallyQualitySample, delta: number, racing: boolean): boolean {
    if (!racing || !Number.isFinite(delta) || delta <= 0 || delta > .5) {
        sample.elapsed = 0; sample.frames = 0; sample.slowWindows = 0;
        return false;
    }
    sample.warmup += delta;
    if (sample.warmup < 2) return false;
    sample.elapsed += delta; sample.frames++;
    if (sample.elapsed < 2) return false;
    sample.slowWindows = sample.frames / sample.elapsed < 42 ? sample.slowWindows + 1 : 0;
    sample.elapsed = 0; sample.frames = 0;
    return sample.slowWindows >= 2;
}

export function rallyStartsLight(cores?: number, memoryGB?: number): boolean {
    return !!(cores && cores <= 4 || memoryGB && memoryGB <= 4);
}
