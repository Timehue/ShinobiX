import type { Character } from "../types/character";
import { SERVER_OWNED_CHARACTER_FIELDS } from "./save-ownership";

function equal(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

// These values move together. Preserve a pending edit only if its authoritative
// dependencies have not changed; otherwise the existing recovery draft owns it.
const GROUPS = [
    ["inventory", "itemStacks", "equipment"],
    ["equippedJutsuIds", "jutsuMastery", "elements", "bloodline", "patreon", "legacy"],
    ["activePetId", "activePetId2v2", "pets"],
    ["savedTileDeck", "cardClashDeck", "tileCards"],
    ["stats", "unspentStats"],
    ["hp", "chakra", "stamina", "hospitalized", "hospitalizedUntil", "hospitalizedAt", "lastDischargeAt"],
] as const;

/** Three-way adoption for daily claims. The baseline is an accepted load/write,
 * not the character at click time: an edit may already be waiting for autosave. */
export function reconcileDailyLoginCharacter(baseline: Character, local: Character, server: Character): {
    character: Character;
    conflicts: string[];
} {
    const base = baseline as unknown as Record<string, unknown>;
    const current = local as unknown as Record<string, unknown>;
    const authoritative = server as unknown as Record<string, unknown>;
    const merged = { ...authoritative };
    const conflicts: string[] = [];
    // A pending allocation can coexist with a newly earned pool grant.
    // Rebase only a conserved, spend-only allocation; never infer a refund.
    const statKeys = Object.keys(baseline.stats);
    const allocations = statKeys.map(key => Number(local.stats[key as keyof Character["stats"]])
        - Number(baseline.stats[key as keyof Character["stats"]]));
    const allocated = allocations.reduce((sum, value) => sum + value, 0);
    const canRebaseAllocation = allocated > 0
        && equal(server.stats, baseline.stats)
        && allocations.every(value => Number.isSafeInteger(value) && value >= 0)
        && Number(baseline.unspentStats) - Number(local.unspentStats) === allocated
        && Number.isSafeInteger(server.unspentStats) && Number(server.unspentStats) >= allocated
        && statKeys.every(key => Number.isSafeInteger(server.stats[key as keyof Character["stats"]]));
    if (canRebaseAllocation) {
        merged.stats = Object.fromEntries(statKeys.map((key, index) =>
            [key, Number(server.stats[key as keyof Character["stats"]]) + allocations[index]]));
        merged.unspentStats = Number(server.unspentStats) - allocated;
    }
    for (const key of new Set([...Object.keys(base), ...Object.keys(current)])) {
        // Stats/pool are allocated locally from an already earned entitlement.
        // All currency, receipt, grant and identity authority stays on the server.
        if (key === "name" || key === "customTitleStyle" || key === "customTitleIcon"
            || (SERVER_OWNED_CHARACTER_FIELDS.has(key) && key !== "stats" && key !== "unspentStats")) continue;
        if ((canRebaseAllocation || equal(server.stats, local.stats))
            && (key === "stats" || key === "unspentStats")) continue;
        if (equal(current[key], base[key]) || equal(current[key], authoritative[key])) continue;
        const group = GROUPS.find(fields => (fields as readonly string[]).includes(key));
        if (!equal(authoritative[key], base[key])
            || group?.some(field => !equal(authoritative[field], base[field]))) {
            conflicts.push(key);
            continue;
        }
        if (Object.hasOwn(current, key)) merged[key] = current[key];
        else delete merged[key]; // Clearing/unequipping is a real pending edit.
    }
    return { character: merged as unknown as Character, conflicts };
}
