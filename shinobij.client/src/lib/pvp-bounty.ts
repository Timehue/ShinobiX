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
export async function placeBounty(playerName: string, target: string, amount: number): Promise<{ ok: boolean; error?: string; bounties?: BountyEntry[]; balances?: { ryo: number } }> {
    try {
        const res = await fetch("/api/pvp/bounty", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "place", playerName, target, amount }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; bounties?: BountyEntry[]; balances?: { ryo: number } };
        if (!res.ok || !data.ok) return { ok: false, error: data.error || "Could not place the bounty." };
        return { ok: true, bounties: data.bounties, balances: data.balances };
    } catch {
        return { ok: false, error: "Could not place the bounty." };
    }
}

// Claim any bounty on the player you just beat. Returns the payout, or null if
// there was none / it was voided (shared connection). Transport and unexpected
// authorization failures throw so the durable PvP completion can retry them.
export async function claimBountyOnWin(
    playerName: string,
    battleId: string,
    signal?: AbortSignal,
    fetchFn: typeof fetch = fetch,
): Promise<{ amount: number; target: string; balances: { ryo: number } } | null> {
    const res = await fetchFn("/api/pvp/bounty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", playerName, battleId }),
        ...(signal ? { signal } : {}),
    });
    const data = await res.json().catch(() => ({})) as {
        error?: string;
        amount?: number;
        target?: string;
        balances?: { ryo: number };
    };
    // PvP completion awaits this promise before ACKing its durable callback
    // obligation. Propagate transport/abort ambiguity so a retry can replay the
    // battle-idempotent bounty claim instead of silently stranding it.
    // Rolling-deploy compatibility: older servers returned 403 when a bounty
    // payout was voided for a shared connection. That is a valid no-payout
    // outcome, not a failure of the battle settlement, so it must not prevent
    // the PvP completion ACK. Other authorization failures remain retryable.
    if (res.status === 403
        && data.error === "Bounty not paid: you and that player share a connection.") return null;
    if (!res.ok) throw new Error(data.error || `Bounty settlement failed (HTTP ${res.status}).`);
    return (data.amount ?? 0) > 0 && data.balances ? { amount: data.amount!, target: data.target ?? "your opponent", balances: data.balances } : null;
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
