export type VnTypedState = { key: string; count: number };

/**
 * Keep typewriter progress monotonic for the active line. A timer tick can be
 * queued immediately before the player taps to reveal the complete line; that
 * stale tick must never replace the completed count with an earlier count.
 */
export function advanceVnTypewriter(
    current: VnTypedState,
    key: string,
    timerCount: number,
    lineLength: number,
): VnTypedState {
    if (current.key === key && current.count >= lineLength) return current;
    const currentCount = current.key === key ? current.count : 0;
    return {
        key,
        count: Math.min(lineLength, Math.max(currentCount, timerCount)),
    };
}
