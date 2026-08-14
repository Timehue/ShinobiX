import type { PvpWinBaseSummary } from "./progression";
import type { Character } from "../types/character";

export type PvpRewardRating = { field: string; value: number; delta: number };
export type PvpRaidProgression = {
    fetchMissionsCredited: string[];
    missionsCompleted: Array<{ id: string; name: string; xpReward: number }>;
    xpAwarded: number;
    bonusRyo: number;
    bonusSeals: number;
    territoryDamage: number;
    sector: number | null;
    replayed: boolean;
};

export type PvpRewardClaimConfirmed = {
    status: "confirmed";
    alreadyClaimed: boolean;
    /** Server proof that this was a sanctioned, mutually joined match. */
    rewardAuthorized: boolean;
    rating?: PvpRewardRating;
    base?: PvpWinBaseSummary;
    character?: Character;
    _saveVersion?: number;
    raidProgression?: PvpRaidProgression;
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

function cleanRaidProgression(raw: unknown): PvpRaidProgression | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    const fetchMissionsCredited = Array.isArray(value.fetchMissionsCredited)
        ? Array.from(new Set(value.fetchMissionsCredited.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)))
        : [];
    const missionsCompleted = Array.isArray(value.missionsCompleted)
        ? value.missionsCompleted.filter((mission): mission is { id: string; name: string; xpReward: number } => !!mission
            && typeof mission === "object"
            && typeof (mission as Record<string, unknown>).id === "string"
            && typeof (mission as Record<string, unknown>).name === "string"
            && Number.isFinite(Number((mission as Record<string, unknown>).xpReward)))
            .map((mission) => ({ ...mission, xpReward: Number(mission.xpReward) }))
        : [];
    const sectorValue = Number(value.sector);
    return {
        fetchMissionsCredited,
        missionsCompleted,
        xpAwarded: Math.max(0, Number(value.xpAwarded) || 0),
        bonusRyo: Math.max(0, Number(value.bonusRyo) || 0),
        bonusSeals: Math.max(0, Number(value.bonusSeals) || 0),
        territoryDamage: Math.max(0, Number(value.territoryDamage) || 0),
        sector: Number.isSafeInteger(sectorValue) ? Math.floor(sectorValue) : null,
        replayed: value.replayed === true,
    };
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
        const rating = cleanRating(payload.rating);
        const base = payload.base && typeof payload.base === "object" ? payload.base as PvpWinBaseSummary : undefined;
        const character = payload.character && typeof payload.character === "object"
            ? payload.character as Character
            : undefined;
        const saveVersion = Number(payload._saveVersion);
        const raidProgression = cleanRaidProgression(payload.raidProgression);
        return {
            status: "confirmed",
            alreadyClaimed: payload.alreadyClaimed === true,
            // Older servers did not return the explicit bit; a signed base/rating
            // settlement is itself authoritative during a rolling deployment.
            rewardAuthorized: payload.rewardAuthorized === true || !!rating || !!base,
            ...(rating ? { rating } : {}),
            ...(base ? { base } : {}),
            ...(character ? { character } : {}),
            ...(Number.isFinite(saveVersion) ? { _saveVersion: saveVersion } : {}),
            ...(raidProgression ? { raidProgression } : {}),
        };
    } catch {
        return {
            status: "retry",
            message: "Could not reach the reward service. Your battle result is safe; retry to apply rewards.",
        };
    }
}
