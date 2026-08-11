import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { replayCasualPetDuel, parseDuelInputLog } from './_duel-replay.js';
import type { SealedDuelParams } from './_duel-replay.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { writeSaveProjected } from '../save/_projected-write.js';
import {
    derivePetRankedSettlement,
    PET_RANKED_DISABLED_REASON,
    petRankedStartsEnabled,
    settlePetRankedMatchDurably,
} from './_ranked-settlement.js';
import {
    isPetRankedMatchId,
    releasePetRankedActivePair,
} from './_ranked-engine.js';
import { loadPetRankedAuthorityToken } from './_ranked-journal.js';
import {
    startWarfrontMatch,
    WARFRONT_TPS,
    WF_MAX_SECONDS,
    type WarfrontRoundChoice,
} from '../_pet-sim/pet-warfront-sim.js';
import { WARFRONT_TOKEN_TTL_SECONDS } from './warfront-start.js';
import type { SealedManualWarfront, SealedWarfrontSlot } from './warfront-start.js';
import {
    finalizeManualWarfrontAttempt,
    isSealedManualWarfront,
    MAX_MANUAL_COUNCILS,
    parseWarfrontChoiceLog,
    warfrontChoiceLogsEqual,
} from './_warfront-council.js';
import { reconcileWarfrontActiveAuthorization } from './_warfront-lease.js';
import { WARFRONT_COACH_COMPLETION_DAILY_CAP, warfrontBaseRyoReward } from './_warfront-reward.js';

export { parseWarfrontChoiceLog } from './_warfront-council.js';

// Pet Arena reward recorder. Non-ranked wins require a short-lived start token
// minted by /api/pet/battle-start for the same reportKey. The battle is still
// client-resolved, but bare result-only reward posts no longer pay out.

const ARENA_WIN_RATE_LIMIT = 5_000;   // ms — one win per 5s per player
const DAILY_ARENA_WIN_CAP = 100;       // max server-validated wins per UTC day
const HOLLOW_GATE_PET_RECEIPT_TTL_SECONDS = 24 * 60 * 60;

export type PetBattleOutcome = 'win' | 'loss' | 'draw';

/** Manual Warfront exposes a deterministic seed so the local cinematic can
 * pause at Council boundaries. It therefore cannot earn outcome/win credit,
 * but a verified completion earns the fixed, capped Coach participation reward. */
export function isWarfrontRewardEligible(mode: string, hasManualWarfront: boolean): boolean {
    return mode !== 'warfront' || !hasManualWarfront;
}

