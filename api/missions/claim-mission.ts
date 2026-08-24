import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { applyDerivedLevel } from '../_xp-engine.js';
import { combinedStatBoost } from '../_stat-growth.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    acknowledgeNewbieCombatRun,
    reportNewbieCombatRunOnce,
    reportNewbieEvent,
    utcDateKey,
} from './_progress.js';
import { recordEconomyTxn } from '../_economy.js';
import { recordBetaMetric, type BetaMetricEvent } from '../_beta-metrics.js';
import {
    acknowledgeLegacyCombatRun,
    bumpLegacyStats,
    bumpLegacyStatsForCombatRunOnce,
} from '../_legacy-track.js';
import {
    acknowledgeEraContribution,
    bumpEraContribution,
    bumpEraContributionOnce,
} from '../_era.js';
import {
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
    validateMissionProgressReceipt,
} from './_mission-progress-receipt.js';
import { COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON } from '../_release-flags.js';
import { canPlayerClaimMission, missionEligibilityFailureBody, type MissionEligibilityResult } from './_eligibility.js';
import { writeSaveProjected } from '../save/_projected-write.js';
import { syncCurrencyLedger } from '../_currency-ledger.js';
import { recordPetBreedingProgress } from '../pet/_breeding-requirements.js';
import {
    APEX_REWARD,
    APEX_STAT_POINTS,
    apexClaimableWeeks,
    apexClaimedThisWeek,
    apexKillReceiptKey,
    canTakeApex,
} from './_apex-contract.js';
import {
    combatMissionByKey,
    fieldMissionById,
    huntMissionById,
    ACADEMY_TRIAL,
    ACADEMY_CHECKLIST,
    FIELD_MISSION_STAT_POINTS,
    ACADEMY_TRIAL_STAT_POINTS,
    ACADEMY_CHECKLIST_STAT_POINTS,
    missionRewardBonusPct,
    boostAmount,
    hasDailyMissionSlot,
    hasDailyHuntSlot,
    markMissionCompletedFields,
    markHuntCompletedFields,
    applyCurrencyRewardFields,
    grantItemsToInventory,
    type CurrencyKey,
} from './_mission-catalog.js';
import {
    MISSION_COMBAT_SESSION_TTL_MS,
    missionCombatActiveKey,
    missionCombatBindingKey,
    missionCombatRewardFingerprint,
    validateSettledMissionCombatSession,
    type MissionCombatActivePointer,
    type MissionCombatBinding,
} from './_authoritative-combat-session.js';
import { readSoloPveSession } from '../solo-pve/_store.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import {
    appendCombatMissionClaimSettlement,
    combatMissionClaimPaymentMatches,
    combatMissionClaimTokenKey,
    combatMissionClaimTokenMatches,
    compareSetExactKvRow,
    confirmCombatMissionClaimSave,
    createCombatMissionClaimToken,
    createCombatMissionClaimPaymentReservation,
    inspectCombatMissionClaimSettlement,
    latestCombatMissionClaimSettlement,
    parseCombatMissionClaimPaymentReservation,
    parseCombatMissionClaimToken,
    parseSpentCombatMissionClaimToken,
    replaceCombatMissionClaimSettlement,
    reserveCombatMissionClaimPayment,
    retireCombatMissionClaimToken,
    type CombatMissionClaimPaymentReservation,
    type CombatMissionClaimResult,
    type CombatMissionClaimSettlement,
    type CombatMissionClaimToken,
} from './_combat-claim-authority.js';
import { serverFieldMissionRun, withoutServerFieldMissionRun } from './_field-trail.js';

// Server-authoritative mission claim. Replaces the old client-side reward math
// for built-in COMBAT, FIELD and HUNT missions and the onboarding ACADEMY-TRIAL:
// the client posts only { missionType, missionId } — never amounts — and the
// server resolves the reward from the trusted catalog, recomputes XP with the
// same engine as the client (api/_xp-engine.gainXp), enforces eligibility,
// persists under the save lock, and returns the server-computed amounts for the
// client to mirror onto its local character (reconcile pattern as report-pet-event).
//
// Eligibility enforced server-side (against the SAVED character, not the body):
//   • combat       — missionId must be in pendingCombatMissionClaims (queued by
//                    the Arena win); consumed on claim. Counts toward daily cap.
//   • field        — level requirement + daily cap. (Explore/raid progress stays
//                    client-tracked — same trust model as raids/expeditions.)
//   • hunt         — Hunter Guild contract: level req + the INDEPENDENT daily
//                    hunt cap; grants material drops (itemRewards) server-side so
//                    they can't be minted client-side (audit M-1). Hunt progress
//                    (explore count) stays client-tracked like field missions.
//   • academy-trial— one-time (character.academyTrialClaimed). OFF the daily cap.
//
// Unknown / creator-authored mission ids are not paid here. Rewarded missions
// must be in the server catalog so eligibility and payout are authoritative.

const monthKeyOf = (): string => new Date().toISOString().slice(0, 7);

function betaEventForMissionType(missionType: string): BetaMetricEvent {
    if (missionType === 'hunt') return 'hunt.claimed';
    if (missionType === 'academy-trial') return 'academy.trial.claimed';
    if (missionType === 'academy-checklist') return 'academy.checklist.claimed';
    return 'mission.claimed';
}

type SaveChar = Record<string, unknown>;

type ClaimOutcome =
    | {
        applied: false;
        reason: string;
        clientFallback?: boolean;
        error?: string;
        requiredLevel?: number;
        playerLevel?: number;
        requiredSystem?: string;
        requiredProfession?: string;
        requiredProfessionRank?: number;
        /**
         * What the server's progress receipt ACTUALLY holds, when a field claim
         * is rejected for incomplete progress. The client's local counters are
         * optimistic and can run ahead of the receipt (a dropped ping, or the
         * period when the producers never wrote one at all); without this the
         * card is stuck rendering "Claim Reward" forever with no way to advance.
         * Mirroring these values back onto local progress re-opens the mission.
         */
        serverProgress?: { exploreCount: number; raidCount: number };
    }
    | {
        applied: true;
        saveVersion: number;
        reward: {
            xpBoosted: number;        // base after town-hall boost; client passes to gainXp
            statPoints: number;
            ryo: number;
            stamina: number;
            territoryScrolls: number;
            currency: Partial<Record<CurrencyKey, number>>;
            items: string[];          // literal item ids (hunt material drops)
        };
        combat?: { aiProfileId: string; missionKey: string };
        completion: 'daily' | 'total' | 'none' | 'hunt';
        replayed?: boolean;
        combatRunId?: string;
        /** Internal recovery binding; stripped from the HTTP response. */
        combatSettlementFingerprint?: string;
        academyTrialClaimed?: boolean;
        academyChecklistClaimed?: boolean;
    };

export function applyClaimedMissionState(
    record: Record<string, unknown>,
    missionType: string,
    missionId: string,
): Record<string, unknown> {
    if (missionType !== 'field' && missionType !== 'hunt') return record;

    const updated: Record<string, unknown> = { ...record };
    if (Array.isArray(updated.acceptedMissionIds)) {
        updated.acceptedMissionIds = updated.acceptedMissionIds.map(String).filter((id) => id !== missionId);
    }

    const progress = updated.missionProgress;
    if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
        const nextProgress = { ...(progress as Record<string, unknown>) };
        nextProgress[missionId] = 0;
        if (missionType === 'field') nextProgress[`${missionId}:raids`] = 0;
        updated.missionProgress = nextProgress;
    }

    return updated;
}

