import type { PvpWinBaseSummary } from "./progression";
import type { Character } from "../types/character";
import { playerSlug } from "./utils";

export type PvpRewardRating = { field: string; value: number; delta: number };
export type ClanWarScrollDrop = { awarded: 0 | 1; chancePercent: number };
export type PvpWarPoints = { awarded: number; kind: "clan" | "sector" };
export type PvpWarGroundReward = {
    fresh: boolean;
    bountyCredited: boolean;
    raidProgress: number;
    ryoAwarded: number;
    fateShardsAwarded: number;
};
export type PvpBattleRewardSummary = {
    ryo: number;
    combatGrowth: number;
    professionXp: number;
    auraDust: number;
    fateShards: number;
    honorSeals: number;
    territoryScrolls: number;
    warPoints: number;
    warPointKind?: PvpWarPoints["kind"];
    ratingDelta?: number;
};
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
    /** Durable server receipt says App completion still needs acknowledgement. */
    completionPending: boolean;
    /** Server proof that this was a sanctioned, mutually joined match. */
    rewardAuthorized: boolean;
    /** Stronger server proof that this match may feed generic progression. */
    progressionAuthorized: boolean;
    rating?: PvpRewardRating;
    base?: PvpWinBaseSummary;
    character?: Character;
    _saveVersion?: number;
    raidProgression?: PvpRaidProgression;
    warPoints?: PvpWarPoints;
    warGroundReward?: PvpWarGroundReward;
    /** Present only for the winning player in a settled Clan War shinobi duel. */
    clanWarScrollDrop?: ClanWarScrollDrop;
};

export type PvpRewardClaimRetry = {
    status: "retry";
    message: string;
};

export type PvpRewardClaimResult = PvpRewardClaimConfirmed | PvpRewardClaimRetry;

export type PvpRewardContinuationContext = {
    signal: AbortSignal;
    /** Re-check account epoch, battle, role, and mount before any local write. */
    isCurrentScope(): boolean;
};

function requireContinuationCurrent(continuation: PvpRewardContinuationContext): void {
    if (continuation.signal.aborted || !continuation.isCurrentScope()) {
        throw new DOMException("PvP completion scope changed.", "AbortError");
    }
}

export async function readPvpOwnerSaveForContinuation(
    playerName: string,
    continuation: PvpRewardContinuationContext,
    fetchFn: typeof fetch = fetch,
): Promise<{ character: Character; version: unknown }> {
    requireContinuationCurrent(continuation);
    const response = await fetchFn(`/api/save/${encodeURIComponent(playerName)}`, {
        cache: "no-cache",
        signal: continuation.signal,
    });
    const body = await response.json().catch(() => ({})) as {
        error?: string;
        character?: Character;
        _saveVersion?: unknown;
    };
    if (!response.ok || !body.character) {
        throw new Error(body.error || `Player save read failed (HTTP ${response.status}).`);
    }
    requireContinuationCurrent(continuation);
    if (playerSlug(body.character.name) !== playerSlug(playerName)) {
        throw new Error("PvP settlement returned a foreign save.");
    }
    return { character: body.character, version: body._saveVersion };
}

type ClaimResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
};

type ClaimFetch = (input: string, init: RequestInit) => Promise<ClaimResponse>;
export type PvpRewardOutcome = "win" | "loss" | "draw";

export type PvpRewardCompletionStorage = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};

type PvpRewardCompletionMarker = {
    version: 1;
    state: "pending" | "completed";
    playerName: string;
    battleId: string;
    outcome: PvpRewardOutcome;
    startedAt: number;
    completedAt: number | null;
};

const PVP_REWARD_COMPLETION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function completionPlayer(playerName: string): string {
    return playerName.trim().toLowerCase();
}

function completionKey(playerName: string, battleId: string, outcome: PvpRewardOutcome): string {
    return `pvp:reward-completion:v1:${encodeURIComponent(completionPlayer(playerName))}:${encodeURIComponent(battleId)}:${outcome}`;
}

function completionMarker(
    storage: PvpRewardCompletionStorage | null,
    request: { playerName: string; battleId: string; outcome: PvpRewardOutcome },
    now = Date.now(),
): PvpRewardCompletionMarker | null {
    if (!storage) return null;
    const key = completionKey(request.playerName, request.battleId, request.outcome);
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const marker = JSON.parse(raw) as Partial<PvpRewardCompletionMarker>;
        const matches = marker.version === 1
            && (marker.state === "pending" || marker.state === "completed")
            && marker.playerName === completionPlayer(request.playerName)
            && marker.battleId === request.battleId
            && marker.outcome === request.outcome
            && Number.isFinite(marker.startedAt)
            && (marker.completedAt === null || Number.isFinite(marker.completedAt))
            && now - Number(marker.startedAt) >= 0
            && now - Number(marker.startedAt) <= PVP_REWARD_COMPLETION_MAX_AGE_MS;
        if (matches) return marker as PvpRewardCompletionMarker;
        storage.removeItem(key);
    } catch { /* advisory browser durability only */ }
    return null;
}

