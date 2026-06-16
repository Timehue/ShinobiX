/*
 * Client wrappers for the PvP bounty board (api/pvp/bounty.ts). Plain fetch
 * (auth headers are injected by the global authFetch interceptor) + the small
 * shapes the UI needs. The server is authoritative for the ryo escrow/payout;
 * the caller reflects the returned delta locally so the autosave converges.
 */

export type BountyEntry = { target: string; amount: number; contributors: string[]; updatedAt: number };

export async function fetchBountyBoard(): Promise<BountyEntry[]> {
    try {
        const res = await fetch("/api/pvp/bounty");
        const data = await res.json().catch(() => ({})) as { bounties?: BountyEntry[] };
        return Array.isArray(data.bounties) ? data.bounties : [];
    } catch {
        return [];
    }
}

// Escrow `amount` ryo onto `target`'s head. Returns the updated board on success
// (and the caller debits `amount` from its own ryo to converge), or an error.
export async function placeBounty(playerName: string, target: string, amount: number): Promise<{ ok: boolean; error?: string; bounties?: BountyEntry[] }> {
    try {
        const res = await fetch("/api/pvp/bounty", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "place", playerName, target, amount }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; bounties?: BountyEntry[] };
        if (!res.ok || !data.ok) return { ok: false, error: data.error || "Could not place the bounty." };
        return { ok: true, bounties: data.bounties };
    } catch {
        return { ok: false, error: "Could not place the bounty." };
    }
}

// Claim any bounty on the player you just beat. Returns the payout, or null if
// there was none / it was voided (shared connection) / it errored — the caller
// only credits + notifies when a real amount comes back.
export async function claimBountyOnWin(playerName: string, battleId: string): Promise<{ amount: number; target: string } | null> {
    try {
        const res = await fetch("/api/pvp/bounty", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "claim", playerName, battleId }),
        });
        const data = await res.json().catch(() => ({})) as { amount?: number; target?: string };
        return (data.amount ?? 0) > 0 ? { amount: data.amount!, target: data.target ?? "your opponent" } : null;
    } catch {
        return null;
    }
}