type HollowGatePetResultReceipt = {
    playerName: string;
    runId: string;
    outcome: PetBattleOutcome;
    playerPetIds: string[];
    settledAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export type WarfrontSettlementReceipt = {
    battleToken: string;
    reportKey: string;
    outcome: PetBattleOutcome;
    reward: number;
    firstWinOfDay: boolean;
    firstWinBonus: number;
    capped: boolean;
    /** False for verified practice results that must never change economy or
     * first-win progression. Optional so pre-policy receipts remain readable. */
    rewardEligible?: boolean;
    /** Immediate exits are authoritative losses with no economy/progression. */
    forfeited?: boolean;
    /** Immediate forfeit keeps a non-searchable active marker until the
     * original authoritative match maturity, preventing seed/outcome rerolls. */
    leaseHeldUntil?: number;
    /** Non-economy Coach completion credit. It lives inside the durable
     * settlement receipt so no new character/save progression field is needed. */
    coachMastery?: WarfrontCoachMasteryReceipt;
    coachReward?: WarfrontCoachRewardReceipt;
    totalPetWins: number;
    dailyPetWins: number;
    settledAt: number;
};

export const WARFRONT_COACH_MASTERY_DAILY_CAP = WARFRONT_COACH_COMPLETION_DAILY_CAP;
export type WarfrontCoachMasteryReceipt = {
    day: string;
    earned: 0 | 1;
    completedToday: number;
    dailyCap: typeof WARFRONT_COACH_MASTERY_DAILY_CAP;
    capped: boolean;
};
export type WarfrontCoachRewardReceipt = {
    kind: 'coach-completion';
    currency: 'ryo';
    day: string;
    baseAmount: number;
    amount: number;
    completedToday: number;
    dailyCap: typeof WARFRONT_COACH_COMPLETION_DAILY_CAP;
    capped: boolean;
};

const WARFRONT_SETTLEMENT_HISTORY_LIMIT = 16;
// Count-only ledgers are unsafe here: if token deletion fails, an attacker can
// churn enough later settlements to evict the paid token while it is still
// live. Keep every receipt longer than the maximum token lifetime; retain a
// small tail beyond that for ordinary delayed receipt recovery.
export const WARFRONT_SETTLEMENT_RECEIPT_RETENTION_MS = (WARFRONT_TOKEN_TTL_SECONDS + 5 * 60) * 1000;

function warfrontReceipts(character: Record<string, unknown> | undefined): WarfrontSettlementReceipt[] {
    if (!Array.isArray(character?.warfrontSettlementReceipts)) return [];
    const valid = character.warfrontSettlementReceipts.filter((value): value is WarfrontSettlementReceipt => {
        if (!isRecord(value)) return false;
        return typeof value.battleToken === 'string'
            && typeof value.reportKey === 'string'
            && (value.outcome === 'win' || value.outcome === 'loss' || value.outcome === 'draw')
            && typeof value.reward === 'number' && Number.isFinite(value.reward)
            && typeof value.firstWinOfDay === 'boolean'
            && typeof value.firstWinBonus === 'number' && Number.isFinite(value.firstWinBonus)
            && typeof value.capped === 'boolean'
            && (value.rewardEligible === undefined || typeof value.rewardEligible === 'boolean')
            && (value.forfeited === undefined || typeof value.forfeited === 'boolean')
            && (value.leaseHeldUntil === undefined || (typeof value.leaseHeldUntil === 'number' && Number.isFinite(value.leaseHeldUntil)))
            && (value.coachMastery === undefined || (
                isRecord(value.coachMastery)
                && /^\d{4}-\d{2}-\d{2}$/.test(String(value.coachMastery.day ?? ''))
                && (value.coachMastery.earned === 0 || value.coachMastery.earned === 1)
                && Number.isSafeInteger(value.coachMastery.completedToday)
                && Number(value.coachMastery.completedToday) >= 0
                && Number(value.coachMastery.completedToday) <= WARFRONT_COACH_MASTERY_DAILY_CAP
                && value.coachMastery.dailyCap === WARFRONT_COACH_MASTERY_DAILY_CAP
                && typeof value.coachMastery.capped === 'boolean'
            ))
            && (value.coachReward === undefined || (
                isRecord(value.coachReward)
                && value.coachReward.kind === 'coach-completion'
                && value.coachReward.currency === 'ryo'
                && /^\d{4}-\d{2}-\d{2}$/.test(String(value.coachReward.day ?? ''))
                && typeof value.coachReward.baseAmount === 'number' && Number.isFinite(value.coachReward.baseAmount)
                && Number(value.coachReward.baseAmount) >= 0
                && typeof value.coachReward.amount === 'number' && Number.isFinite(value.coachReward.amount)
                && Number(value.coachReward.amount) >= 0
                && Number(value.coachReward.amount) <= Number(value.coachReward.baseAmount)
                && Number.isSafeInteger(value.coachReward.completedToday)
                && Number(value.coachReward.completedToday) >= 0
                && Number(value.coachReward.completedToday) <= WARFRONT_COACH_COMPLETION_DAILY_CAP
                && value.coachReward.dailyCap === WARFRONT_COACH_COMPLETION_DAILY_CAP
                && typeof value.coachReward.capped === 'boolean'
            ))
            && typeof value.totalPetWins === 'number' && Number.isFinite(value.totalPetWins)
            && typeof value.dailyPetWins === 'number' && Number.isFinite(value.dailyPetWins)
            && typeof value.settledAt === 'number' && Number.isFinite(value.settledAt);
    });
    const cutoff = Date.now() - WARFRONT_SETTLEMENT_RECEIPT_RETENTION_MS;
    // Pin every current-day Coach receipt regardless of count churn. Daily-cap
    // enforcement derives from these receipts under the save lock; evicting one
    // early would let a player exceed the cap with enough Auto settlements.
    const today = utcDateKey();
    const recent = valid.filter((receipt) => receipt.settledAt >= cutoff || receipt.coachMastery?.day === today);
    const history = valid
        .filter((receipt) => receipt.settledAt < cutoff && receipt.coachMastery?.day !== today)
        .slice(-WARFRONT_SETTLEMENT_HISTORY_LIMIT);
    return [...history, ...recent];
}

export function nextWarfrontCoachMasteryReceipt(
    character: Record<string, unknown>,
    day = utcDateKey(),
    earnCompletion = true,
): WarfrontCoachMasteryReceipt {
    const completed = warfrontReceipts(character)
        .filter((receipt) => receipt.coachMastery?.day === day)
        .reduce((sum, receipt) => sum + Number(receipt.coachMastery?.earned ?? 0), 0);
    const earned: 0 | 1 = earnCompletion && completed < WARFRONT_COACH_MASTERY_DAILY_CAP ? 1 : 0;
    const completedToday = Math.min(WARFRONT_COACH_MASTERY_DAILY_CAP, completed + earned);
    return {
        day,
        earned,
        completedToday,
        dailyCap: WARFRONT_COACH_MASTERY_DAILY_CAP,
        capped: earned === 0 && completedToday >= WARFRONT_COACH_MASTERY_DAILY_CAP,
    };
}

export function findWarfrontSettlementReceipt(
    character: Record<string, unknown> | undefined,
    battleToken: string,
    reportKey: string,
): WarfrontSettlementReceipt | null {
    return warfrontReceipts(character).find((receipt) => receipt.battleToken === battleToken && receipt.reportKey === reportKey) ?? null;
}

/** A mint retry can leave more than one live token for the same sealed report
 * when the first HTTP response disappears. The report key is therefore also a
 * payout identity: a second valid token may replay the original receipt, but it
 * must never apply the reward twice. */
export function findWarfrontSettlementReceiptByReportKey(
    character: Record<string, unknown> | undefined,
    reportKey: string,
): WarfrontSettlementReceipt | null {
    return warfrontReceipts(character).find((receipt) => receipt.reportKey === reportKey) ?? null;
}

export function appendWarfrontSettlementReceipt(
    character: Record<string, unknown>,
    receipt: WarfrontSettlementReceipt,
): Record<string, unknown> {
    const prior = warfrontReceipts(character).filter((item) => item.battleToken !== receipt.battleToken && item.reportKey !== receipt.reportKey);
    return { ...character, warfrontSettlementReceipts: [...prior, receipt] };
}

export function warfrontReceiptResponse(
    receipt: WarfrontSettlementReceipt,
    character: Record<string, unknown>,
    saveVersion: number,
) {
    return {
        ok: true,
        outcome: receipt.outcome,
        reward: receipt.reward,
        firstWinOfDay: receipt.firstWinOfDay,
        firstWinBonus: receipt.firstWinBonus,
        capped: receipt.capped,
        unranked: receipt.rewardEligible === false,
        ...(receipt.forfeited
            ? { forfeited: true, reason: 'warfront-forfeit' }
            : receipt.coachReward ? { reason: 'coach-completion' }
                : receipt.rewardEligible === false ? { reason: 'manual-warfront-unranked' } : {}),
        ...(receipt.coachMastery ? { coachMastery: receipt.coachMastery } : {}),
        ...(receipt.coachReward ? { coachReward: receipt.coachReward } : {}),
        ...(receipt.leaseHeldUntil !== undefined && receipt.leaseHeldUntil > Date.now()
            ? {
                rerollLockedUntil: receipt.leaseHeldUntil,
                retryAfterSeconds: Math.max(1, Math.ceil((receipt.leaseHeldUntil - Date.now()) / 1000)),
            }
            : {}),
        totalPetWins: receipt.totalPetWins,
        dailyPetWins: receipt.dailyPetWins,
        balances: { ryo: Number(character.ryo ?? 0) },
        _saveVersion: saveVersion,
        character,
        settlementReceipt: {
            version: 1 as const,
            battleToken: receipt.battleToken,
            reportKey: receipt.reportKey,
            outcome: receipt.outcome,
            reward: receipt.reward,
            rewardEligible: receipt.rewardEligible !== false,
            firstWinOfDay: receipt.firstWinOfDay,
            firstWinBonus: receipt.firstWinBonus,
            capped: receipt.capped,
            ...(receipt.forfeited ? { forfeited: true } : {}),
            ...(receipt.coachMastery ? { coachMastery: receipt.coachMastery } : {}),
            ...(receipt.coachReward ? { coachReward: receipt.coachReward } : {}),
            settledAt: receipt.settledAt,
        },
        idempotentReplay: true,
    };
}

function hollowGatePetResultKey(playerName: string, battleToken: string): string {
    return `hg-pet-result:${playerName}:${battleToken}`;
}

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function petArenaRyoReward(opponentLevel: number): number {
    // Ryo economy rebalance: tuned down from `level * 5` to `level * 2` so the
    // pet arena — a low-effort, 100/day faucet — stops out-earning the active
    // mission loop and inflating ryo. Floor of 20 keeps low-level wins worth it.
    return Math.max(20, opponentLevel * 2);
}

/** Warfront currently reads stats/roles only and never applies loadout items.
 * Spending a selected pet's single-use item at settlement would therefore take
 * something the match did not use. Other casual pet battles keep their existing
 * consumption rule. */
export function settleCasualPetConsumables(
    pets: Array<Record<string, unknown>>,
    selectedPetIds: readonly string[],
    mode: string,
): Array<Record<string, unknown>> {
    if (mode === 'warfront') return pets;
    return pets.map((pet) => selectedPetIds.includes(String(pet?.id ?? '')) && pet.loadout && typeof pet.loadout === 'object'
        ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } }
        : pet);
}