/** Write-before-request intent used to repair a claim response lost to abort. */
export function beginPvpRewardCompletion(
    storage: PvpRewardCompletionStorage | null,
    request: { playerName: string; battleId: string; outcome: PvpRewardOutcome },
    now = Date.now(),
): void {
    if (!storage) return;
    // A remount after callbacks completed must retain the completed fence. If
    // this were overwritten with pending, every ordinary alreadyClaimed read
    // would replay App settlement callbacks forever.
    if (completionMarker(storage, request, now)) return;
    const marker: PvpRewardCompletionMarker = {
        version: 1,
        state: "pending",
        playerName: completionPlayer(request.playerName),
        battleId: request.battleId,
        outcome: request.outcome,
        startedAt: now,
        completedAt: null,
    };
    try {
        storage.setItem(completionKey(request.playerName, request.battleId, request.outcome), JSON.stringify(marker));
    } catch { /* storage denial must not block the server claim */ }
}

/**
 * Server completion state is authoritative. Browser storage is only an
 * optimization that avoids re-enqueueing callbacks after they ran but before
 * their completion ACK reached the server; lack of storage must never suppress
 * repair of a server-pending continuation.
 */
export function shouldRunPvpRewardCompletion(
    storage: PvpRewardCompletionStorage | null,
    request: { playerName: string; battleId: string; outcome: PvpRewardOutcome },
    completionPending: boolean,
    now = Date.now(),
): boolean {
    if (!completionPending) return false;
    return completionMarker(storage, request, now)?.state !== "completed";
}

/** Fence the exact account+battle+outcome marker after callbacks run. */
export function completePvpRewardCompletion(
    storage: PvpRewardCompletionStorage | null,
    request: { playerName: string; battleId: string; outcome: PvpRewardOutcome },
    now = Date.now(),
): void {
    const marker = completionMarker(storage, request, now);
    if (!storage || !marker) return;
    const completed: PvpRewardCompletionMarker = {
        ...marker,
        state: "completed",
        completedAt: now,
    };
    try {
        storage.setItem(completionKey(request.playerName, request.battleId, request.outcome), JSON.stringify(completed));
    } catch { /* pending marker intentionally survives for retry */ }
}

function cleanRating(raw: unknown): PvpRewardRating | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    if (typeof value.field !== "string"
        || !Number.isFinite(Number(value.value))
        || !Number.isFinite(Number(value.delta))) return undefined;
    return { field: value.field, value: Number(value.value), delta: Number(value.delta) };
}

function cleanClanWarScrollDrop(raw: unknown): ClanWarScrollDrop | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    const awarded = Number(value.awarded);
    const chancePercent = Number(value.chancePercent);
    if ((awarded !== 0 && awarded !== 1)
        || !Number.isFinite(chancePercent)
        || chancePercent <= 0
        || chancePercent > 100) return undefined;
    return { awarded, chancePercent: Math.round(chancePercent) };
}

function cleanWarPoints(raw: unknown): PvpWarPoints | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    const awarded = Number(value.awarded);
    if (!Number.isSafeInteger(awarded) || awarded <= 0 || (value.kind !== "clan" && value.kind !== "sector")) return undefined;
    return { awarded, kind: value.kind };
}

function cleanWarGroundReward(raw: unknown): PvpWarGroundReward | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    const raidProgress = Number(value.raidProgress);
    const ryoAwarded = Number(value.ryoAwarded);
    const fateShardsAwarded = Number(value.fateShardsAwarded);
    if (typeof value.fresh !== "boolean"
        || typeof value.bountyCredited !== "boolean"
        || !Number.isSafeInteger(raidProgress) || raidProgress < 0
        || !Number.isSafeInteger(ryoAwarded) || ryoAwarded < 0
        || !Number.isSafeInteger(fateShardsAwarded) || fateShardsAwarded < 0) return undefined;
    return { fresh: value.fresh, bountyCredited: value.bountyCredited, raidProgress, ryoAwarded, fateShardsAwarded };
}

function cleanBaseReward(raw: unknown): PvpWinBaseSummary["reward"] {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    const ryo = Number(value.ryo);
    const combatGrowth = Number(value.combatGrowth);
    const auraDust = Number(value.auraDust);
    if (![ryo, combatGrowth, auraDust].every((amount) => Number.isSafeInteger(amount) && amount >= 0)) return undefined;
    return { ryo, combatGrowth, auraDust };
}

/** Flatten the server-authored settlement projections into result-screen values. */
export function pvpBattleRewardSummary(result: PvpRewardClaimConfirmed): PvpBattleRewardSummary {
    const base = result.base?.reward;
    const raid = result.raidProgression;
    return {
        ryo: (base?.ryo ?? 0) + (result.warGroundReward?.ryoAwarded ?? 0) + (raid?.bonusRyo ?? 0),
        combatGrowth: base?.combatGrowth ?? 0,
        professionXp: raid?.xpAwarded ?? 0,
        auraDust: base?.auraDust ?? 0,
        fateShards: result.warGroundReward?.fateShardsAwarded ?? 0,
        honorSeals: raid?.bonusSeals ?? 0,
        territoryScrolls: result.clanWarScrollDrop?.awarded ?? 0,
        warPoints: result.warPoints?.awarded ?? 0,
        ...(result.warPoints ? { warPointKind: result.warPoints.kind } : {}),
        ...(result.rating ? { ratingDelta: result.rating.delta } : {}),
    };
}

