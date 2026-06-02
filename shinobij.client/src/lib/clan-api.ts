/*
 * Clan save/load network helpers — read/write a clan document via the
 * /api/save endpoint, plus the village-guard queue POST. Thin fetch wrappers
 * with no dependency on App state. Extracted verbatim from App.tsx; App.tsx
 * imports them back (all five were App-local, never on the "../App" surface).
 */

import type { ClanData } from "../types/clan";

export function clanSlug(name: string): string {
    return "clan-" + name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
export async function fetchClanData(name: string): Promise<ClanData | null> {
    try {
        const res = await fetch(`/api/save/${clanSlug(name)}`);
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}
// Same as fetchClanData but tells the caller whether the failure was a
// definitive "clan doesn't exist" (HTTP 404) or just a transient network /
// auth error. The Clan Hall uses this to auto-clear a player's stale clan
// reference when the clan was wiped (e.g. by a server reset) while leaving
// transient failures alone so the player isn't booted by a flaky request.
export async function fetchClanDataDetailed(name: string): Promise<{ ok: true; data: ClanData } | { ok: false; reason: "notFound" | "error" }> {
    try {
        const res = await fetch(`/api/save/${clanSlug(name)}`);
        if (res.status === 404) return { ok: false, reason: "notFound" };
        if (!res.ok) return { ok: false, reason: "error" };
        const data = await res.json() as ClanData;
        return { ok: true, data };
    } catch {
        return { ok: false, reason: "error" };
    }
}
export async function writeClanData(data: ClanData): Promise<void> {
    await fetch(`/api/save/${clanSlug(data.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
}
export async function postGuardQueue(action: "queue" | "dequeue", payload: object): Promise<void> {
    await fetch(`/api/village-guard/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).catch(() => { });
}
