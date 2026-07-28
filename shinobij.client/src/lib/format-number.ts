/*
 * Number presentation, one rule for the whole UI.
 *
 * Two conventions had grown up side by side, and they met inside the SAME mobile HUD
 * strip: HP / chakra / stamina / XP rendered raw (`48291`) while every currency used
 * `toLocaleString()` (`1,204,880`). So one line read `HP 48291/52400` and the line two
 * rows below read `Ryo 1,204,880`.
 *
 * There was also no abbreviation anywhere, which is a real layout risk rather than a
 * cosmetic one: `.mthd-bar-label` is a narrow overlay on the resource bars, and
 * six-digit values overflow it once late-game pools scale up (HP_CAP is 10,000, and
 * 10,000 with combatResourcesV2).
 *
 * The rule:
 *   • `formatCompact` — anything rendered INSIDE a constrained chip, bar, or badge.
 *     Stays plain digits below 10,000 so existing layouts keep their exact widths, and
 *     only switches to k/m where the raw value would have overflowed.
 *   • `formatExact`   — tooltips, `title` attributes, and anywhere the precise figure
 *     matters (a player checking whether they can afford something).
 *
 * Both coerce defensively: these render live save data, and a missing or malformed
 * field must show `0`, never `NaN`.
 */

/** Round to at most one decimal and drop a trailing `.0`. */
function oneDecimal(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Space-constrained display: `9999`, `12.3k`, `1.2m`.
 *
 * Below 10,000 the value is returned as plain digits WITHOUT grouping separators —
 * adding commas here would widen every existing bar label and badge for no benefit.
 */
export function formatCompact(value: unknown): string {
    const n = Math.trunc(Number(value) || 0);
    const abs = Math.abs(n);
    if (abs < 10_000) return String(n);
    if (abs < 1_000_000) return `${oneDecimal(n / 1_000)}k`;
    return `${oneDecimal(n / 1_000_000)}m`;
}

/** Exact display with locale grouping: `1,204,880`. For tooltips and precise reads. */
export function formatExact(value: unknown): string {
    return Math.trunc(Number(value) || 0).toLocaleString();
}

/** `current/max` for a resource bar or badge, both sides compact. */
export function formatRatio(current: unknown, max: unknown): string {
    return `${formatCompact(current)}/${formatCompact(max)}`;
}