export type ManualWarfrontReplayResult = { outcome: PetBattleOutcome; ticks: number };

/** Replay a Manual Council match exclusively from the server-sealed snapshot.
 * Returns null for malformed, incomplete, extra, or ineffective choice logs. */
export function replayManualWarfrontDetailed(value: unknown, rawChoices: unknown): ManualWarfrontReplayResult | null {
    if (!isSealedManualWarfront(value)) return null;
    const choices = parseWarfrontChoiceLog(rawChoices);
    if (!choices) return null;
    const toSlots = (slots: SealedWarfrontSlot[]) => slots.map((slot) => ({
        role: slot.role,
        pet: slot.pet as unknown as Pet,
    }));
    // Settlement reads round state, effective choices, verdict, and ticks only.
    // The cinematic already happened in the browser; server replay needs no
    // presentation snapshots.
    const ctl = startWarfrontMatch(toSlots(value.blue), toSlots(value.red), value.seed, {
        ...value.options,
        captureSnapshots: false,
    });
    let choiceIndex = 0;
    let steps = 0;
    while (!ctl.done && steps++ <= MAX_MANUAL_COUNCILS + 1) {
        if (ctl.round === 0) {
            ctl.advanceRound();
            continue;
        }
        const entry = choices[choiceIndex];
        // A no-spend Council is still an explicit entry. Missing boundaries
        // must never silently become the sim's fallback auto/no-op behavior.
        if (!entry || entry.round !== ctl.round) return null;
        ctl.advanceRound(entry);
        choiceIndex++;
    }
    if (!ctl.done || choiceIndex !== choices.length || !ctl.result.winner) return null;
    const effective = ctl.result.choiceLog ?? [];
    if (!warfrontChoiceLogsEqual(effective, choices)) return null;
    return {
        outcome: ctl.result.winner === 'blue' ? 'win' : ctl.result.winner === 'red' ? 'loss' : 'draw',
        ticks: ctl.result.ticks,
    };
}

/** Backwards-compatible outcome-only replay contract used by focused parity
 * tests and any existing server callers. */
export function replayManualWarfront(value: unknown, rawChoices: unknown): PetBattleOutcome | null {
    return replayManualWarfrontDetailed(value, rawChoices)?.outcome ?? null;
}

