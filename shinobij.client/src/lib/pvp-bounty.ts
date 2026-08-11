/*
 * Client wrappers for the PvP bounty board (api/pvp/bounty.ts). Plain fetch
 * (auth headers are injected by the global authFetch interceptor) + the small
 * shapes the UI needs. The server is authoritative for the ryo escrow/payout;
 * the caller reflects the returned delta locally so the autosave converges.
 */

export type BountyEntry = { target: string; amount: number; contributors: string[]; updatedAt: number };

function newPlacementRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `bounty-${uuid}`;
    // Legacy WebViews without randomUUID still get a per-call identity. This is
    // generated ONCE outside the retry loop, so an ambiguous response can never
    // turn one click into a second escrow debit.
    return `bounty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

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
export async function placeBounty(playerName: string, target: string, amount: number): Promise<{ ok: boolean; error?: string; bounties?: BountyEntry[]; balances?: { ryo: number } }> {
    const requestId = newPlacementRequestId();
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const res = await fetch("/api/pvp/bounty", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "place", playerName, target, amount, requestId }),
            });
            const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; bounties?: BountyEntry[]; balances?: { ryo: number } };
            if (res.ok && data.ok) return { ok: true, bounties: data.bounties, balances: data.balances };
            if (attempt === 0 && res.status >= 500) continue;
            return { ok: false, error: data.error || "Could not place the bounty." };
        } catch {
            if (attempt === 0) continue;
        }
    }
    return { ok: false, error: "Could not place the bounty." };
}

// Claim any bounty on the player you just beat. Returns the payout, or null if
// there was none / it was voided (shared connection) / it errored — the caller
// only credits + notifies when a real amount comes back.
export async function claimBountyOnWin(playerName: string, battleId: string): Promise<{ amount: number; target: string; balances: { ryo: number } } | null> {
    try {
        const res = await fetch("/api/pvp/bounty", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "claim", playerName, battleId }),
        });
        const data = await res.json().catch(() => ({})) as { amount?: number; target?: string; balances?: { ryo: number } };
        return (data.amount ?? 0) > 0 && data.balances ? { amount: data.amount!, target: data.target ?? "your opponent", balances: data.balances } : null;
    } catch {
        return null;
    }
}

export async function startBountyHunter(playerName: string, hunterId: string): Promise<{ ok: boolean; error?: string; reason?: string; bounty?: BountyEntry }> {
    try {
        const res = await fetch("/api/pvp/bounty", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ai-hunter-start", playerName, hunterId }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; reason?: string; bounty?: BountyEntry };
        if (!res.ok || !data.ok) return { ok: false, error: data.error || "The hunter lost the trail.", reason: data.reason };
        return { ok: true, bounty: data.bounty };
    } catch {
        return { ok: false, error: "The hunter lost the trail." };
    }
}

// NOTE: there is no client "AI hunter collected the bounty" call. Losing to a
// server-spawned bounty hunter does NOT clear your bounty — only a real player
// beating you in a verified duel does (claimBountyOnWin above). The server
// ai-hunter-claim action is now a no-op kept for old clients; do not call it.
