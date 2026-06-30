/*
 * Client helpers for the server-authoritative Hollow Gate run (the server side
 * lives in api/hollow-gate/{start,choose-augment,settle}.ts). Thin fetch
 * wrappers in the same style as lib/player-api.ts — the client posts only the
 * token + a provisional haul; the server seals the entry snapshot + augment
 * multiplier and credits min(claimed, ceiling).
 *
 * GATED OFF by default: isHollowGateServerAuthEnabled() reads a localStorage
 * flag, so the existing client run path stays the default until this is
 * deliberately enabled (token-first invariant — the no-token path must keep
 * working). The App.tsx run loop will branch on the flag in a follow-up pass.
 *
 * Nothing imports this yet, so it is tree-shaken out of the bundle (no client
 * dist change) until the integration lands.
 */

const SERVER_AUTH_FLAG = "hollowGateServerAuth.v1";

/** True when the server-authoritative HG path is enabled (default OFF). */
export function isHollowGateServerAuthEnabled(): boolean {
    try { return localStorage.getItem(SERVER_AUTH_FLAG) === "1"; } catch { return false; }
}

export interface HollowGateAugmentOffer {
    id: string;
    label: string;
    description: string;
    rarity: "common" | "rare";
    riskLabel?: string;
    combat?: { kind: string; value: number };
}

export interface HollowGateStartResult {
    ok: true;
    token: string;
    seed: string;
    augmentOffers: HollowGateAugmentOffer[];
}

export type HollowGateStartOutcome =
    | HollowGateStartResult
    | { ok: true; reason: "daily-cap" | "no-key"; token: null }
    | null; // network/auth failure → caller falls back to the legacy path

/** Mint a sealed run token + roll the 3 augment offers. `floorDepth` is the run's
 *  max depth (bounds the server reward ceiling). */
export async function postHollowGateStart(playerName: string, floorDepth: number): Promise<HollowGateStartOutcome> {
    try {
        const res = await fetch("/api/hollow-gate/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, floorDepth }),
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null) as (HollowGateStartResult & { reason?: string; token: string | null }) | null;
        if (!data || !data.ok) return null;
        if (!data.token) return { ok: true, reason: (data.reason as "daily-cap" | "no-key") ?? "daily-cap", token: null };
        return { ok: true, token: data.token, seed: data.seed, augmentOffers: Array.isArray(data.augmentOffers) ? data.augmentOffers : [] };
    } catch { return null; }
}

/** Seal the player's augment pick (must be one the server offered). */
export async function postHollowGateChooseAugment(playerName: string, token: string, augmentId: string): Promise<{ chosenAugmentId: string } | null> {
    try {
        const res = await fetch("/api/hollow-gate/choose-augment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, augmentId }),
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null) as { ok?: boolean; chosenAugmentId?: string } | null;
        return data?.ok && data.chosenAugmentId ? { chosenAugmentId: data.chosenAugmentId } : null;
    } catch { return null; }
}

/** Authoritative payout. `haul` is the provisional per-currency amount the run
 *  earned (current − entry); the server clamps it to the sealed ceiling and
 *  returns the credited deltas to reconcile onto the local character. */
export async function postHollowGateSettle(
    playerName: string,
    token: string,
    outcome: "extract" | "death",
    haul: Record<string, number>,
): Promise<{ credited: Record<string, number> } | null> {
    try {
        const res = await fetch("/api/hollow-gate/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, outcome, haul }),
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null) as { ok?: boolean; credited?: Record<string, number> } | null;
        return data?.ok ? { credited: data.credited ?? {} } : null;
    } catch { return null; }
}
