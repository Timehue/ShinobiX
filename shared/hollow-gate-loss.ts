/** Chronicle and pet defeats spend max HP, but never kill a living diver. */
export const HOLLOW_GATE_LOSS_HP_PERCENT = 33;

export function hollowGateLossHp(hp: unknown, maxHp: unknown): number {
    const current = Math.max(0, Math.floor(Number(hp) || 0));
    if (current === 0) return 0; // A stale result must never revive a defeated diver.
    const maximum = Math.max(1, Math.floor(Number(maxHp) || 1));
    return Math.max(1, current - Math.max(1, Math.floor(maximum * HOLLOW_GATE_LOSS_HP_PERCENT / 100)));
}
