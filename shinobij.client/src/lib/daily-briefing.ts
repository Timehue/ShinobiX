/*
 * Daily Briefing data layer — the global world report (reads the polled war
 * caches) plus a re-export of the pure core (./daily-briefing-core). The modal
 * imports from here; tests import the core directly to avoid dragging the
 * cache/world-state graph.
 */
import { activeVillageWarsGlobal } from "./world-state";
import { sharedClanWarCache } from "./clan-war-api";

export interface WarLine {
    id: string;
    kind: "village" | "clan";
    left: string;
    right: string;
    note?: string;
}

/** Keep the briefing focused when several unrelated wars are live. */
export function briefingWarPriorities(lines: readonly WarLine[], village: string, clan: string): {
    featured: WarLine[]; remaining: number;
} {
    const belongsToPlayer = (line: WarLine) => {
        const home = line.kind === "village" ? village : clan;
        return !!home && [line.left, line.right].some((side) => side.toLowerCase() === home.toLowerCase());
    };
    const featured = lines.map((line, index) => ({ line, index }))
        .sort((a, b) => Number(belongsToPlayer(b.line)) - Number(belongsToPlayer(a.line)) || a.index - b.index)
        .slice(0, 3).map(({ line }) => line);
    return { featured, remaining: Math.max(0, lines.length - featured.length) };
}

/**
 * Every active war in the world — village-vs-village and clan-vs-clan — for the
 * briefing's world report, regardless of whether the player is involved. Reads
 * the caches App already keeps fresh (15s world-state, 30s clan-war polls).
 */
export function worldReport(now: number = Date.now()): WarLine[] {
    const lines: WarLine[] = [];

    for (const w of activeVillageWarsGlobal()) {
        const [a, b] = w.villages;
        const pending = w.pendingUntil && w.pendingUntil > now;
        lines.push({
            id: `vw-${w.id}`,
            kind: "village",
            left: a,
            right: b,
            note: pending ? "rallying" : `Sector ${w.warGroundSector}`,
        });
    }

    for (const w of Object.values(sharedClanWarCache)) {
        if (w.endedAt) continue;
        const [a, b] = w.clans;
        lines.push({ id: `cw-${w.id}`, kind: "clan", left: a, right: b });
    }

    return lines;
}
