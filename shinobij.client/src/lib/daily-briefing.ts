/*
 * Daily Briefing data layer — the global world report (reads the polled war
 * caches) plus a re-export of the pure core (./daily-briefing-core). The modal
 * imports from here; tests import the core directly to avoid dragging the
 * cache/world-state graph.
 */
import { activeVillageWarsGlobal } from "./world-state";
import { sharedClanWarCache } from "./clan-war-api";

export * from "./daily-briefing-core";

export interface WarLine {
    id: string;
    kind: "village" | "clan";
    left: string;
    right: string;
    note?: string;
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
