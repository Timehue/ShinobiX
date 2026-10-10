// War Map mercenaries panel — the pure half (copy, grouping, retry rule), kept
// out of components/VillageWarMercPanel.tsx so it stays node-testable.
// Owner redesign 2026-10-08: a band is hired FOR one war (the village's all-out
// village war, or a Combat sector war it DEFENDS) and acts only there.

import { WarMapRequestError, type MercContextView, type MercLeaseView, type WrMercTierView } from "./village-war-map";

/** The rules, in two sentences the panel shows above the hire buttons. */
export const MERC_RULES_LINES: readonly string[] = [
    "A band is hired for one war and fights only in it. In your village's all-out war the Kage can hire 3 bands and each Elder 1; when an enemy attacks one of your Combat sectors, your Kage and Elders can hire 3 bands in all to defend it.",
    "A band hunts the enemy on its own for up to 2 days — a defending band patrols its sector, and your leaders can also send it at any attacker. A band win scores your defence in full; an attacker who beats one scores a quarter.",
];

export function mercContextTitle(c: Pick<MercContextView, "kind" | "enemy" | "sector">): string {
    return c.kind === "village" ? `Village war vs ${c.enemy}` : `Defending Sector ${c.sector ?? "?"} vs ${c.enemy}`;
}

/** "18h left", or "starts in 40m" for a village war still in its pre-war window. */
export function mercContextTime(c: Pick<MercContextView, "endsAt" | "startsAt">, now: number): string {
    if (c.startsAt && c.startsAt > now) return `starts in ${Math.max(1, Math.ceil((c.startsAt - now) / 60_000))}m`;
    const hours = Math.max(0, Math.ceil((c.endsAt - now) / 3_600_000));
    return `${hours}h left`;
}

const SEAT_NAMES: Record<string, string> = { kage: "Kage", "elder-1": "First Elder", "elder-2": "Second Elder", "elder-3": "Third Elder" };

/** How many hires this war has left, and how many are the viewer's. */
export function mercAllowanceLine(c: Pick<MercContextView, "kind" | "hiresUsed" | "hiresLimit" | "callerHiresLeft" | "seats">, canHire: boolean): string {
    const left = Math.max(0, c.hiresLimit - c.hiresUsed);
    if (c.kind === "sector") {
        return `${left} of ${c.hiresLimit} hires left for this sector war${canHire ? "" : " (Kage and Elders hire)"}.`;
    }
    const seats = (c.seats ?? []).map((s) => `${SEAT_NAMES[s.seat] ?? s.seat} ${Math.max(0, s.limit - s.used)}/${s.limit}`).join(" · ");
    const yours = canHire ? ` You can hire ${c.callerHiresLeft} more.` : "";
    return `${left} of ${c.hiresLimit} hires left this war${seats ? ` (${seats})` : ""}.${yours}`;
}

/** The price the server will actually charge (falls back to the base price for
 *  an older server that does not quote it). */
export function mercTierCost(t: Pick<WrMercTierView, "cost" | "costWr">): number {
    return Math.max(0, Math.floor(Number(t.cost ?? t.costWr) || 0));
}

export interface MercBandGroup {
    key: string;
    title: string;
    live: boolean;
    bands: MercLeaseView[];
}

/** The village's bands, grouped by the war they serve, in the panel's order:
 *  each hireable war first (as listed), then any band whose war is over or not
 *  live, then the legacy bands hired before wars were named. */
export function groupMercBands(leases: readonly MercLeaseView[], contexts: readonly Pick<MercContextView, "key" | "kind" | "enemy" | "sector">[]): MercBandGroup[] {
    const groups: MercBandGroup[] = contexts.map((c) => ({ key: c.key, title: mercContextTitle(c), live: true, bands: [] }));
    const byKey = new Map(groups.map((g) => [g.key, g]));
    const idle: MercBandGroup = { key: "idle", title: "Bands whose war is over", live: false, bands: [] };
    const legacy: MercBandGroup = { key: "legacy", title: "Earlier contracts (village wars only)", live: false, bands: [] };
    for (const lease of leases) {
        if (lease.count <= 0) continue;
        if (!lease.contextKey) { legacy.bands.push(lease); continue; }
        (byKey.get(lease.contextKey) ?? idle).bands.push(lease);
    }
    return [...groups, idle, legacy].filter((g) => g.bands.length > 0);
}

export function mercBandLine(lease: Pick<MercLeaseView, "tierId" | "count" | "expiresAt" | "live">, tierName: string, now: number): string {
    const hours = Math.max(0, Math.ceil((lease.expiresAt - now) / 3_600_000));
    const state = lease.live === false ? "waiting" : "hunting";
    return `${tierName} · ${lease.count} merc${lease.count === 1 ? "" : "s"} · ${state} · ${hours}h left`;
}

/** Whether a failed hire may be retried WITH THE SAME request id: the request
 *  may never have arrived (network) or the server could not say (5xx). Either
 *  way a retry is a replay at worst. A refusal (4xx) is final. */
export function isRetryableMercError(error: unknown): boolean {
    if (error instanceof WarMapRequestError) return error.status >= 500;
    return error instanceof TypeError || (error instanceof DOMException && error.name !== "AbortError");
}

/** Run `fn` (a hire with a FIXED request id) and retry it on a retryable error. */
export async function withMercRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 600, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await wait(delayMs * attempt);
        try {
            return await fn();
        } catch (error) {
            last = error;
            if (!isRetryableMercError(error)) throw error;
        }
    }
    throw last;
}
