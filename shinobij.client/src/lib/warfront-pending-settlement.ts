import type { WarfrontRoundChoice } from "./pet-warfront-sim";

export const PENDING_WARFRONT_SETTLEMENT_PREFIX = "wfPendingSettlement.v1";
export const PENDING_WARFRONT_SETTLEMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const WARFRONT_EARLY_RETRY_CUSHION_MS = 300;
export const WARFRONT_EARLY_RETRY_MAX_MS = 11 * 60 * 1000;

export type PendingWarfrontSettlement = {
    version: 1;
    playerName: string;
    seed: number;
    reportKey: string;
    battleToken: string;
    prepareToken?: string;
    /** Server-sealed policy shown before launch. Optional only for recovery of
     * older v1 records written before Manual Council became unranked. */
    rewardEligible?: boolean;
    outcome: "win" | "loss" | "draw";
    warfrontChoices?: WarfrontRoundChoice[];
    createdAt: number;
};

export type WarfrontTerminalReceipt = {
    ok: true;
    outcome: "win" | "loss" | "draw";
    reward: number;
    character: Record<string, unknown>;
    forfeited?: boolean;
    firstWinOfDay?: boolean;
    capped?: boolean;
    unranked?: boolean;
    idempotentReplay?: boolean;
    rerollLockedUntil?: number;
    retryAfterSeconds?: number;
    reason?: "coach-completion";
    coachMastery?: {
        earned: 0 | 1;
        completedToday: number;
        dailyCap: number;
        capped: boolean;
    };
    coachReward?: {
        kind: "coach-completion";
        currency: "ryo";
        day: string;
        baseAmount: number;
        amount: number;
        completedToday: number;
        dailyCap: 3;
        capped: boolean;
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const SAFE_EXPIRED_EXIT_FIELDS = new Set([
    "ok", "outcome", "reward", "forfeited", "safeToExit",
    "expiredAuthorization", "settlementReceipt", "reason", "idempotentReplay",
]);

/** The only receipt-less terminal response the client may trust. It proves the
 * held token expired and the server found no different live authorization. */
export function isSafeExpiredWarfrontExit(value: unknown): boolean {
    return isRecord(value)
        && Object.keys(value).length === SAFE_EXPIRED_EXIT_FIELDS.size
        && Object.keys(value).every((key) => SAFE_EXPIRED_EXIT_FIELDS.has(key))
        && value.ok === true
        && value.outcome === "loss"
        && value.reward === 0
        && value.forfeited === true
        && value.safeToExit === true
        && value.expiredAuthorization === true
        && value.settlementReceipt === null
        && value.reason === "warfront-authorization-expired"
        && value.idempotentReplay === true;
}

/** A 425 is an expected regulation-clock gate, not a failed settlement. Keep
 * its one-shot wait finite even if a malformed response reaches the client. */
export function warfrontEarlyRetryDelay(value: unknown): number | null {
    if (!isRecord(value) || value.code !== "warfront-result-too-early") return null;
    const retryAfterMs = Number(value.retryAfterMs);
    if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > WARFRONT_EARLY_RETRY_MAX_MS) return null;
    return Math.min(WARFRONT_EARLY_RETRY_MAX_MS, Math.ceil(retryAfterMs) + WARFRONT_EARLY_RETRY_CUSHION_MS);
}

export function coachMasteryReceiptLine(mastery: WarfrontTerminalReceipt["coachMastery"], forfeited = false): string {
    if (!mastery) return "";
    if (forfeited) return ` Forfeits do not earn Coach mastery. Daily progress ${mastery.completedToday}/${mastery.dailyCap}.`;
    if (mastery.earned === 1) return ` Coach mastery ${mastery.completedToday}/${mastery.dailyCap}.`;
    if (mastery.capped) return ` Coach mastery ${mastery.completedToday}/${mastery.dailyCap}; daily cap reached.`;
    return ` Coach mastery ${mastery.completedToday}/${mastery.dailyCap}; no completion credit was added.`;
}

export function warfrontTerminalReceiptMessage(receipt: WarfrontTerminalReceipt, exitRace = false): string {
    const mastery = coachMasteryReceiptLine(receipt.coachMastery, receipt.forfeited === true);
    if (receipt.forfeited) {
        const wait = receipt.retryAfterSeconds
            ? ` Fresh scouting unlocks after the original match clock, in about ${receipt.retryAfterSeconds >= 60 ? `${Math.ceil(receipt.retryAfterSeconds / 60)}m` : `${Math.ceil(receipt.retryAfterSeconds)}s`}.`
            : "";
        return `Warfront forfeited as a loss. No reward was paid.${mastery}${wait}`;
    }
    const prefix = exitRace ? "The battle finished before Exit. " : "";
    if (receipt.unranked && receipt.coachReward) {
        const reward = receipt.coachReward.amount.toLocaleString();
        const completion = receipt.coachReward.amount > 0
            ? `Coach completion settled: +${reward} ryo.`
            : `Coach completion verified. The ${receipt.coachReward.dailyCap}-completion UTC daily cap was already reached, so no ryo was added.`;
        return `${prefix}${completion} The reward is identical for a win, loss, or draw; no first-win bonus or win progress was awarded.${mastery}`;
    }
    if (receipt.unranked) return `${prefix}Coach Mode result verified as outcome-unranked. No first-win bonus or win progress was awarded.${mastery}`;
    if (receipt.outcome === "loss") return `${prefix}Warfront defeat verified. No victory reward was due.`;
    if (receipt.outcome === "draw") return `${prefix}Warfront draw verified. No victory reward was due.`;
    if (receipt.capped) return `${prefix}Victory verified. Your daily Pet Arena reward cap was already reached, so no ryo was added.`;
    const reward = Math.max(0, receipt.reward).toLocaleString();
    return receipt.firstWinOfDay
        ? `${prefix}First Warfront victory of the day settled: +${reward} ryo (x5 bonus).`
        : `${prefix}Warfront victory settled: +${reward} ryo.`;
}

/** Validate either side of a settle-vs-forfeit race. The forfeit endpoint can
 * replay the already-committed normal result, and both are terminal receipts. */
export function parseWarfrontTerminalReceipt(value: unknown): WarfrontTerminalReceipt | null {
    if (!isRecord(value) || value.ok !== true || !isRecord(value.character)) return null;
    if (value.outcome !== "win" && value.outcome !== "loss" && value.outcome !== "draw") return null;
    if (typeof value.reward !== "number" || !Number.isFinite(value.reward) || value.reward < 0) return null;
    for (const field of ["forfeited", "firstWinOfDay", "capped", "unranked", "idempotentReplay"] as const) {
        if (value[field] !== undefined && typeof value[field] !== "boolean") return null;
    }
    if (value.rerollLockedUntil !== undefined && (typeof value.rerollLockedUntil !== "number" || !Number.isFinite(value.rerollLockedUntil))) return null;
    if (value.retryAfterSeconds !== undefined && (typeof value.retryAfterSeconds !== "number" || !Number.isFinite(value.retryAfterSeconds) || value.retryAfterSeconds < 0 || value.retryAfterSeconds > WARFRONT_EARLY_RETRY_MAX_MS / 1000)) return null;
    if (value.forfeited === true && (value.outcome !== "loss" || value.reward !== 0)) return null;
    let coachMastery: WarfrontTerminalReceipt["coachMastery"];
    if (value.coachMastery !== undefined) {
        if (!isRecord(value.coachMastery)
            || (value.coachMastery.earned !== 0 && value.coachMastery.earned !== 1)
            || !Number.isSafeInteger(value.coachMastery.completedToday)
            || !Number.isSafeInteger(value.coachMastery.dailyCap)
            || Number(value.coachMastery.completedToday) < 0
            || Number(value.coachMastery.dailyCap) <= 0
            || Number(value.coachMastery.completedToday) > Number(value.coachMastery.dailyCap)
            || typeof value.coachMastery.capped !== "boolean") return null;
        coachMastery = {
            earned: value.coachMastery.earned,
            completedToday: Number(value.coachMastery.completedToday),
            dailyCap: Number(value.coachMastery.dailyCap),
            capped: value.coachMastery.capped,
        };
    }
    let coachReward: WarfrontTerminalReceipt["coachReward"];
    if (value.coachReward !== undefined) {
        if (!isRecord(value.coachReward) || value.coachReward.kind !== "coach-completion" || value.coachReward.currency !== "ryo"
            || typeof value.coachReward.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.coachReward.day)
            || !Number.isSafeInteger(value.coachReward.baseAmount) || Number(value.coachReward.baseAmount) < 20
            || !Number.isSafeInteger(value.coachReward.amount) || Number(value.coachReward.amount) < 0
            || !Number.isSafeInteger(value.coachReward.completedToday) || Number(value.coachReward.completedToday) < 0 || Number(value.coachReward.completedToday) > 3
            || value.coachReward.dailyCap !== 3 || typeof value.coachReward.capped !== "boolean") return null;
        coachReward = {
            kind: "coach-completion",
            currency: "ryo",
            day: value.coachReward.day,
            baseAmount: Number(value.coachReward.baseAmount),
            amount: Number(value.coachReward.amount),
            completedToday: Number(value.coachReward.completedToday),
            dailyCap: 3,
            capped: value.coachReward.capped,
        };
    }
    if (value.forfeited === true && coachReward) return null;
    if (value.unranked === true && value.forfeited !== true) {
        if (value.reason !== "coach-completion" || !coachMastery || !coachReward
            || value.reward !== coachReward.amount
            || coachMastery.dailyCap !== coachReward.dailyCap
            || coachMastery.completedToday !== coachReward.completedToday
            || coachMastery.capped !== coachReward.capped
            || coachReward.amount !== (coachMastery.earned === 1 ? coachReward.baseAmount : 0)) return null;
        if (!isRecord(value.settlementReceipt)
            || value.settlementReceipt.version !== 1
            || value.settlementReceipt.outcome !== value.outcome
            || value.settlementReceipt.reward !== value.reward
            || value.settlementReceipt.rewardEligible !== false
            || value.settlementReceipt.firstWinOfDay !== false
            || value.settlementReceipt.firstWinBonus !== 0
            || !Number.isFinite(value.settlementReceipt.settledAt)
            || !isRecord(value.settlementReceipt.coachMastery)
            || !isRecord(value.settlementReceipt.coachReward)) return null;
    }
    return {
        ok: true,
        outcome: value.outcome,
        reward: value.reward,
        character: value.character,
        ...(typeof value.forfeited === "boolean" ? { forfeited: value.forfeited } : {}),
        ...(typeof value.firstWinOfDay === "boolean" ? { firstWinOfDay: value.firstWinOfDay } : {}),
        ...(typeof value.capped === "boolean" ? { capped: value.capped } : {}),
        ...(typeof value.unranked === "boolean" ? { unranked: value.unranked } : {}),
        ...(typeof value.idempotentReplay === "boolean" ? { idempotentReplay: value.idempotentReplay } : {}),
        ...(typeof value.rerollLockedUntil === "number" ? { rerollLockedUntil: value.rerollLockedUntil } : {}),
        ...(typeof value.retryAfterSeconds === "number" ? { retryAfterSeconds: value.retryAfterSeconds } : {}),
        ...(value.reason === "coach-completion" ? { reason: value.reason } : {}),
        ...(coachMastery ? { coachMastery } : {}),
        ...(coachReward ? { coachReward } : {}),
    };
}

