/**
 * Sector traces client — footfall, trail signs and shrine offerings.
 *
 * Thin fetch wrappers over /api/sector/traces, /api/sector/trail-sign and
 * /api/sector/shrine-offer (auth headers are injected globally by authFetch).
 * Feature-flagged with the standard default-ON kill switch: set
 * localStorage["sectorTraces.v1"] = "off" to hide the whole surface.
 */

export type TrailSignView = {
    id: string;
    name: string;
    tile: number;
    text: string;
    at: number;
    sparks: number;
};

export type ShrineOfferingView = { name: string; amount: number };

export type ShrineView = {
    id: string;
    name: string;
    region: string;
    blessing: string;
    tier: number;
    total: number;
    weekTotal: number;
    topWeek: ShrineOfferingView[];
    lastWeek: { week: string; topWeek: ShrineOfferingView[] } | null;
};

export type SectorTracesView = {
    sector: number;
    footfallToday: number;
    signs: TrailSignView[];
    mySparked: string[];
    shrine?: ShrineView;
};

export function isSectorTracesEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("sectorTraces.v1") !== "off"; } catch { return true; }
}

export async function fetchSectorTraces(sector: number, player?: string): Promise<SectorTracesView | null> {
    try {
        const params = new URLSearchParams({ sector: String(sector) });
        if (player) params.set("player", player);
        const res = await fetch(`/api/sector/traces?${params}`, { method: "GET" });
        if (!res.ok) return null;
        const data = await res.json() as SectorTracesView & { ok?: boolean };
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

export type TrailSignPostResult =
    | { ok: true; signs: TrailSignView[] }
    | { ok: false; message: string };

export async function leaveTrailSign(playerName: string, sector: number, tile: number, text: string): Promise<TrailSignPostResult> {
    try {
        const res = await fetch("/api/sector/trail-sign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, sector, tile, text }),
        });
        const data = await res.json() as { ok?: boolean; reason?: string; error?: string; signs?: TrailSignView[] };
        if (data.ok && data.signs) return { ok: true, signs: data.signs };
        if (data.reason === "daily-cap") return { ok: false, message: "You've posted enough signs for today — the trail needs room for others." };
        return { ok: false, message: data.error ?? "The sign wouldn't take." };
    } catch {
        return { ok: false, message: "Couldn't reach the trail post." };
    }
}

export async function sparkTrailSign(playerName: string, sector: number, signId: string): Promise<{ ok: boolean; sparks?: number }> {
    try {
        const res = await fetch("/api/sector/trail-sign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, sector, action: "spark", signId }),
        });
        const data = await res.json() as { ok?: boolean; sparks?: number };
        return { ok: !!data.ok, sparks: data.sparks };
    } catch {
        return { ok: false };
    }
}

export type ShrineOfferResult =
    | { ok: true; ryo: number; shrine: ShrineView }
    | { ok: false; message: string };

export async function offerAtShrine(playerName: string, shrineId: string, amount: number): Promise<ShrineOfferResult> {
    try {
        const res = await fetch("/api/sector/shrine-offer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, shrineId, amount }),
        });
        const data = await res.json() as { ok?: boolean; error?: string; ryo?: number; shrine?: ShrineView };
        if (data.ok && data.shrine && typeof data.ryo === "number") return { ok: true, ryo: data.ryo, shrine: data.shrine };
        return { ok: false, message: data.error ?? "The offering was not accepted." };
    } catch {
        return { ok: false, message: "Couldn't reach the shrine." };
    }
}
