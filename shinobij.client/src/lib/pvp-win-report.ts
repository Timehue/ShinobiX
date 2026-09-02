/*
 * Vanguard PvP-win report (api/missions/report-pvp-win.ts), called from the PvP
 * win completion in App.handlePvpWin.
 *
 * The server is authoritative: it re-validates the win against the real
 * PvpSession, applies its own anti-abuse rules, and feeds both Vanguard mission
 * progress and server-side Legacy tracking. This wrapper only decides which
 * failures may reject.
 *
 * That decision is load-bearing. The completion awaits every callback before it
 * may ACK, and a rejection lands on the result screen as "Battle settlement
 * callbacks did not finish. Please retry." with Retry as the forward control —
 * so rejecting on an answer that a retry cannot change is a permanent lockout,
 * not a timeout. Cf. the same rule in `pvp-bounty.ts`.
 */

export type PvpWinMissionCompletion = { id: string; name: string; xpReward: number };

/**
 * Decided refusals about THIS battle. The window mismatch is the reachable one:
 * report-pvp-win rejects a session older than 24h, and 404s once the live row
 * and its sealed recovery snapshot are both gone, while the reward receipt that
 * drives the replay lives 48h. A winner returning the next day therefore lands
 * here — and before this, threw and re-trapped themselves on the result screen.
 *
 * Deliberately NOT listed: 401 (a re-auth can still deliver it), 429 (the
 * endpoint allows 4/min, so mashing Retry throttles you and waiting clears it),
 * 503 `legacy-delivery-pending` (the endpoint's own explicit retry signal), and
 * every 5xx. Those can all come out differently on the next attempt, so they
 * keep rejecting rather than silently forfeiting real mission credit.
 */
const DECIDED_REFUSAL_STATUSES = new Set([400, 403, 404, 409]);

export async function reportPvpWin(
    request: { playerName: string; battleId: string; opponentName: string },
    signal: AbortSignal,
    fetchFn: typeof fetch = fetch,
): Promise<PvpWinMissionCompletion[]> {
    const response = await fetchFn('/api/missions/report-pvp-win', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
    });
    const data = await response.json().catch(() => ({})) as {
        error?: string;
        missionsCompleted?: PvpWinMissionCompletion[];
    };
    if (!response.ok) {
        if (DECIDED_REFUSAL_STATUSES.has(response.status)) return [];
        throw new Error(String(data?.error ?? `Mission settlement failed (HTTP ${response.status}).`));
    }
    return Array.isArray(data?.missionsCompleted) ? data.missionsCompleted : [];
}
