/**
 * Hollow Gate run-shape contract shared by the browser and API.
 *
 * A standard dive is deliberately five floors. Event variants may shorten a
 * dive, but no client/admin value may widen the server payout or encounter
 * envelope beyond this constant.
 */
export const HOLLOW_GATE_DEPTH = 5;
export const HOLLOW_GATE_MIN_DEPTH = 1;
export const HOLLOW_HOUND_NAME = "Hollow Hound";
export const HOLLOW_HOUND_ALPHA_NAME = "Hollow Hound Alpha";

export type HollowGateHoundKind = "battle" | "elite" | "ambush" | "beast" | "boss";

/**
 * Canonical encounter identities used by both Arena PvE and Pet Coliseum.
 * Keeping this shared prevents a reconnect from replacing the creature the
 * player selected with a differently named server copy.
 */
export const HOLLOW_HOUND_FLOOR_NAMES = Object.freeze([
    "Ashfang Hollow Hound",
    "Veilrunner Hollow Hound",
    "Shrineback Hollow Hound",
    "Riftmaw Hollow Hound",
    "Alpha's Fang",
] as const);

export function canonicalHollowGateDepth(value?: unknown): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return HOLLOW_GATE_DEPTH;
    return Math.max(HOLLOW_GATE_MIN_DEPTH, Math.min(HOLLOW_GATE_DEPTH, parsed));
}

export function hollowGateHoundName(floorRaw: unknown, kind: HollowGateHoundKind = "beast"): string {
    if (kind === "boss") return HOLLOW_HOUND_ALPHA_NAME;
    const floor = canonicalHollowGateDepth(floorRaw);
    const base = HOLLOW_HOUND_FLOOR_NAMES[floor - 1] ?? HOLLOW_HOUND_NAME;
    if (kind === "elite") return `Elite ${base}`;
    if (kind === "ambush") return `Ambushing ${base}`;
    return base;
}