// Self-heal for the stale combat-claim trap. A high-rank combat mission (C/B/A/S)
// can only be claimed with the single-use authority token minted from a completed
// server-bound fight (see queue-combat-claim). That token has a 6h TTL; the durable
// pendingCombatMissionClaims flag written alongside it does NOT expire. So a win
// claimed after the window — or one queued before the token gate existed (e.g.
// before the cPanel→Postgres cutover) — leaves the flag set with no token behind it.
// The mission card renders ONLY "Claim Reward" while that flag is set, so the player
// can never re-fight to re-mint the token: the claim fails forever with the opaque
// server_authoritative_combat_required reason. Dropping the stale key flips the card
// back to "Begin Mission" so a fresh win can re-mint the token and pay out. No-op
// (returns the same reference) when the key isn't present.
export function clearStalePendingCombatClaim(
    char: Record<string, unknown>,
    missionKey: string,
): { char: Record<string, unknown>; cleared: boolean } {
    const pending = Array.isArray(char.pendingCombatMissionClaims)
        ? (char.pendingCombatMissionClaims as unknown[]).map(String)
        : [];
    if (!pending.includes(missionKey)) return { char, cleared: false };
    return { char: { ...char, pendingCombatMissionClaims: pending.filter((k) => k !== missionKey) }, cleared: true };
}

function eligibilityFailure(check: MissionEligibilityResult): Extract<ClaimOutcome, { applied: false }> {
    const body = missionEligibilityFailureBody(check);
    return {
        applied: false,
        reason: String(body.reason ?? 'not-yet-unlocked'),
        error: String(body.error ?? 'mission_not_eligible'),
        requiredLevel: body.requiredLevel,
        playerLevel: body.playerLevel,
        requiredSystem: body.requiredSystem,
        requiredProfession: body.requiredProfession,
        requiredProfessionRank: body.requiredProfessionRank,
    };
}

async function readCombatClaimSettlement(
    saveKey: string,
    runId: string,
    missionId: string,
    rewardFingerprint: string,
): Promise<{ record: Record<string, unknown>; character: SaveChar; settlement: CombatMissionClaimSettlement }> {
    const record = await kv.get<Record<string, unknown>>(saveKey);
    const character = record?.character as SaveChar | undefined;
    if (!record || !character) throw new Error('combat-mission-post-effect-save-missing');
    const inspected = inspectCombatMissionClaimSettlement(character, runId, missionId, rewardFingerprint);
    if (inspected.status !== 'replay') throw new Error(`combat-mission-post-effect-receipt-${inspected.status}`);
    return { record, character, settlement: inspected.receipt };
}

async function mutateCombatClaimSettlement(params: {
    saveKey: string;
    playerName: string;
    runId: string;
    missionId: string;
    rewardFingerprint: string;
    mutate: (
        character: SaveChar,
        settlement: CombatMissionClaimSettlement,
    ) => { character: SaveChar; settlement: CombatMissionClaimSettlement } | null;
}): Promise<CombatMissionClaimSettlement> {
    return withKvLock(params.saveKey, async () => {
        const current = await readCombatClaimSettlement(
            params.saveKey,
            params.runId,
            params.missionId,
            params.rewardFingerprint,
        );
        const mutation = params.mutate(current.character, current.settlement);
        if (!mutation) return current.settlement;
        const nextCharacter = replaceCombatMissionClaimSettlement(
            mutation.character,
            mutation.settlement,
        ) as SaveChar;
        const nextRecord = mergePreservingImages(bumpSaveVersion<Record<string, unknown>>({
            ...current.record,
            character: nextCharacter,
        }), current.record) as Record<string, unknown>;
        const mergedCharacter = nextRecord.character as SaveChar;
        nextRecord.character = {
            ...mergedCharacter,
            // Receipt arrays are run-keyed, not positional. The generic image
            // merge pairs id-less arrays by index and could otherwise copy a
            // prior run's effect stamps onto a newly prepended settlement.
            combatMissionClaimSettlements: nextCharacter.combatMissionClaimSettlements,
        };
        await compareSetExactKvRow(kv, params.saveKey, current.record, nextRecord);
        await syncCurrencyLedger(params.playerName, nextRecord, {
            previousCharacter: current.character,
        });
        const confirmed = await readCombatClaimSettlement(
            params.saveKey,
            params.runId,
            params.missionId,
            params.rewardFingerprint,
        );
        return confirmed.settlement;
    }, { failClosed: true, ttlSec: 15 });
}

async function completeCombatMissionPostEffects(params: {
    saveKey: string;
    playerName: string;
    runId: string;
    missionId: string;
    rewardFingerprint: string;
}): Promise<CombatMissionClaimSettlement> {
    let current = await readCombatClaimSettlement(
        params.saveKey,
        params.runId,
        params.missionId,
        params.rewardFingerprint,
    );

    if (!current.settlement.effects?.newbieAppliedAt) {
        const newbie = await reportNewbieCombatRunOnce({
            playerName: params.playerName,
            runId: params.runId,
            settledAt: current.settlement.settledAt,
        });
        const appliedAt = Date.now();
        const receipt = await mutateCombatClaimSettlement({
            ...params,
            mutate: (character, settlement) => {
                if (settlement.effects?.newbieAppliedAt) return null;
                // `reportNewbieCombatRunOnce` returns the amount pinned in its
                // durable run marker before consulting the current profession.
                // A profession chosen after that marker committed must not erase
                // already-earned Ryo while this save receipt is being recovered.
                const ryoAwarded = newbie.ryoAwarded;
                return {
                    character: {
                        ...character,
                        ...(ryoAwarded > 0 ? { ryo: Number(character.ryo ?? 0) + ryoAwarded } : {}),
                    },
                    settlement: {
                        ...settlement,
                        effects: {
                            version: 1,
                            ...(settlement.effects ?? {}),
                            newbieAppliedAt: appliedAt,
                            newbieRyoAwarded: ryoAwarded,
                        },
                    },
                };
            },
        });
        current = { ...current, settlement: receipt };
    }
    await acknowledgeNewbieCombatRun(params.playerName, params.runId);

    if (!current.settlement.effects?.legacyAppliedAt) {
        const legacyBootstrapCharacter = {
            ...current.character,
            // The payout save already contains this run's lifetime mirrors.
            // Seed a not-yet-created Legacy row from the pre-run baseline, then
            // apply the run-bound delta once, instead of counting the run twice.
            totalAiKills: Math.max(0, Number(current.character.totalAiKills ?? 0) - 1),
            totalMissionsCompleted: Math.max(0, Number(current.character.totalMissionsCompleted ?? 0) - 1),
        };
        await bumpLegacyStatsForCombatRunOnce(
            params.playerName,
            params.runId,
            { missionCompletions: 1, pveKills: 1 },
            legacyBootstrapCharacter,
        );
        const receipt = await mutateCombatClaimSettlement({
            ...params,
            mutate: (character, settlement) => settlement.effects?.legacyAppliedAt
                ? null
                : {
                    character,
                    settlement: {
                        ...settlement,
                        effects: { version: 1, ...(settlement.effects ?? {}), legacyAppliedAt: Date.now() },
                    },
                },
        });
        current = { ...current, settlement: receipt };
    }
    await acknowledgeLegacyCombatRun(params.playerName, params.runId);

    const eraReceiptId = `combat-mission:${params.playerName}:${params.runId}`;
    if (!current.settlement.effects?.eraAppliedAt) {
        await bumpEraContributionOnce('missions', eraReceiptId);
        const receipt = await mutateCombatClaimSettlement({
            ...params,
            mutate: (character, settlement) => settlement.effects?.eraAppliedAt
                ? null
                : {
                    character,
                    settlement: {
                        ...settlement,
                        effects: { version: 1, ...(settlement.effects ?? {}), eraAppliedAt: Date.now() },
                    },
                },
        });
        current = { ...current, settlement: receipt };
    }
    await acknowledgeEraContribution('missions', eraReceiptId);

    if (!current.settlement.effects?.completedAt) {
        const receipt = await mutateCombatClaimSettlement({
            ...params,
            mutate: (character, settlement) => {
                if (settlement.effects?.completedAt) return null;
                const pending = Array.isArray(character.pendingCombatMissionClaims)
                    ? character.pendingCombatMissionClaims.map(String)
                    : [];
                return {
                    character: {
                        ...character,
                        pendingCombatMissionClaims: pending.filter((key) => key !== params.missionId),
                    },
                    settlement: {
                        ...settlement,
                        effects: { version: 1, ...(settlement.effects ?? {}), completedAt: Date.now() },
                    },
                };
            },
        });
        current = { ...current, settlement: receipt };
    }
    return current.settlement;
}

