import type { PvpWinBaseSummary } from "./progression";

export type PvpRewardRating = { field: string; value: number; delta: number };

export type PvpRewardClaimConfirmed = {
    status: "confirmed";
    alreadyClaimed: boolean;
    rating?: PvpRewardRating;
    base?: PvpWinBaseSummary;
};

export type PvpRewardClaimRetry = {
    status: "retry";
    message: string;
};

export type PvpRewardClaimResult = PvpRewardClaimConfirmed | PvpRewardClaimRetry;

type ClaimResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
};

type ClaimFetch = (input: string, init: RequestInit) => Promise<ClaimResponse>;

function cleanRating(raw: unknown): PvpRewardRating | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    if (typeof value.field !== "string"
        || !Number.isFinite(Number(value.value))
        || !Number.isFinite(Number(value.delta))) return undefined;
    return { field: value.field, value: Number(value.value), delta: Number(value.delta) };
}

/**
 * Submit the authoritative reward claim. Only an explicit HTTP success carrying
 * `{ ok: true }` is permission to apply local outcome callbacks. Every ambiguous
 * result remains retryable and must leave the replay latch untouched.
 */
export async function postPvpRewardClaim(
    fetchClaim: ClaimFetch,
    request: { playerName: string; battleId: string; outcome: "win" | "loss" },
): Promise<PvpRewardClaimResult> {
    try {
        const response = await fetchClaim("/api/pvp/claim-rewards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
        });
        const body = await response.json().catch(() => null);
        const payload = body && typeof body === "object" ? body as Record<string, unknown> : null;
        if (!response.ok || payload?.ok !== true) {
            const serverError = typeof payload?.error === "string" ? payload.error.trim() : "";
            return {
                status: "retry",
                message: serverError || `Reward verification failed (HTTP ${response.status}). Please retry.`,
            };
        }
        return {
            status: "confirmed",
            alreadyClaimed: payload.alreadyClaimed === true,
            ...(cleanRating(payload.rating) ? { rating: cleanRating(payload.rating) } : {}),
            ...(payload.base && typeof payload.base === "object" ? { base: payload.base as PvpWinBaseSummary } : {}),
        };
    } catch {
        return {
            status: "retry",
            message: "Could not reach the reward service. Your battle result is safe; retry to apply rewards.",
        };
    }
}
