/*
 * Sector scars — the ground remembers what happened on it.
 *
 * The traces layer already records that people PASSED through a sector
 * (footfall) and what they chose to SAY there (trail signs). This is the third
 * thing a shared world should remember: that a fight happened, who walked away
 * from it, and how long ago. Walk into a sector an hour after a duel and the
 * board tells you, which is the difference between a location and a place.
 *
 * Pure and storage-free, like the rest of the trace logic: the shapes, the
 * pruning and the wording live here so client and server word a scar
 * identically; `api/_sector-scars.ts` owns the KV row and the write.
 *
 * Deliberately small: a scar is a rumour, not a ledger. It carries names and an
 * instant — nothing a viewer could not already see in the sector at the time —
 * it expires on its own, and nothing anywhere reads it back to decide anything.
 * It is a display record, so it can never become a balance input.
 */

export type SectorScarKind = "duel";

export type SectorScar = {
    kind: SectorScarKind;
    /** Who walked away. Display name, as stored on the session. */
    victor: string;
    /** Who did not. Empty when the outcome had no loser (a draw). */
    fallen: string;
    /** Server instant the fight settled. */
    at: number;
};

/** How many scars one sector keeps. Oldest falls off first. */
export const MAX_SCARS_PER_SECTOR = 6;
/** A scar fades after a day — long enough to matter, short enough to stay news. */
export const SCAR_TTL_MS = 24 * 60 * 60 * 1000;

function cleanName(value: unknown): string {
    return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

/** Parse an unknown KV value into scars, dropping anything malformed. */
export function parseScars(value: unknown): SectorScar[] {
    if (!Array.isArray(value)) return [];
    const out: SectorScar[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const raw = entry as Record<string, unknown>;
        const victor = cleanName(raw.victor);
        const at = Math.floor(Number(raw.at) || 0);
        if (!victor || at <= 0 || raw.kind !== "duel") continue;
        out.push({ kind: "duel", victor, fallen: cleanName(raw.fallen), at });
    }
    return out;
}

/*
 * `now` defaults on the read helpers so a renderer can call them without a
 * clock read of its own — reading Date.now() inside a component body is impure
 * and the lint rule rejects it (the same reason this file's sibling `timeAgo`
 * in SectorTraces.tsx takes a defaulted `now`). Callers that need a fixed
 * instant, like the server, still pass one.
 */

/** Newest first, expired dropped, capped. The one place ordering is decided. */
export function pruneScars(scars: readonly SectorScar[], now: number = Date.now()): SectorScar[] {
    return [...scars]
        .filter((scar) => now - scar.at < SCAR_TTL_MS)
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_SCARS_PER_SECTOR);
}

/**
 * Add a scar and re-prune.
 *
 * A victor may only hold ONE scar in a sector at a time — the newest replaces
 * their older one. Without that, a player farming the same opponent in one
 * sector fills all six slots with themselves and the board stops being a
 * record of what happened there.
 */
export function withScar(scars: readonly SectorScar[], scar: SectorScar, now: number): SectorScar[] {
    const key = scar.victor.toLowerCase();
    return pruneScars([scar, ...scars.filter((existing) => existing.victor.toLowerCase() !== key)], now);
}

/** How long ago, in the coarse terms a rumour is told in. */
export function scarAgeLabel(scar: SectorScar, now: number = Date.now()): string {
    const minutes = Math.max(0, Math.floor((now - scar.at) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

/** One line of the board. Client and server say it the same way. */
export function scarLine(scar: SectorScar): string {
    return scar.fallen
        ? `${scar.victor} stood over ${scar.fallen}`
        : `${scar.victor} walked away from a duel`;
}