/** Player-facing copy for the exact authoritative terminal settlement. */
export function pvpRewardSettlementNotice(
    result: PvpRewardClaimConfirmed,
    options: { draw: boolean; spar: boolean },
): string {
    if (options.draw) return "Draw confirmed — terminal battle effects are settled.";
    if (result.clanWarScrollDrop) {
        return result.clanWarScrollDrop.awarded > 0
            ? "Clan War victory settled — Territory Control Scroll dropped! +1 added to your inventory."
            : `Clan War victory settled — no Territory Control Scroll this time (${result.clanWarScrollDrop.chancePercent}% chance per win).`;
    }
    if (!result.rewardAuthorized || options.spar) return "Spar complete — no progression rewards.";
    if (result.rating) {
        return `Server-settled rating: ${result.rating.delta >= 0 ? "+" : ""}${result.rating.delta}.${result.base ? " Combat rewards credited." : ""}`;
    }
    if (result.base) return "Combat rewards settled by the server.";
    return "Official result verified; no generic payout for this mode.";
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
    request: { playerName: string; battleId: string; outcome: PvpRewardOutcome },
    options: { signal?: AbortSignal } = {},
): Promise<PvpRewardClaimResult> {
    try {
        const response = await fetchClaim("/api/pvp/claim-rewards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...request, completionVersion: 1 }),
            ...(options.signal ? { signal: options.signal } : {}),
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
        const basePayload = payload.base && typeof payload.base === "object"
            ? payload.base as Record<string, unknown>
            : undefined;
        const baseReward = cleanBaseReward(basePayload?.reward);
        const base = basePayload
            ? {
                ...basePayload as PvpWinBaseSummary,
                ...(baseReward ? { reward: baseReward } : {}),
            }
            : undefined;
        const character = payload.character && typeof payload.character === "object"
            ? payload.character as Character
            : undefined;
        const saveVersion = Number(payload._saveVersion);
        const raidProgression = cleanRaidProgression(payload.raidProgression);
        const clanWarScrollDrop = cleanClanWarScrollDrop(payload.clanWarScrollDrop);
        const warPoints = cleanWarPoints(payload.warPoints);
        const warGroundReward = cleanWarGroundReward(payload.warGroundReward);
        if (typeof payload.completionPending !== "boolean") {
            return {
                status: "retry",
                message: "Reward verification returned an incomplete completion receipt. Please retry.",
            };
        }
        return {
            status: "confirmed",
            alreadyClaimed: payload.alreadyClaimed === true,
            completionPending: payload.completionPending,
            // Older servers did not return the explicit bit; a signed base/rating
            // settlement is itself authoritative during a rolling deployment.
            rewardAuthorized: payload.rewardAuthorized === true || !!rating || !!base,
            progressionAuthorized: payload.progressionAuthorized === true || !!rating || !!base,
            ...(rating ? { rating } : {}),
            ...(base ? { base } : {}),
            ...(character ? { character } : {}),
            ...(Number.isFinite(saveVersion) ? { _saveVersion: saveVersion } : {}),
            ...(raidProgression ? { raidProgression } : {}),
            ...(warPoints ? { warPoints } : {}),
            ...(warGroundReward ? { warGroundReward } : {}),
            ...(clanWarScrollDrop ? { clanWarScrollDrop } : {}),
        };
    } catch {
        return {
            status: "retry",
            message: "Could not reach the reward service. Your battle result is safe; retry to apply rewards.",
        };
    }
}

/** ACK the durable server obligation only after every awaited App callback finishes. */
export async function postPvpRewardCompletionAck(
    fetchClaim: ClaimFetch,
    request: { playerName: string; battleId: string; outcome: PvpRewardOutcome },
    options: { signal?: AbortSignal } = {},
): Promise<{ status: "confirmed" } | PvpRewardClaimRetry> {
    try {
        const response = await fetchClaim("/api/pvp/claim-rewards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...request, completionVersion: 1, completionAck: true }),
            ...(options.signal ? { signal: options.signal } : {}),
        });
        const body = await response.json().catch(() => null);
        const payload = body && typeof body === "object" ? body as Record<string, unknown> : null;
        if (!response.ok || payload?.ok !== true || payload.completionPending !== false) {
            const serverError = typeof payload?.error === "string" ? payload.error.trim() : "";
            return {
                status: "retry",
                message: serverError || `Reward completion acknowledgement failed (HTTP ${response.status}). Please retry.`,
            };
        }
        return { status: "confirmed" };
    } catch {
        return {
            status: "retry",
            message: "Could not acknowledge battle completion. Your result is safe; please retry.",
        };
    }
}
