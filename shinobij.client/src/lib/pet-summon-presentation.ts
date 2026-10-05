/** Beast Seal reinforcement cadence, shared by opening pet entrances. */
export const PET_SUMMON_SECONDS = 1.4;

export function petSummonPose(seconds: number) {
    const p = Math.max(0, Math.min(1, seconds / PET_SUMMON_SECONDS));
    const release = Math.max(0, Math.min(1, (p - .49) / .19));
    const ease = release * release * (3 - 2 * release);
    return {
        scale: Math.max(.02, ease),
        lift: .56 * (1 - ease) + Math.sin(Math.PI * ease) * .24,
        visible: p >= .49,
    };
}