/**
 * Recover the narrow rolling-deploy window where the previous claim worker
 * deleted its active token and then died before its payout save committed.
 *
 * The active pointer is deliberately the shortest-lived member of the combat
 * triplet, so requiring its original, unextended horizon keeps this recovery
 * bounded. Every identity and terminal-result field must agree before a new
 * worker is allowed to synthesize in-memory authority and CAS null -> paying.
 */
function recoverLegacyDeletedCombatClaim(params: {
    activeRaw: unknown;
    bindingRaw: unknown;
    session: SoloPveSession | null;
    playerName: string;
    mission: NonNullable<ReturnType<typeof combatMissionByKey>>;
    rewardFingerprint: string;
    now?: number;
}): CombatMissionClaimToken | null {
    const now = params.now ?? Date.now();
    if (!params.activeRaw || typeof params.activeRaw !== 'object' || Array.isArray(params.activeRaw)
        || !params.bindingRaw || typeof params.bindingRaw !== 'object' || Array.isArray(params.bindingRaw)) {
        return null;
    }
    const active = params.activeRaw as MissionCombatActivePointer;
    const binding = params.bindingRaw as MissionCombatBinding;
    const session = params.session;
    const mission = params.mission;
    const validActiveTimes = Number.isSafeInteger(active.createdAt) && active.createdAt > 0
        && Number.isSafeInteger(active.expiresAt)
        && active.expiresAt === active.createdAt + MISSION_COMBAT_SESSION_TTL_MS
        && active.expiresAt > now;
    if (active.version !== 1
        || !active.runId
        || active.runId !== active.sessionId
        || active.playerName !== params.playerName
        || active.missionId !== mission.key
        || !validActiveTimes) {
        return null;
    }
    const validBindingTimes = Number.isSafeInteger(binding.createdAt) && binding.createdAt === active.createdAt
        && Number.isSafeInteger(binding.expiresAt) && binding.expiresAt >= active.expiresAt
        && Number.isSafeInteger(binding.settledAt) && Number(binding.settledAt) > 0;
    if (binding.version !== 1
        || binding.runId !== active.runId
        || binding.sessionId !== active.sessionId
        || binding.playerName !== params.playerName
        || binding.missionId !== mission.key
        || binding.enemyProfileId !== mission.aiProfileId
        || binding.rewardFingerprint !== params.rewardFingerprint
        || binding.status !== 'won'
        || !validBindingTimes) {
        return null;
    }
    const validation = validateSettledMissionCombatSession({
        binding,
        session,
        playerName: params.playerName,
        mission,
        now,
    });
    if (!validation.ok || !session || session.createdAt !== active.createdAt
        || session.sessionId !== active.sessionId
        || session.status !== 'done'
        || session.winner !== 'player'
        || session.outcome !== 'win'
        || session.settlementState !== 'settled') {
        return null;
    }
    const evidence = session.terminalEvidence;
    const receipt = evidence?.receipt;
    const receiptRewards = receipt?.rewards;
    if (!evidence
        || !Number.isSafeInteger(evidence.finishedAt) || evidence.finishedAt <= 0
        || !evidence.finalMoveToken
        || !Number.isSafeInteger(evidence.finalVersion) || evidence.finalVersion <= 0
        || !Number.isSafeInteger(evidence.finalEventSeq) || evidence.finalEventSeq < 0
        || evidence.winner !== 'player'
        || evidence.outcome !== 'win'
        || evidence.settlementState !== 'settled'
        || receipt?.kind !== 'mission-queue'
        || receipt.id !== `${mission.key}:${active.runId}`
        || !Number.isSafeInteger(receipt.settledAt) || receipt.settledAt <= 0
        || !receiptRewards || typeof receiptRewards !== 'object'
        || receiptRewards.missionId !== mission.key
        || receiptRewards.queued !== true) {
        return null;
    }
    return createCombatMissionClaimToken({
        playerName: params.playerName,
        runId: active.runId,
        missionId: mission.key,
        enemyProfileId: mission.aiProfileId,
        rewardFingerprint: params.rewardFingerprint,
        wonAt: evidence.finishedAt,
    });
}

/**
 * Finish a payout whose active token was already fenced into durable `paying`
 * authority. The reservation pins every economic amount before the first save
 * attempt, so a pre-commit crash, catalog rollout, or unrelated intervening save
 * can apply the exact entitlement once without reopening old-worker authority.
 */
