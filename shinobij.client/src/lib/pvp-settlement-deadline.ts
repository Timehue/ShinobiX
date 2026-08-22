/**
 * How long the next stage of a PvP reward completion may hang.
 *
 * The completion runs up to three settlement callbacks and then the ACK, each
 * its own round trip. Two limits apply at once:
 *
 *  - per stage, so a slow-but-progressing settle is not charged for the sum of
 *    its parts (one 12s wall across all four turned a healthy mobile settle into
 *    a spurious "settlement failed"); and
 *  - across the phase, so a genuinely wedged completion cannot sit on "claiming"
 *    with exit disabled for four full stage budgets before Retry appears.
 *
 * Whichever is closer wins. A phase that has already overrun returns 0 — the
 * caller's timer then fires on the next tick rather than granting a fresh stage.
 */
export function settlementDeadlineMs(options: {
    /** When the completion phase began. */
    startedAt: number;
    now: number;
    /** Budget for a single stage. */
    perStageMs: number;
    /** Budget for the whole phase. */
    ceilingMs: number;
}): number {
    const { startedAt, now, perStageMs, ceilingMs } = options;
    const leftInPhase = ceilingMs - (now - startedAt);
    return Math.max(0, Math.min(perStageMs, leftInPhase));
}