// FIRST WARFRONT WIN OF THE DAY: the first server-verified Hollow Warfront
// vs-AI win each UTC day pays ×5 (the extra ×4 rides on the same sealed-level
// formula, so it stays inside the tuned-down faucet — a once-daily appointment,
// not a new grind). The claim date is committed in the same player-save write
// as the reward, then mirrored to the legacy NX day-key after that write. The
// per-player fail-closed lock serializes contenders, so a failed save cannot
// burn the day's bonus and parallel reports cannot double it.
const WARFRONT_FIRST_WIN_MULT = 5;
const WARFRONT_FIRST_WIN_TTL_SECONDS = 48 * 60 * 60;
function warfrontFirstWinKey(playerName: string, utcDate: string): string {
    return `pet:wf-first-win:${playerName}:${utcDate}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Rate limit BEFORE auth so unauthenticated spam at unknown names also
    // gets throttled. 5s window matches the realistic minimum battle length.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'pet-battle-result', 12, 60_000, peekName)) return;
    if (!enforceRateLimit(req, res, 'pet-battle-result-burst', 1, ARENA_WIN_RATE_LIMIT, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        let outcome = (body.outcome === 'win' || body.outcome === 'loss' || body.outcome === 'draw') ? body.outcome as PetBattleOutcome : null;
        // Ranked-pet-ladder marker. The private token — never this body — owns
        // the server-engine winner, both rating snapshots, and zero-ryo policy.
        const ranked = body.ranked === true;
        // The direct ranked result path must share the same fail-closed contract
        // as ranked-start and queue creation. This check happens before any
        // token/save read so legacy ratings-only or client-seeded tokens cannot
        // reach settlement unless the private server-engine rollout is enabled.
        // Casual/admin reports are unaffected.
        if (ranked && !petRankedStartsEnabled()) {
            return res.status(503).json({ error: PET_RANKED_DISABLED_REASON });
        }
        let opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(body.opponentLevel ?? 1))));
        // Optional opponent name — used to verify the claimed opponentLevel
        // against the opponent's actual saved level. Stops a level-5 player
        // from claiming wins against level-100 opponents to maximize the
        // `level * 2` ryo formula (200 ryo × 100/day = 20k ryo/day cheat).
        const opponentNameRaw = typeof body.opponentName === 'string' ? safeName(body.opponentName) : '';
        // Optional reportKey for refresh-replay dedup. Clients pass
        // `${battleSeed}:1v1` or `${battleSeed}:match:${i}`; same key from
        // the same player within REPORT_KEY_TTL_SECONDS is treated as a
        // duplicate (the refresh-replay scenario for pet PvP). Sanitized
        // to alphanumerics + : / - so it can't pollute the keyspace.
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        const battleTokenRaw = typeof body.battleToken === 'string' ? body.battleToken.trim() : '';
        const battleToken = /^[A-Za-z0-9]+$/.test(battleTokenRaw) ? battleTokenRaw : '';
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!outcome && !ranked) return res.status(400).json({ error: 'Invalid outcome.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own battles.' });
        }

        // reportKey is REQUIRED for wins. Previously optional, which let a
        // botted client omit it (or randomize per call) and farm the daily
        // cap with zero real battles. Admins and 'loss' outcomes are exempt
        // because losses don't pay out so duplicates are harmless.
        if (!identity.admin && !ranked && !reportKey) {
            return res.status(400).json({ error: 'Missing or invalid reportKey.' });
        }

        let casualBattleTokenKey: string | null = null;
        let casualBattleActiveKey: string | null = null;
        let casualBattleReceipt = '';
        let casualMode = '';
        let casualWarfrontRewardEligible = true;
        let casualPetIds: string[] = [];
        let hollowGatePetResult: HollowGatePetResultReceipt | null = null;
        // The reward level SEALED at battle-start (opponent actually fought). When
        // set, it — not the body-named opponent — decides the payout.
        let sealedOpponentLevel: number | null = null;
        let sealedRewardRyo: number | null = null;
        if (!ranked && !identity.admin) {
            if (!battleToken) return res.status(400).json({ error: 'A valid pet battle start token is required.' });
            const tokenKey = `pet:battle-token:${playerName}:${battleToken}`;
            const tokenData = await kv.get<{
                playerName?: string;
                reportKey?: string;
                opponentLevel?: number;
                rewardRyo?: number;
                playerPetIds?: string[];
                opponentPetIds?: string[];
                sealedOpponentPets?: Pet[];
                sealedParams?: SealedDuelParams | null;
                authoritativeOutcome?: PetBattleOutcome;
                manualWarfront?: SealedManualWarfront;
                hollowGate?: { runId?: string };
                mode?: string;
                createdAt?: number;
                notBefore?: number;
            }>(tokenKey);
            if (!tokenData || (tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                const priorHollowGateResult = await kv.get<HollowGatePetResultReceipt>(hollowGatePetResultKey(playerName, battleToken));
                if (priorHollowGateResult?.playerName === playerName) {
                    return res.status(200).json({
                        ok: true,
                        hollowGate: true,
                        outcome: priorHollowGateResult.outcome,
                        reward: 0,
                        petReceipt: battleToken,
                    });
                }
                // A response can disappear after the save commit and token
                // deletion. The receipt is stored in that same save write, so a
                // retry returns the original settlement instead of the ambiguous
                // old "spent token / reward 0" response.
                const settledSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const settledCharacter = settledSave?.character as Record<string, unknown> | undefined;
                const settledReceipt = findWarfrontSettlementReceipt(settledCharacter, battleToken, reportKey);
                const settledReport = settledReceipt ?? findWarfrontSettlementReceiptByReportKey(settledCharacter, reportKey);
                if (settledReport && settledCharacter) {
                    await reconcileWarfrontActiveAuthorization(
                        playerName,
                        battleToken,
                        settledReport.reportKey,
                        settledReport,
                    );
                    return res.status(200).json(warfrontReceiptResponse(
                        settledReport,
                        settledCharacter,
                        Number(settledSave?._saveVersion ?? 0),
                    ));
                }
                return res.status(200).json({ ok: true, reward: 0, reason: 'invalid-or-spent-pet-battle-token' });
            }
            if (tokenData.reportKey !== reportKey) {
                return res.status(403).json({ error: 'Pet battle token does not match this battle report.' });
            }
            let warfrontNotBefore = Number(tokenData.notBefore);
            if (tokenData.mode === 'warfront' && tokenData.manualWarfront) {
                const rawWarfrontChoices = (body as Record<string, unknown>).warfrontChoices;
                const replayed = replayManualWarfrontDetailed(tokenData.manualWarfront, rawWarfrontChoices);
                if (!replayed) {
                    return res.status(409).json({ error: 'Manual Warfront Council log is invalid or incomplete.' });
                }
                // The completed log must be the exact append-only path accepted
                // one Council at a time. Finalization shares that ledger's lock:
                // a concurrent retry can repeat the same path, never replace it.
                const finalizedAttempt = await finalizeManualWarfrontAttempt(
                    { playerName, battleToken, reportKey },
                    rawWarfrontChoices,
                    WARFRONT_TOKEN_TTL_SECONDS,
                );
                if (!finalizedAttempt.ok) {
                    return res.status(409).json({
                        error: 'Manual Warfront result does not match this token\'s committed Council path.',
                        code: `warfront-council-${finalizedAttempt.code}`,
                    });
                }
                // The watched verdict must agree with the server replay before
                // any token receipt or reward is written.
                if (outcome !== replayed.outcome) {
                    return res.status(409).json({ error: 'Manual Warfront result does not match the server replay.' });
                }
                outcome = replayed.outcome;
                const createdAt = Number(tokenData.createdAt);
                if (!Number.isFinite(createdAt) || createdAt <= 0) {
                    return res.status(409).json({ error: 'Warfront authorization lacks a valid start time.' });
                }
                warfrontNotBefore = createdAt + Math.ceil(replayed.ticks * 1000 / WARFRONT_TPS);
            } else {
                if (tokenData.authoritativeOutcome !== 'win' && tokenData.authoritativeOutcome !== 'loss' && tokenData.authoritativeOutcome !== 'draw') {
                    return res.status(409).json({ error: 'Pet battle token lacks an authoritative outcome.' });
                }
                if (tokenData.mode === 'warfront' && outcome !== tokenData.authoritativeOutcome) {
                    return res.status(409).json({ error: 'Warfront result does not match the sealed server simulation.' });
                }
            // ── The outcome is the SERVER's, never the client's ───────────────
            // Baseline: the value sealed at battle-start. When the token carries
            // sealed sim params (a PvE fight — the only kind the player can
            // command) and the report includes the input log, the server REPLAYS
            // the seeded cinematic sim with those inputs and uses what IT derives.
            // Either way `body.outcome` is discarded: the client is trusted to say
            // which buttons it pressed, never what pressing them accomplished.
            //
            // This is what closes plan §9.6 — before it, the reward came from an
            // AI-vs-AI simulation on a DIFFERENT engine than the one the player
            // watched, so outplaying the AI could still be scored a loss.
            outcome = tokenData.authoritativeOutcome;
            const sealedParams = tokenData.sealedParams ?? null;
            if (sealedParams) {
                const inputLog = parseDuelInputLog((body as Record<string, unknown>).inputLog);
                // A malformed log is NOT a payout: fall back to the sealed
                // baseline, which is the uncommanded fight. Never better than the
                // behaviour this replaced.
                if (inputLog) {
                    const meSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const meChar = meSave?.character as Record<string, unknown> | undefined;
                    const storedPets = Array.isArray(meChar?.pets) ? meChar.pets as Array<Record<string, unknown>> : [];
                    // Re-resolved from the save and the server's own AI roster —
                    // the token carries ids, never combat stats.
                    const replayPlayerPets = (Array.isArray(tokenData.playerPetIds) ? tokenData.playerPetIds : [])
                        .map((id) => storedPets.find((pet) => String(pet?.id ?? '') === id))
                        .filter(Boolean) as unknown as Pet[];
                    const replayOpponentPets = Array.isArray(tokenData.sealedOpponentPets) && tokenData.sealedOpponentPets.length
                        ? tokenData.sealedOpponentPets
                        : (Array.isArray(tokenData.opponentPetIds) ? tokenData.opponentPetIds : [])
                            .map((id) => SERVER_ARENA_PETS[id])
                            .filter(Boolean) as Pet[];
                    if (replayPlayerPets.length && replayOpponentPets.length) {
                        try {
                            outcome = replayCasualPetDuel(replayPlayerPets, replayOpponentPets, sealedParams, inputLog).outcome;
                        } catch (replayErr) {
                            // Keep the sealed baseline rather than paying blind.
                            console.error('[pet/battle-result] input-log replay failed', replayErr);
                        }
                    }
                }
            }
            }
            if (tokenData.mode === 'warfront') {
                const createdAt = Number(tokenData.createdAt);
                if (!Number.isFinite(createdAt) || createdAt <= 0) {
                    return res.status(409).json({ error: 'Warfront authorization lacks a valid start time.' });
                }
                // Legacy in-flight authorizations without a sealed finish time
                // fall back to the full regulation clock instead of becoming an
                // instant payout/reroll path.
                if (!Number.isFinite(warfrontNotBefore) || warfrontNotBefore < createdAt) {
                    warfrontNotBefore = createdAt + WF_MAX_SECONDS * 1000;
                }
                const retryAfterMs = Math.ceil(warfrontNotBefore - Date.now());
                if (retryAfterMs > 0) {
                    return res.status(425).json({
                        error: 'This sealed Warfront is still inside its regulation match clock.',
                        code: 'warfront-result-too-early',
                        retryAfterMs,
                    });
                }
            }
            opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(tokenData.opponentLevel ?? opponentLevelRaw))));
            sealedOpponentLevel = opponentLevelRaw;
            const tokenReward = Number(tokenData.rewardRyo);
            if (!Number.isSafeInteger(tokenReward) || tokenReward < 20 || tokenReward > 250) {
                return res.status(409).json({ error: 'Pet battle token lacks a valid sealed reward.' });
            }
            sealedRewardRyo = tokenReward;
            casualBattleTokenKey = tokenKey;
            casualBattleActiveKey = `pet:battle-active:${playerName}`;
            casualBattleReceipt = battleToken;
            casualMode = typeof tokenData.mode === 'string' ? tokenData.mode : '';
            casualWarfrontRewardEligible = isWarfrontRewardEligible(casualMode, Boolean(tokenData.manualWarfront));
            casualPetIds = Array.isArray(tokenData.playerPetIds) ? tokenData.playerPetIds : [];
            if (tokenData.hollowGate?.runId) {
                hollowGatePetResult = {
                    playerName,
                    runId: String(tokenData.hollowGate.runId),
                    outcome,
                    playerPetIds: casualPetIds,
                    settledAt: Date.now(),
                };
            }
        }

        const releaseCasualBattle = async (): Promise<void> => {
            if (casualBattleTokenKey) await kv.del(casualBattleTokenKey).catch(() => undefined);
            if (casualBattleActiveKey) await kv.delIfEqual(casualBattleActiveKey, battleToken).catch(() => undefined);
        };

        // Hollow Gate pet duels do not pay the ordinary Coliseum faucet. Their
        // server-replayed outcome becomes a one-use receipt consumed by the
        // run-bound Hollow Gate settlement endpoint.
        if (hollowGatePetResult && casualBattleTokenKey) {
            await kv.set(
                hollowGatePetResultKey(playerName, battleToken),
                hollowGatePetResult,
                { nx: true, ex: HOLLOW_GATE_PET_RECEIPT_TTL_SECONDS },
            );
            await releaseCasualBattle();
            return res.status(200).json({
                ok: true,
                hollowGate: true,
                outcome: hollowGatePetResult.outcome,
                reward: 0,
                petReceipt: battleToken,
            });
        }

        // ── opponentLevel cross-check ─────────────────────────────────
        // When the client tells us who the opponent was, verify the
        // claimed level matches that opponent's actual save. Players who
        // omit opponentName (legacy clients, AI duels with no named foe)
        // fall back to the level-cap rule below.
        // The opponent's level is trusted ONLY when we can AUTHENTICATE it
        // against their real save. In every other case — no opponent named, OR a
        // named opponent whose save doesn't exist — the claimed level is clamped
        // to myLevel + 10. This closes the hole (audit #5) where supplying a
        // non-existent opponentName took the `if` branch but found no oppChar, so
        // BOTH the actual-level correction and the myLevel+10 clamp were skipped,
        // letting a level-1 player claim opponentLevel 100 for the full
        // 200-ryo-per-win formula (× the 100/day cap = 20k ryo/day for no battles).
        let opponentLevel = opponentLevelRaw;
        if (sealedOpponentLevel != null) {
            // Casual path: pay out from the level SEALED at battle-start (the
            // opponent actually fought). The body-named opponent is IGNORED here —
            // otherwise a player could beat a trivial level-8 AI, then report a
            // real level-100 name to be paid `level*2` ryo (200 vs ~20) for a
            // fight that never happened (× the 100/day cap ≈ 20k ryo/day).
            opponentLevel = sealedOpponentLevel;
        } else {
            // No sealed token (admin path). Authenticate the claimed level against
            // the named opponent's real save; otherwise clamp to myLevel + 10.
            let verifiedLevel: number | null = null;
            if (opponentNameRaw && opponentNameRaw !== playerName) {
                const oppSave = await kv.get<Record<string, unknown>>(`save:${opponentNameRaw}`);
                const oppChar = (oppSave?.character ?? null) as Record<string, unknown> | null;
                if (oppChar) {
                    verifiedLevel = Math.max(1, Math.min(100, Math.floor(Number(oppChar.level ?? 1))));
                }
            }
            if (verifiedLevel != null) {
                opponentLevel = verifiedLevel;
            } else if (!identity.admin) {
                const meSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const meChar = (meSave?.character ?? null) as Record<string, unknown> | null;
                const myLevel = Math.max(1, Math.min(100, Math.floor(Number(meChar?.level ?? 1))));
                opponentLevel = Math.min(opponentLevelRaw, myLevel + 10);
            }
        }

        const saveKey = `save:${playerName}`;

        // ── Ranked pet ladder credit (private server resolution only) ─────────
        // Only a private queue-bound token carrying a server-engine resolution
        // may select a winner.
        // A client outcome is consistency evidence, never winner authority.
        // Each side's Elo patch and idempotency receipt commit in one save write;
        // no separate receipt key can survive while its rating write is lost.
        if (ranked) {
            const matchToken = typeof body.matchToken === 'string' ? body.matchToken.trim() : '';
            if (!isPetRankedMatchId(matchToken)) {
                return res.status(400).json({ error: 'A valid pet ranked match token is required.' });
            }
            const tok = await loadPetRankedAuthorityToken(kv, matchToken);
            if (!tok) {
                return res.status(400).json({ error: 'A valid pet ranked match token is required (start via /api/pet/ranked-start).' });
            }
            if (tok.matchId !== matchToken) {
                return res.status(409).json({ error: 'Ranked token key does not match its server receipt.' });
            }
            // body.outcome is deliberately not passed. It is neither a winner
            // selector nor a required consistency input; forged and stale client
            // banners cannot change or suppress the already server-owned result.
            const decision = derivePetRankedSettlement(tok, playerName);
            if (!decision.ok) {
                if (decision.reason === 'caller-not-in-match') {
                    return res.status(403).json({ error: 'Match token does not name you.' });
                }
                return res.status(409).json({ error: 'Ranked token lacks a valid server-engine resolution.' });
            }
            outcome = decision.settlement.authoritativeOutcome;

            try {
                const out = await settlePetRankedMatchDurably(kv, {
                    matchToken,
                    token: tok,
                    lock: (key, action) => withKvLock(key, action, { failClosed: true }),
                });
                const rating = playerName === safeName(tok.a) ? out.a.rating : out.b.rating;
                await releasePetRankedActivePair(kv, [tok.a, tok.b], matchToken);
                const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
                const finalChar = (finalSave?.character ?? null) as Record<string, unknown> | null;
                return res.status(200).json({
                    ok: true,
                    ranked: true,
                    outcome,
                    reward: 0,
                    rating,
                    character: finalChar,
                    _saveVersion: Number(finalSave?._saveVersion ?? 0),
                });
            } catch (rankedErr) {
                // Lock contention/outage (failClosed) or a partial two-save
                // failure. Any committed side has its receipt in that same save;
                // any uncommitted side has no receipt, so retry safely finishes it.
                console.error('[pet/battle-result] ranked credit failed', rankedErr);
                return res.status(503).json({ error: 'Could not record ranked result — please retry.' });
            }
        }

        // Apply under a per-player lock so simultaneous result POSTs (e.g.
        // double-clicked Confirm) can't both award ryo + increment counters.
        const result = await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            if (!record) return { error: 'no-save' as const };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { error: 'no-character' as const };
            if (casualMode === 'warfront' && casualBattleTokenKey) {
                const settledReport = findWarfrontSettlementReceiptByReportKey(char, reportKey);
                if (settledReport) {
                    await releaseCasualBattle();
                    return warfrontReceiptResponse(settledReport, char, Number(record._saveVersion ?? 0));
                }
            }
            if (casualBattleTokenKey) {
                const receipts = Array.isArray(char.redeemedPetBattleTokens)
                    ? (char.redeemedPetBattleTokens as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-63)
                    : [];
                if (receipts.includes(casualBattleReceipt)) {
                    await releaseCasualBattle();
                    const settledReceipt = findWarfrontSettlementReceipt(char, casualBattleReceipt, reportKey);
                    if (settledReceipt) {
                        return warfrontReceiptResponse(settledReceipt, char, Number(record._saveVersion ?? 0));
                    }
                    return {
                        ok: true,
                        reward: 0,
                        reason: 'invalid-or-spent-pet-battle-token',
                        totalPetWins: Number(char.totalPetWins ?? 0),
                        dailyPetWins: Number(char.dailyPetWins ?? 0),
                        balances: { ryo: Number(char.ryo ?? 0) },
                        _saveVersion: Number(record._saveVersion ?? 0),
                        character: char,
                    };
                }
                char.redeemedPetBattleTokens = [...receipts, casualBattleReceipt];
            }
            const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
            const spentPets = settleCasualPetConsumables(pets, casualPetIds, casualMode);
            const spentChar = { ...char, pets: spentPets };

            const today = utcDateKey();
            const lastReset = String(char.lastDailyReset ?? '');
            // Reset daily counters when the UTC day rolls over.
            const dailyPetWins = lastReset === today ? Number(char.dailyPetWins ?? 0) : 0;
            const withWarfrontReceipt = (
                nextCharacter: Record<string, unknown>,
                receipt: Omit<WarfrontSettlementReceipt, 'battleToken' | 'reportKey' | 'settledAt'>,
            ): Record<string, unknown> => casualMode === 'warfront' && casualBattleReceipt
                ? appendWarfrontSettlementReceipt(nextCharacter, {
                    ...receipt,
                    battleToken: casualBattleReceipt,
                    reportKey,
                    settledAt: Date.now(),
                })
                : nextCharacter;

            // A Manual Council seed has to be revealed for deterministic local
            // playback, which makes outcome-based credit unsafe. A complete
            // server replay still earns one fixed base-reward Coach completion
            // (up to the mastery cap), independent of win/loss/draw. It never
            // changes win counters or first-win progression.
            if (casualMode === 'warfront' && !casualWarfrontRewardEligible) {
                if (!outcome) throw new Error('Manual Warfront settlement lost its verified outcome.');
                const coachMastery = nextWarfrontCoachMasteryReceipt(char, today, true);
                const baseAmount = warfrontBaseRyoReward(opponentLevel);
                const amount = coachMastery.earned === 1 ? baseAmount : 0;
                const coachReward: WarfrontCoachRewardReceipt = {
                    kind: 'coach-completion',
                    currency: 'ryo',
                    day: today,
                    baseAmount,
                    amount,
                    completedToday: coachMastery.completedToday,
                    dailyCap: WARFRONT_COACH_COMPLETION_DAILY_CAP,
                    capped: coachMastery.capped,
                };
                const rewardedChar = { ...spentChar, ryo: Number(char.ryo ?? 0) + amount };
                const settlementReceipt: WarfrontSettlementReceipt = {
                    battleToken: casualBattleReceipt,
                    reportKey,
                    outcome,
                    reward: amount,
                    firstWinOfDay: false,
                    firstWinBonus: 0,
                    capped: coachMastery.capped,
                    rewardEligible: false,
                    coachMastery,
                    coachReward,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                    settledAt: Date.now(),
                };
                const recordedChar = appendWarfrontSettlementReceipt(rewardedChar, settlementReceipt);
                const spentRecord = bumpSaveVersion({ ...record, character: recordedChar });
                await writeSaveProjected(saveKey, spentRecord, record);
                await releaseCasualBattle();
                return {
                    ...warfrontReceiptResponse(
                        settlementReceipt,
                        recordedChar,
                        Number((spentRecord as Record<string, unknown>)._saveVersion ?? 0),
                    ),
                    idempotentReplay: false,
                };
            }

            // Loss: no reward, but still track win streak metadata. We don't
            // currently store losses anywhere — return ok so the client UI
            // can show "recorded" instead of silently no-op'ing.
            if (outcome === 'loss' || outcome === 'draw') {
                const recordedChar = withWarfrontReceipt(spentChar, {
                    outcome,
                    reward: 0,
                    firstWinOfDay: false,
                    firstWinBonus: 0,
                    capped: false,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                });
                const spentRecord = bumpSaveVersion({ ...record, character: recordedChar });
                await writeSaveProjected(saveKey, spentRecord, record);
                await releaseCasualBattle();
                return {
                    ok: true,
                    outcome,
                    reward: 0,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                    balances: { ryo: Number(char.ryo ?? 0) },
                    _saveVersion: Number((spentRecord as Record<string, unknown>)._saveVersion ?? 0),
                    character: recordedChar,
                };
            }

            // Daily cap: stop further reward grants once the cap is hit, but
            // still acknowledge the call (so a streamer grinding all day
            // doesn't see error spam — they just stop earning).
            if (dailyPetWins >= DAILY_ARENA_WIN_CAP) {
                const recordedChar = withWarfrontReceipt(spentChar, {
                    outcome: 'win',
                    reward: 0,
                    firstWinOfDay: false,
                    firstWinBonus: 0,
                    capped: true,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                });
                const spentRecord = bumpSaveVersion({ ...record, character: recordedChar });
                await writeSaveProjected(saveKey, spentRecord, record);
                await releaseCasualBattle();
                return {
                    ok: true,
                    outcome: 'win' as const,
                    reward: 0,
                    capped: true,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                    balances: { ryo: Number(char.ryo ?? 0) },
                    _saveVersion: Number((spentRecord as Record<string, unknown>)._saveVersion ?? 0),
                    character: recordedChar,
                };
            }

            // Casual rewards come from the opponent PET SNAPSHOT sealed at
            // battle-start. Account level is retained only for the trusted
            // admin compatibility path, never for ordinary player receipts.
            const baseReward = petArenaRyoReward(opponentLevel);
            const authoritativeBaseReward = sealedRewardRyo ?? baseReward;
            // This read is inside the per-player lock. The durable in-save date
            // is authoritative; the old day-key prevents a same-day regrant to
            // players who already claimed before this in-save marker shipped.
            const isWarfrontWin = casualMode === 'warfront';
            const firstWinKey = warfrontFirstWinKey(playerName, today);
            const legacyFirstWinClaimed = isWarfrontWin ? Boolean(await kv.get(firstWinKey)) : false;
            const firstWinOfDay = isWarfrontWin
                && String(char.lastWarfrontFirstWinDate ?? '') !== today
                && !legacyFirstWinClaimed;
            const firstWinBonus = firstWinOfDay ? authoritativeBaseReward * (WARFRONT_FIRST_WIN_MULT - 1) : 0;
            const reward = authoritativeBaseReward + firstWinBonus;
            const updatedCharBase = {
                ...spentChar,
                ryo: Number(char.ryo ?? 0) + reward,
                totalPetWins: Number(char.totalPetWins ?? 0) + 1,
                dailyPetWins: dailyPetWins + 1,
                lastDailyReset: today,
                ...(isWarfrontWin ? { lastWarfrontFirstWinDate: today } : {}),
            };
            const updatedChar = withWarfrontReceipt(updatedCharBase, {
                outcome: 'win',
                reward,
                firstWinOfDay,
                firstWinBonus,
                capped: false,
                totalPetWins: Number(updatedCharBase.totalPetWins),
                dailyPetWins: Number(updatedCharBase.dailyPetWins),
            });
            const updated = bumpSaveVersion({ ...record, character: updatedChar });
            await writeSaveProjected(saveKey, updated, record);
            // Only reserve/repair the external day key AFTER the reward + date
            // were committed. A write failure therefore leaves no consumed key.
            if (isWarfrontWin && !legacyFirstWinClaimed) {
                await kv.set(firstWinKey, 1, { nx: true, ex: WARFRONT_FIRST_WIN_TTL_SECONDS } as never);
            }
            await releaseCasualBattle();
            return {
                ok: true,
                outcome: 'win' as const,
                reward,
                firstWinOfDay,
                firstWinBonus,
                totalPetWins: Number(updatedChar.totalPetWins ?? 0),
                dailyPetWins: Number(updatedChar.dailyPetWins ?? 0),
                balances: { ryo: Number(updatedChar.ryo) },
                _saveVersion: Number((updated as Record<string, unknown>)._saveVersion ?? 0),
                character: updatedChar,
            };
        }, { failClosed: true });

        if ('error' in result) {
            const code = result.error === 'no-save' || result.error === 'no-character' ? 404 : 500;
            return res.status(code).json({ error: result.error });
        }
        if (casualMode === 'warfront') {
            // Receipt/save commit happens inside the lock above. Only now may
            // this exact match unlock the player's next server scouting seed.
            const settledReceipt = findWarfrontSettlementReceipt(
                (result as { character?: Record<string, unknown> }).character,
                casualBattleReceipt,
                reportKey,
            ) ?? findWarfrontSettlementReceiptByReportKey(
                (result as { character?: Record<string, unknown> }).character,
                reportKey,
            );
            await reconcileWarfrontActiveAuthorization(
                playerName,
                casualBattleReceipt,
                reportKey,
                settledReceipt,
            );
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[pet/battle-result]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