async function applyReservedCombatMissionPayout(params: {
    saveKey: string;
    playerName: string;
    record: Record<string, unknown>;
    character: SaveChar;
    reservation: CombatMissionClaimPaymentReservation;
}): Promise<Extract<ClaimOutcome, { applied: true }>> {
    const settlement = params.reservation.settlement;
    const inspected = inspectCombatMissionClaimSettlement(
        params.character,
        settlement.runId,
        settlement.missionId,
        settlement.rewardFingerprint,
    );
    if (inspected.status === 'conflict') {
        throw new Error('combat-mission-reserved-payout-conflict');
    }
    if (inspected.status === 'replay') {
        return {
            applied: true,
            replayed: true,
            combatRunId: inspected.receipt.runId,
            combatSettlementFingerprint: inspected.receipt.rewardFingerprint,
            saveVersion: Number(params.record._saveVersion ?? 0),
            reward: {
                ...inspected.receipt.result.reward,
                // Hard cutover: even a receipt created by an older worker cannot
                // expose or re-mint the retired normal-drop reward on replay.
                territoryScrolls: 0,
                currency: inspected.receipt.result.reward.currency as Partial<Record<CurrencyKey, number>>,
            },
            combat: inspected.receipt.result.combat,
            completion: inspected.receipt.result.completion,
        };
    }

    // A payment reservation can outlive a deployment. Sanitize an old reserved
    // reward here so rolling deploys cannot mint a normal-drop scroll later.
    const reward = { ...settlement.result.reward, territoryScrolls: 0 };
    let next: SaveChar = { ...params.character };
    if (reward.statPoints > 0) {
        next = {
            ...next,
            unspentStats: Math.max(0, Math.floor(Number(next.unspentStats) || 0)) + reward.statPoints,
        };
    }
    next = applyDerivedLevel(next) as SaveChar;
    next = { ...next, ryo: Number(next.ryo ?? 0) + reward.ryo };
    if (reward.stamina > 0) {
        next = {
            ...next,
            stamina: Math.min(Number(next.maxStamina ?? 0), Number(next.stamina ?? 0) + reward.stamina),
        };
    }
    if (reward.items.length > 0) {
        next = { ...next, inventory: grantItemsToInventory(next, reward.items) };
    }
    next = {
        ...next,
        ...applyCurrencyRewardFields(next, reward.currency as Partial<Record<CurrencyKey, number>>),
    };

    const aiId = settlement.result.combat.aiProfileId;
    const defeated = Array.isArray(next.defeatedAiIds) ? next.defeatedAiIds as string[] : [];
    const aiKills = next.aiKills && typeof next.aiKills === 'object'
        ? next.aiKills as Record<string, number>
        : {};
    const pending = Array.isArray(next.pendingCombatMissionClaims)
        ? next.pendingCombatMissionClaims as string[]
        : [];
    next = {
        ...next,
        totalAiKills: Number(next.totalAiKills ?? 0) + 1,
        dailyAiKills: Number(next.dailyAiKills ?? 0) + 1,
        defeatedAiIds: defeated.includes(aiId) ? defeated : [...defeated, aiId],
        aiKills: { ...aiKills, [aiId]: Number(aiKills[aiId] ?? 0) + 1 },
        // The mission-scoped pending flag stays live until every run-bound post
        // effect is durable. It may have been cleared by an old rolling worker;
        // restore it from the stronger payment reservation when necessary.
        pendingCombatMissionClaims: pending.includes(settlement.missionId)
            ? pending
            : [...pending, settlement.missionId],
    };
    const settlementDate = new Date(settlement.settledAt);
    const settlementDay = utcDateKey(settlementDate);
    const settlementMonth = settlementDate.toISOString().slice(0, 7);
    const currentDailyDay = typeof next.lastDailyReset === 'string' ? next.lastDailyReset : '';
    const currentClanMonth = typeof next.clanContribMonth === 'string' ? next.clanContribMonth : '';
    next = {
        ...next,
        totalMissionsCompleted: Number(next.totalMissionsCompleted ?? 0) + 1,
        ...(currentDailyDay > settlementDay
            ? {}
            : {
                dailyMissionsCompleted: currentDailyDay === settlementDay
                    ? Number(next.dailyMissionsCompleted ?? 0) + 1
                    : 1,
                lastDailyReset: settlementDay,
            }),
        ...(currentClanMonth > settlementMonth
            ? {}
            : {
                clanMissionContrib: currentClanMonth === settlementMonth
                    ? Number(next.clanMissionContrib ?? 0) + 1
                    : 1,
                clanContribMonth: settlementMonth,
            }),
    };
    next = recordPetBreedingProgress(next, {
        kind: 'mission-complete',
        receipt: `mission:${settlementDay}:combat:${settlement.missionId}`,
    }).character as SaveChar;
    next = appendCombatMissionClaimSettlement(next, settlement);

    const updated = bumpSaveVersion<Record<string, unknown>>({
        ...params.record,
        character: next,
    });
    const intended = mergePreservingImages(updated, params.record) as Record<string, unknown>;
    const intendedCharacter = intended.character as SaveChar;
    intended.character = {
        ...intendedCharacter,
        combatMissionClaimSettlements: next.combatMissionClaimSettlements,
    };
    const persisted = await confirmCombatMissionClaimSave({
        write: async () => {
            await compareSetExactKvRow(kv, params.saveKey, params.record, intended);
            await syncCurrencyLedger(params.playerName, intended, {
                previousCharacter: params.character,
            });
        },
        read: () => kv.get<Record<string, unknown>>(params.saveKey),
        settlement,
    });
    return {
        applied: true,
        saveVersion: Number(persisted._saveVersion ?? updated._saveVersion ?? 0),
        reward: {
            ...reward,
            currency: reward.currency as Partial<Record<CurrencyKey, number>>,
        },
        combat: settlement.result.combat,
        combatRunId: settlement.runId,
        combatSettlementFingerprint: settlement.rewardFingerprint,
        completion: settlement.result.completion,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'claim-mission', 5, 10_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const missionType = String(body.missionType ?? '');
        const missionId = String(body.missionId ?? '').slice(0, 80);
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (missionType !== 'combat' && missionType !== 'field' && missionType !== 'hunt' && missionType !== 'apex' && missionType !== 'academy-trial' && missionType !== 'academy-checklist') {
            return res.status(400).json({ error: 'Invalid mission type.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own missions.' });
        }

        const saveKey = `save:${playerName}`;
        const todayKey = utcDateKey();
        const monthKey = monthKeyOf();

        // Currency path: persist under the SAME lock the save endpoint uses so a
        // concurrent auto-save can't clobber the credit, and so two rapid claims
        // can't both slip past the one-time / daily-cap / pending checks.
        const outcome = await withKvLock<ClaimOutcome>(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as SaveChar | undefined;
            if (!record || !char) return { applied: false, reason: 'no-save' };
            const combatDef = missionType === 'combat' ? combatMissionByKey(missionId) : null;
            if (missionType === 'combat' && !combatDef) return { applied: false, reason: 'unknown-mission' };
            const combatRewardFingerprint = combatDef ? missionCombatRewardFingerprint(combatDef) : '';
            const combatTokenKey = combatDef ? combatMissionClaimTokenKey(playerName, combatDef.key) : '';
            let combatToken: CombatMissionClaimToken | null = null;
            let combatPaymentReservation: CombatMissionClaimPaymentReservation | null = null;
            let combatTokenRaw: unknown = null;
            if (combatDef) {
                // A failed authority read is not evidence that the token is
                // absent. Let it fail the request closed so the durable pending
                // flag remains untouched and a later retry can recover.
                combatTokenRaw = await kv.get<unknown>(combatTokenKey);
                combatToken = parseCombatMissionClaimToken(combatTokenRaw);
                combatPaymentReservation = parseCombatMissionClaimPaymentReservation(combatTokenRaw);
                const spentCombatToken = parseSpentCombatMissionClaimToken(combatTokenRaw);
                // Only an authoritative null means "there is no token". A
                // malformed non-null row is unknown authority and must never
                // trigger the stale-pending self-heal.
                if (combatTokenRaw !== null && !combatToken && !combatPaymentReservation && !spentCombatToken) {
                    return { applied: false, reason: 'combat-claim-authority-invalid' };
                }
                if (combatToken && !combatMissionClaimTokenMatches({
                    token: combatToken,
                    playerName,
                    missionId: combatDef.key,
                    enemyProfileId: combatDef.aiProfileId,
                    rewardFingerprint: combatRewardFingerprint,
                })) {
                    return { applied: false, reason: 'combat-claim-authority-mismatch' };
                }
                if (combatPaymentReservation && !combatMissionClaimPaymentMatches({
                    reservation: combatPaymentReservation,
                    playerName,
                    missionId: combatDef.key,
                })) {
                    return { applied: false, reason: 'combat-claim-authority-mismatch' };
                }
                if (spentCombatToken && (spentCombatToken.missionId !== combatDef.key
                    || (spentCombatToken.playerName && spentCombatToken.playerName !== playerName))) {
                    return { applied: false, reason: 'combat-claim-authority-mismatch' };
                }
                const receipt = combatToken
                    ? inspectCombatMissionClaimSettlement(
                        char,
                        combatToken.runId,
                        combatDef.key,
                        combatRewardFingerprint,
                    )
                    : combatPaymentReservation
                        ? inspectCombatMissionClaimSettlement(
                            char,
                            combatPaymentReservation.runId,
                            combatDef.key,
                            combatPaymentReservation.rewardFingerprint,
                        )
                        : spentCombatToken
                            ? inspectCombatMissionClaimSettlement(
                                char,
                                spentCombatToken.runId,
                                combatDef.key,
                                spentCombatToken.rewardFingerprint,
                            )
                    : { status: 'missing' as const };
                if (receipt.status === 'conflict') {
                    return { applied: false, reason: 'combat-claim-settlement-conflict' };
                }
                if (spentCombatToken && receipt.status === 'missing') {
                    return { applied: false, reason: 'combat-claim-settlement-missing' };
                }
                const hasPendingCombatClaim = Array.isArray(char.pendingCombatMissionClaims)
                    && char.pendingCombatMissionClaims.map(String).includes(combatDef.key);
                const latestSettlement = !combatToken && !combatPaymentReservation && !spentCombatToken
                    ? latestCombatMissionClaimSettlement(char, combatDef.key)
                    : null;
                const replay = receipt.status === 'replay'
                    ? receipt.receipt
                    : (!combatToken && latestSettlement
                        && (!hasPendingCombatClaim || !latestSettlement.effects?.completedAt)
                        ? latestSettlement
                        : null);
                if (replay) {
                    if (combatToken) {
                        // A receipt written by an earlier new worker (or a lost
                        // acknowledgement during rollout) must stop presenting
                        // old-compatible active authority before post-effects run.
                        const reservation = createCombatMissionClaimPaymentReservation({
                            token: combatToken,
                            playerName,
                            enemyProfileId: replay.result.combat.aiProfileId,
                            rewardFingerprint: replay.rewardFingerprint,
                            settlement: { ...replay, effects: { version: 1 } },
                        });
                        await reserveCombatMissionClaimPayment({
                            store: kv,
                            key: combatTokenKey,
                            expected: combatTokenRaw,
                            reservation,
                        });
                        combatPaymentReservation = reservation;
                        combatToken = null;
                        combatTokenRaw = reservation;
                    }
                    // Payout is durable, but the token/pending UI authority stays
                    // live until every run-bound post effect is acknowledged.
                    // The help-forward pass below owns final cleanup.
                    return {
                        applied: true,
                        replayed: true,
                        combatRunId: replay.runId,
                        combatSettlementFingerprint: replay.rewardFingerprint,
                        saveVersion: Number(record._saveVersion ?? 0),
                        reward: {
                            ...replay.result.reward,
                            currency: replay.result.reward.currency as Partial<Record<CurrencyKey, number>>,
                        },
                        combat: replay.result.combat,
                        completion: replay.result.completion,
                    };
                }
                if (combatTokenRaw === null && hasPendingCombatClaim && !latestSettlement) {
                    // The previous rolling worker deleted an active token before
                    // its payout save. Recover only while the original active
                    // pointer still exists and its complete settled triplet is an
                    // exact match. An authoritative null pointer means there is
                    // no bounded recovery evidence and falls through to stale
                    // healing; every non-null mismatch leaves pending untouched.
                    const activeRaw = await kv.get<unknown>(missionCombatActiveKey(playerName, combatDef.key));
                    if (activeRaw !== null) {
                        if (!activeRaw || typeof activeRaw !== 'object' || Array.isArray(activeRaw)) {
                            return { applied: false, reason: 'combat-claim-recovery-evidence-invalid' };
                        }
                        const activeCandidate = activeRaw as Partial<MissionCombatActivePointer>;
                        if (typeof activeCandidate.runId !== 'string'
                            || activeCandidate.runId.length === 0 || activeCandidate.runId.length > 96
                            || typeof activeCandidate.sessionId !== 'string'
                            || activeCandidate.sessionId.length === 0 || activeCandidate.sessionId.length > 96) {
                            return { applied: false, reason: 'combat-claim-recovery-evidence-invalid' };
                        }
                        // A malformed marker for this exact run may represent a
                        // payout whose receipt was partially/corruptly observed;
                        // absence, not merely "no parseable latest", is required.
                        if (inspectCombatMissionClaimSettlement(
                            char,
                            activeCandidate.runId,
                            combatDef.key,
                            combatRewardFingerprint,
                        ).status !== 'missing') {
                            return { applied: false, reason: 'combat-claim-recovery-evidence-invalid' };
                        }
                        const [bindingRaw, session] = await Promise.all([
                            kv.get<unknown>(missionCombatBindingKey(activeCandidate.runId)),
                            readSoloPveSession(activeCandidate.sessionId),
                        ]);
                        combatToken = recoverLegacyDeletedCombatClaim({
                            activeRaw,
                            bindingRaw,
                            session,
                            playerName,
                            mission: combatDef,
                            rewardFingerprint: combatRewardFingerprint,
                        });
                        if (!combatToken) {
                            return { applied: false, reason: 'combat-claim-recovery-evidence-invalid' };
                        }
                    }
                }
            }
            const missionReceipt = `${todayKey}:${missionType}:${missionId}`;
            const claimedServerMissions = Array.isArray(char.claimedServerMissions)
                ? (char.claimedServerMissions as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-99)
                : [];
            if ((missionType === 'field' || missionType === 'hunt') && claimedServerMissions.includes(missionReceipt)) {
                return { applied: false, reason: 'already-claimed-today' };
            }

            const bonusPct = missionRewardBonusPct(char);

            // ── Resolve mission + per-type eligibility ──────────────────────
            // baseXp is retired (leveling-without-xp map): the progression payout
            // is baseStatPoints — pool points on ONCE-PER-DAY claims (the daily
            // checklist: field/hunt) and one-time capstones (apex, academy).
            // Repeatable combat-mission slots pay ryo only (the farm-bound).
            let baseRyo = 0, baseStamina = 0;
            let baseStatPoints = 0;
            let boostStatPoints = false; // true only for daily-checklist claims
            const territoryScrolls = 0;
            let items: string[] = [];
            let currencyBase: Partial<Record<CurrencyKey, number>> | undefined;
            let combat: { aiProfileId: string; missionKey: string } | undefined;
            let completion: 'daily' | 'total' | 'none' | 'hunt' = 'daily';
            let academyTrialClaimed = false;
            let academyChecklistClaimed = false;
            let progressReceiptKeyToClear: string | null = null;
            // Apex Contract: which ISO week this claim settles, and the kill
            // receipt to burn once the payout lands.
            let apexWeekToStamp = '';
            let apexReceiptKeyToClear: string | null = null;
            // Hunter Rank yield perk (server-authoritative — hunterRank is a sanitizer-
            // protected entitlement): +5% hunt xp/ryo per rank (0→+25% at Warden).
            // Progression speed only, never combat power. Applied to hunts alone.
            let huntRankBonusPct = 0;

            if (missionType === 'combat') {
                if (!combatDef) return { applied: false, reason: 'unknown-mission' };
                if (combatPaymentReservation) {
                    return applyReservedCombatMissionPayout({
                        saveKey,
                        playerName,
                        record,
                        character: char,
                        reservation: combatPaymentReservation,
                    });
                }
                const eligibility = canPlayerClaimMission(char, combatDef);
                if (!eligibility.ok) return eligibilityFailure(eligibility);
                // Server-authoritative claim gate: the token minted from the win
                // remains present until its run-bound payout receipt is durable.
                // A pending flag alone is never payout authority: older builds
                // could leave one behind after the bounded token expired.
                if (!combatToken) {
                    // No valid authority token for a mission that requires one — it
                    // expired (6h TTL) or predates the token gate (e.g. a win queued
                    // before the cPanel→Postgres cutover). Self-heal the permanent
                    // trap: drop the stale durable flag under the save lock so the card
                    // flips back to "Begin Mission" and a re-fight can re-mint the
                    // token. The client mirrors this + shows a re-fight message.
                    const heal = clearStalePendingCombatClaim(char, combatDef.key);
                    if (heal.cleared) {
                        const healed = bumpSaveVersion<Record<string, unknown>>({ ...record, character: heal.char });
                        const intended = mergePreservingImages(healed, record) as Record<string, unknown>;
                        await compareSetExactKvRow(kv, saveKey, record, intended);
                    }
                    return { applied: false, reason: COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON };
                }
                const pending = Array.isArray(char.pendingCombatMissionClaims) ? char.pendingCombatMissionClaims as string[] : [];
                if (!pending.includes(combatDef.key)) return { applied: false, reason: 'not-queued' };
                if (!hasDailyMissionSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                // A cap-blocked claim leaves that authority untouched so it can be
                // used after the daily reset.
                // Repeatable combat-mission slots are the unlimited-repeat channel:
                // ryo only, no stat points (the once-per-day checklist and
                // training are where growth lives).
                baseRyo = combatDef.ryo;
                combat = { aiProfileId: combatDef.aiProfileId, missionKey: combatDef.key };
                completion = 'daily';
            } else if (missionType === 'field') {
                const def = fieldMissionById(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission' };
                const acceptedIds = Array.isArray(record.acceptedMissionIds) ? record.acceptedMissionIds.map(String) : [];
                if (!acceptedIds.includes(missionId)) return { applied: false, reason: 'not-accepted' };
                const fieldRun = serverFieldMissionRun(char, missionId);
                if (!fieldRun) return { applied: false, reason: 'field-run-required' };
                const eligibility = canPlayerClaimMission(char, def);
                if (!eligibility.ok) return eligibilityFailure(eligibility);
                if (!hasDailyMissionSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                const progressKey = missionProgressReceiptKey(playerName, missionId);
                const receipt = cleanMissionProgressReceipt(await kv.get(progressKey).catch(() => null));
                const progress = validateMissionProgressReceipt(
                    receipt,
                    { playerName, missionId, missionType: 'field', mission: def, runId: fieldRun.runId },
                );
                if (!progress.ok) {
                    // Hand back the receipt's real state so the client can resync a
                    // card whose optimistic counters ran ahead of the server.
                    return {
                        applied: false,
                        reason: progress.reason,
                        serverProgress: {
                            exploreCount: receipt?.exploreCount ?? 0,
                            raidCount: receipt?.raidCount ?? 0,
                        },
                    };
                }
                progressReceiptKeyToClear = progressKey;
                baseRyo = def.ryoReward; baseStamina = def.staminaReward;
                baseStatPoints = FIELD_MISSION_STAT_POINTS; boostStatPoints = true;
                currencyBase = def.currencyRewards;
                completion = 'daily';
            } else if (missionType === 'hunt') {
                // Hunter Guild contract — own daily pool, grants material drops.
                // Creator-authored hunts aren't in the catalog and are not paid.
                const def = huntMissionById(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission' };
                const acceptedIds = Array.isArray(record.acceptedMissionIds) ? record.acceptedMissionIds.map(String) : [];
                if (!acceptedIds.includes(missionId)) return { applied: false, reason: 'not-accepted' };
                const eligibility = canPlayerClaimMission(char, def);
                if (!eligibility.ok) return eligibilityFailure(eligibility);
                if (!hasDailyHuntSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                const progressKey = missionProgressReceiptKey(playerName, missionId);
                const trails = char.serverHuntTrails && typeof char.serverHuntTrails === 'object' && !Array.isArray(char.serverHuntTrails)
                    ? char.serverHuntTrails as Record<string, unknown>
                    : {};
                const trail = trails[missionId] && typeof trails[missionId] === 'object' && !Array.isArray(trails[missionId])
                    ? trails[missionId] as Record<string, unknown>
                    : null;
                if (!trail || trail.targetDefeated !== true
                    || typeof trail.targetProofId !== 'string' || !trail.targetProofId) {
                    return { applied: false, reason: 'missing-hunt-kill-receipt' };
                }
                progressReceiptKeyToClear = progressKey;
                baseRyo = def.ryoReward; baseStamina = def.staminaReward;
                baseStatPoints = FIELD_MISSION_STAT_POINTS; boostStatPoints = true;
                currencyBase = def.currencyRewards;
                items = def.itemRewards ?? [];
                completion = 'hunt';
                huntRankBonusPct = Math.max(0, Math.min(5, Math.floor(Number(char.hunterRank ?? 0)))) * 5;
            } else if (missionType === 'apex') {
                // Apex Contract — the Hunter Rank 5 capstone. Its own WEEKLY slot;
                // deliberately does NOT touch the daily hunt pool, so the weekly
                // cap is the only limiter and the payout math stays legible.
                if (!canTakeApex(char)) return { applied: false, reason: 'not-yet-unlocked' };
                // Settle the newest unclaimed kill among {this week, last week}.
                // The grace week exists so a Sunday-night kill isn't voided at
                // 00:01 Monday when the beast rotates — see _apex-contract.ts.
                const now = new Date();
                let settledWeek = '';
                for (const week of apexClaimableWeeks(now)) {
                    if (apexClaimedThisWeek(char, week)) continue;
                    const receipt = await kv.get(apexKillReceiptKey(playerName, week)).catch(() => null);
                    if (receipt) { settledWeek = week; break; }
                }
                if (!settledWeek) return { applied: false, reason: 'missing-hunt-kill-receipt' };
                baseRyo = APEX_REWARD.ryo; baseStamina = APEX_REWARD.stamina;
                baseStatPoints = APEX_STAT_POINTS; // weekly capstone — outside the daily checklist, unboosted
                currencyBase = { fateShards: APEX_REWARD.fateShards };
                completion = 'total';
                apexWeekToStamp = settledWeek;
                apexReceiptKeyToClear = apexKillReceiptKey(playerName, settledWeek);
            } else if (missionType === 'academy-trial') {
                // academy-trial — one-time, off the daily cap.
                if (char.academyTrialClaimed) return { applied: false, reason: 'already-claimed' };
                baseRyo = ACADEMY_TRIAL.ryo; baseStamina = ACADEMY_TRIAL.stamina;
                baseStatPoints = ACADEMY_TRIAL_STAT_POINTS; // one-time onboarding, unboosted
                completion = 'total';
                academyTrialClaimed = true;
            } else {
                // academy-checklist — the one-time graduation capstone. Off the
                // daily cap, doesn't count toward mission totals (completion 'none'),
                // grants a small premium (Fate Shards) bonus from the sealed catalog.
                if (char.academyChecklistClaimed) return { applied: false, reason: 'already-claimed' };
                baseRyo = ACADEMY_CHECKLIST.ryo; baseStamina = ACADEMY_CHECKLIST.stamina;
                baseStatPoints = ACADEMY_CHECKLIST_STAT_POINTS; // one-time graduation capstone, unboosted
                currencyBase = { fateShards: ACADEMY_CHECKLIST.fateShards };
                completion = 'none';
                academyChecklistClaimed = true;
            }

            // Field/hunt idempotency is appended to claimedServerMissions in the
            // same character write as the payout below. This blocks replay
            // without an external pre-reservation that could strand a reward.

            // ── Compute server-authoritative amounts ────────────────────────
            // huntRankBonusPct is 0 for every non-hunt claim, so this only lifts hunts.
            const ryoBoosted = boostAmount(baseRyo, bonusPct + huntRankBonusPct);
            const staminaBoosted = baseStamina > 0 ? boostAmount(baseStamina, bonusPct) : 0;
            // Daily-checklist grants are boosted by the same mission bonuses that
            // used to boost mission XP, plus the era dial (aggregate-capped);
            // one-time capstones pay their fixed value.
            const statPointsGranted = baseStatPoints > 0
                ? Math.max(0, Math.round(baseStatPoints * (boostStatPoints ? combinedStatBoost(bonusPct + huntRankBonusPct) : 1)))
                : 0;

            // ── Apply onto the saved character ──────────────────────────────
            // Character XP is retired: the stat-pool grant moves the earned
            // ledger, then the rise-only derived-level recompute picks it up.
            let next: SaveChar = { ...char };
            if (statPointsGranted > 0) {
                next = { ...next, unspentStats: Math.max(0, Math.floor(Number(next.unspentStats) || 0)) + statPointsGranted };
            }
            next = applyDerivedLevel(next) as SaveChar;
            next = { ...next, ryo: Number(next.ryo ?? 0) + ryoBoosted };
            if (staminaBoosted > 0) {
                const maxStamina = Number(next.maxStamina ?? 0);
                next = { ...next, stamina: Math.min(maxStamina, Number(next.stamina ?? 0) + staminaBoosted) };
            }
            if (items.length > 0) {
                next = { ...next, inventory: grantItemsToInventory(next, items) };
            }
            const currencyFields = applyCurrencyRewardFields(next, currencyBase);
            next = { ...next, ...currencyFields };

            if (combat) {
                const aiId = combat.aiProfileId;
                const defeated = Array.isArray(next.defeatedAiIds) ? next.defeatedAiIds as string[] : [];
                const aiKills = (next.aiKills && typeof next.aiKills === 'object') ? next.aiKills as Record<string, number> : {};
                const pending = Array.isArray(next.pendingCombatMissionClaims) ? next.pendingCombatMissionClaims as string[] : [];
                next = {
                    ...next,
                    totalAiKills: Number(next.totalAiKills ?? 0) + 1,
                    dailyAiKills: Number(next.dailyAiKills ?? 0) + 1,
                    defeatedAiIds: defeated.includes(aiId) ? defeated : [...defeated, aiId],
                    aiKills: { ...aiKills, [aiId]: Number(aiKills[aiId] ?? 0) + 1 },
                    pendingCombatMissionClaims: pending,
                };
            }

            if (completion === 'daily') {
                next = { ...next, ...markMissionCompletedFields(next, todayKey, monthKey) };
            } else if (completion === 'hunt') {
                next = { ...next, ...markHuntCompletedFields(next, todayKey, monthKey) };
            } else if (completion === 'total') {
                next = {
                    ...next,
                    clanMissionContrib: Number(next.clanMissionContrib ?? 0) + 1,
                    totalMissionsCompleted: Number(next.totalMissionsCompleted ?? 0) + 1,
                    clanContribMonth: monthKey,
                };
            }
            if (academyTrialClaimed) next = { ...next, academyTrialClaimed: true };
            if (academyChecklistClaimed) next = { ...next, academyChecklistClaimed: true };
            // Stamp the week this Apex settled. Written INSIDE the same character
            // write as the payout, so the purse and the once-per-week lock land
            // atomically — a crash between them can't pay twice.
            if (apexWeekToStamp) next = { ...next, apexWeekClaimed: apexWeekToStamp };
            if (missionType === 'field' || missionType === 'hunt') {
                next = { ...next, claimedServerMissions: [...claimedServerMissions, missionReceipt] };
            }
            if (missionType === 'hunt' && next.serverHuntTrails && typeof next.serverHuntTrails === 'object' && !Array.isArray(next.serverHuntTrails)) {
                const trails = { ...(next.serverHuntTrails as Record<string, unknown>) };
                delete trails[missionId];
                next = { ...next, serverHuntTrails: trails };
            }
            const rewardCurrency: Record<string, number> = {};
            for (const [currency, amount] of Object.entries(currencyBase ?? {})) {
                const cleanAmount = Number(amount);
                if (Number.isSafeInteger(cleanAmount) && cleanAmount >= 0) rewardCurrency[currency] = cleanAmount;
            }
            const reward = {
                xpBoosted: 0,
                statPoints: statPointsGranted,
                ryo: ryoBoosted,
                stamina: staminaBoosted,
                territoryScrolls,
                currency: rewardCurrency,
                items: [...items],
            };
            next = recordPetBreedingProgress(next, {
                kind: 'mission-complete',
                receipt: `mission:${missionReceipt}`,
            }).character as SaveChar;

            let combatSettlement: CombatMissionClaimSettlement | null = null;
            if (combat && combatToken) {
                const result: CombatMissionClaimResult = { reward, combat, completion: 'daily' };
                combatSettlement = {
                    version: 1,
                    runId: combatToken.runId,
                    missionId: combat.missionKey,
                    rewardFingerprint: combatRewardFingerprint,
                    settledAt: Date.now(),
                    result,
                    effects: { version: 1 },
                };
                next = appendCombatMissionClaimSettlement(next, combatSettlement);
                const reservation = createCombatMissionClaimPaymentReservation({
                    token: combatToken,
                    playerName,
                    enemyProfileId: combat.aiProfileId,
                    rewardFingerprint: combatRewardFingerprint,
                    settlement: combatSettlement,
                });
                // Fence the old claim worker before the first payout write. If
                // this succeeds and the save fails, the reservation itself is
                // the durable help-forward authority for the exact pinned result.
                await reserveCombatMissionClaimPayment({
                    store: kv,
                    key: combatTokenKey,
                    expected: combatTokenRaw,
                    reservation,
                });
                combatPaymentReservation = reservation;
                combatToken = null;
                combatTokenRaw = reservation;
            }

            if (missionType === 'field') next = withoutServerFieldMissionRun(next, missionId) as SaveChar;
            const updated = bumpSaveVersion<Record<string, unknown>>({
                ...applyClaimedMissionState(record, missionType, missionId),
                character: next,
            });
            let persisted: Record<string, unknown> = updated;
            if (combatSettlement) {
                const intended = mergePreservingImages(updated, record) as Record<string, unknown>;
                const intendedCharacter = intended.character as SaveChar;
                intended.character = {
                    ...intendedCharacter,
                    combatMissionClaimSettlements: next.combatMissionClaimSettlements,
                };
                persisted = await confirmCombatMissionClaimSave({
                    write: async () => {
                        await compareSetExactKvRow(kv, saveKey, record, intended);
                        await syncCurrencyLedger(playerName, intended, {
                            previousCharacter: char,
                        });
                    },
                    read: () => kv.get<Record<string, unknown>>(saveKey),
                    settlement: combatSettlement,
                });
            } else {
                await writeSaveProjected(saveKey, updated, record);
            }
            if (progressReceiptKeyToClear) {
                await kv.del(progressReceiptKeyToClear).catch(() => 0);
            }
            // Burn the Apex kill receipt. apexWeekClaimed above is the real lock
            // (it is server-owned and survives), so a failed delete here cannot
            // pay twice — this just stops a spent receipt lingering for its TTL.
            if (apexReceiptKeyToClear) {
                await kv.del(apexReceiptKeyToClear).catch(() => 0);
            }

            return {
                applied: true,
                saveVersion: Number(persisted._saveVersion ?? updated._saveVersion ?? 0),
                reward: {
                    xpBoosted: 0, // retired — kept in the shape for old clients
                    statPoints: statPointsGranted,
                    ryo: ryoBoosted,
                    stamina: staminaBoosted,
                    territoryScrolls,
                    currency: reward.currency,
                    items: reward.items,
                },
                combat,
                ...(combatSettlement ? { combatRunId: combatSettlement.runId } : {}),
                ...(combatSettlement ? { combatSettlementFingerprint: combatSettlement.rewardFingerprint } : {}),
                completion,
                ...(academyTrialClaimed ? { academyTrialClaimed: true } : {}),
                ...(academyChecklistClaimed ? { academyChecklistClaimed: true } : {}),
            };
        }, { failClosed: true });

        // New-shinobi dailies: a successful mission claim is the main activity
        // signal for pre-profession players. reportNewbieEvent no-ops for anyone
        // who has a profession and takes its own locks, so it runs AFTER the
        // claim's save lock has released (no nested locking). Best-effort — a
        // failure here must never fail the (already-applied) claim.
        let finalSaveVersion = outcome.applied ? outcome.saveVersion : 0;
        let finalCharacter: Record<string, unknown> | null = null;
        if (outcome.applied && outcome.combatRunId && outcome.combat) {
            const rewardFingerprint = outcome.combatSettlementFingerprint;
            if (!rewardFingerprint) throw new Error('combat-mission-post-effect-fingerprint-missing');
            const settlement = await completeCombatMissionPostEffects({
                saveKey,
                playerName,
                runId: outcome.combatRunId,
                missionId: outcome.combat.missionKey,
                rewardFingerprint,
            });
            const tokenKey = combatMissionClaimTokenKey(playerName, outcome.combat.missionKey);
            const tokenRaw = await kv.get<unknown>(tokenKey);
            const token = parseCombatMissionClaimPaymentReservation(tokenRaw)
                ?? parseCombatMissionClaimToken(tokenRaw);
            if (token?.runId === settlement.runId) {
                await retireCombatMissionClaimToken({
                    store: kv,
                    key: tokenKey,
                    expected: tokenRaw,
                    token,
                    settlement,
                });
            }
        }
        if (outcome.applied && !outcome.replayed) {
            if (missionType !== 'combat') {
                try {
                    await reportNewbieEvent({ playerName, kind: 'newbie-missions' });
                } catch (e) {
                    console.error('[claim-mission newbie]', e);
                }
            }
            // Legacy tracking (ENABLE_LEGACY): mission/hunt completions are the
            // PvE spine of Legacy eligibility. Best-effort, after the save lock.
            if (missionType !== 'combat') {
                const legacyDeltas: Record<string, number> = {};
                if (outcome.completion === 'hunt') legacyDeltas.huntCompletions = 1;
                else if (outcome.completion === 'daily' || outcome.completion === 'total') legacyDeltas.missionCompletions = 1;
                if (Object.keys(legacyDeltas).length > 0) {
                    await bumpLegacyStats(playerName, legacyDeltas);
                    await bumpEraContribution('missions');
                }
            }
            // Economy telemetry — log the server-computed faucet deltas (ryo +
            // any premium currency) so created-vs-destroyed is measurable.
            const r = outcome.reward;
            if (r.ryo) await recordEconomyTxn({ txnId: `mission:${missionType}:${missionId}:${todayKey}`, player: playerName, currency: 'ryo', delta: r.ryo, source: 'mission.claim' });
            for (const [cur, amt] of Object.entries(r.currency ?? {})) {
                if (amt) await recordEconomyTxn({ txnId: `mission:${missionType}:${missionId}:${cur}:${todayKey}`, player: playerName, currency: cur, delta: Number(amt), source: 'mission.claim' });
            }
            const metricRecord = await kv.get<Record<string, unknown>>(saveKey).catch(() => null);
            const finalChar = (metricRecord?.character ?? null) as Record<string, unknown> | null;
            await recordBetaMetric({
                event: betaEventForMissionType(missionType),
                playerName,
                level: Number(finalChar?.level ?? 0),
                source: missionType,
                xp: r.xpBoosted,
                ryo: r.ryo,
                stamina: r.stamina,
                territoryScrolls: r.territoryScrolls,
                itemCount: r.items.length,
                currencies: r.currency,
            });
        }
        if (outcome.applied) {
            const finalRecord = await kv.get<Record<string, unknown>>(saveKey);
            finalCharacter = (finalRecord?.character ?? null) as Record<string, unknown> | null;
            finalSaveVersion = Number(finalRecord?._saveVersion ?? finalSaveVersion);
        }

        if (outcome.applied) {
            const {
                saveVersion,
                replayed: _replayed,
                combatSettlementFingerprint: _combatSettlementFingerprint,
                ...body
            } = outcome;
            return res.status(200).json({ ok: true, ...body, character: finalCharacter, _saveVersion: finalSaveVersion });
        }
        // Aggregate-only beta signal for hostile/replayed and failed reward
        // attempts. No player identifier or request body is recorded.
        await recordBetaMetric({
            event: ['already-claimed', 'not-queued', 'duplicate'].some((part) => String(outcome.reason ?? '').includes(part))
                ? 'reward.duplicate_rejected'
                : 'reward.claim_failed',
            source: `mission:${missionType}:${String(outcome.reason ?? 'unknown').slice(0, 40)}`,
        });
        const recoveryRecord = await kv.get<Record<string, unknown>>(saveKey).catch(() => null);
        return res.status(200).json({
            ok: true,
            ...outcome,
            character: recoveryRecord?.character ?? null,
            _saveVersion: Number(recoveryRecord?._saveVersion ?? 0),
        });
    } catch (err) {
        console.error('[missions/claim-mission]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
