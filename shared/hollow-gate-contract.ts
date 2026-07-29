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

/** Approved roster mesh used only as the Hollow Hound's rig source. */
export const HOLLOW_HOUND_MODEL_SOURCE_ID = "mythic-4";

/**
 * Hollow Hounds must not reuse the owned-pet `<roster-id>-<timestamp>` shape.
 * Both browser and API consume this namespace so visual treatment, PvE routing,
 * and server sealing agree on the creature's identity.
 */
export const HOLLOW_HOUND_ENCOUNTER_ID_PREFIX = "hollow-hound-encounter";
const HOLLOW_HOUND_ENCOUNTER_ID_PATTERN = /^hollow-hound-encounter-\d{10,}$/;
const LEGACY_HOLLOW_HOUND_ENCOUNTER_ID_PATTERN = /^mythic-4-\d{10,}$/;
const HOLLOW_HOUND_ENCOUNTER_NAMES: ReadonlySet<string> = new Set([
    HOLLOW_HOUND_NAME,
    HOLLOW_HOUND_ALPHA_NAME,
    ...HOLLOW_HOUND_FLOOR_NAMES,
    ...HOLLOW_HOUND_FLOOR_NAMES.map((name) => `Elite ${name}`),
    ...HOLLOW_HOUND_FLOOR_NAMES.map((name) => `Ambushing ${name}`),
]);

export function hollowHoundEncounterId(encounterId: number): string {
    const normalized = Number.isFinite(encounterId) ? Math.max(0, Math.floor(encounterId)) : 0;
    return `${HOLLOW_HOUND_ENCOUNTER_ID_PREFIX}-${String(normalized).padStart(10, "0")}`;
}

export function isHollowHoundEncounterId(id: string): boolean {
    return HOLLOW_HOUND_ENCOUNTER_ID_PATTERN.test(id);
}

export function isHollowHoundEncounterPet(pet: { id: string; name: string } | null | undefined): boolean {
    if (!pet) return false;
    if (isHollowHoundEncounterId(pet.id)) return true;

    // Compatibility for encounters sealed before the dedicated namespace. A
    // name gate is mandatory because owned Oni Hounds share this old ID shape.
    return LEGACY_HOLLOW_HOUND_ENCOUNTER_ID_PATTERN.test(pet.id)
        && HOLLOW_HOUND_ENCOUNTER_NAMES.has(pet.name);
}

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