export function warfrontTerminalReceiptMatchesPlayer(receipt: WarfrontTerminalReceipt, playerName: string): boolean {
    const receiptName = receipt.character.name;
    return typeof receiptName === "string"
        && receiptName.trim().toLowerCase() === playerName.trim().toLowerCase();
}

const storageKey = (playerName: string): string =>
    `${PENDING_WARFRONT_SETTLEMENT_PREFIX}:${playerName.trim().toLowerCase()}`;

export function parsePendingWarfrontSettlement(
    value: unknown,
    playerName: string,
    now = Date.now(),
): PendingWarfrontSettlement | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const pending = value as Partial<PendingWarfrontSettlement>;
    const seed = Number(pending.seed);
    const createdAt = Number(pending.createdAt);
    if (pending.version !== 1 || pending.playerName !== playerName) return null;
    if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0x7fffffff) return null;
    if (pending.reportKey !== `${seed}:tactical`) return null;
    if (typeof pending.battleToken !== "string" || !/^[A-Za-z0-9]{16,128}$/.test(pending.battleToken)) return null;
    if (pending.prepareToken !== undefined && (typeof pending.prepareToken !== "string" || !/^[A-Za-z0-9]{16,128}$/.test(pending.prepareToken))) return null;
    if (pending.rewardEligible !== undefined && typeof pending.rewardEligible !== "boolean") return null;
    if (pending.outcome !== "win" && pending.outcome !== "loss" && pending.outcome !== "draw") return null;
    if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > now + 60_000 || now - createdAt > PENDING_WARFRONT_SETTLEMENT_MAX_AGE_MS) return null;
    if (pending.warfrontChoices !== undefined && !Array.isArray(pending.warfrontChoices)) return null;
    return {
        version: 1,
        playerName,
        seed,
        reportKey: pending.reportKey,
        battleToken: pending.battleToken,
        ...(pending.prepareToken ? { prepareToken: pending.prepareToken } : {}),
        ...(pending.rewardEligible !== undefined ? { rewardEligible: pending.rewardEligible } : {}),
        outcome: pending.outcome,
        ...(pending.warfrontChoices ? { warfrontChoices: pending.warfrontChoices } : {}),
        createdAt,
    };
}

export function readPendingWarfrontSettlement(playerName: string): PendingWarfrontSettlement | null {
    try {
        const key = storageKey(playerName);
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = parsePendingWarfrontSettlement(JSON.parse(raw), playerName);
        if (!parsed) localStorage.removeItem(key);
        return parsed;
    } catch {
        return null;
    }
}

export function writePendingWarfrontSettlement(pending: PendingWarfrontSettlement): void {
    try {
        localStorage.setItem(storageKey(pending.playerName), JSON.stringify(pending));
    } catch {
        // A blocked storage API does not prevent the in-memory retry path.
    }
}

export function clearPendingWarfrontSettlement(playerName: string, battleToken: string): void {
    try {
        const key = storageKey(playerName);
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const current = parsePendingWarfrontSettlement(JSON.parse(raw), playerName);
        if (!current || current.battleToken === battleToken) localStorage.removeItem(key);
    } catch {
        // Storage may be unavailable; the server receipt still guarantees
        // idempotence for any later retry that retained the token in memory.
    }
}
