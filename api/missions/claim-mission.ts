import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { gainXp } from '../_xp-engine.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { MERIT_MISSION, meritNum } from '../village/_village-merit.js';
import { utcDateKey, reportNewbieEvent } from './_progress.js';
import { recordEconomyTxn } from '../_economy.js';
import { recordBetaMetric, type BetaMetricEvent } from '../_beta-metrics.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContribution } from '../_era.js';
import {
    cleanMissionProgressReceipt,
    missionProgressEvidenceBundleKey,
    missionProgressReceiptKey,
    type MissionProgressReceipt,
    validateMissionProgressReceipt,
} from './_mission-progress-receipt.js';
import {
    abortEconomicReceipt,
    commitEconomicReceipt,
    isEconomicReceiptStorageError,
    reserveEconomicReceipt,
    type EconomicReceiptReservation,
} from '../_economic-receipt.js';
import {
    clientTrustedCombatMissionRewardAllowed,
    COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON,
} from '../_release-flags.js';
import { canPlayerClaimMission, missionEligibilityFailureBody, type MissionEligibilityResult } from './_eligibility.js';
import {
    combatMissionByKey,
    fieldMissionById,
    huntMissionById,
    ACADEMY_TRIAL,
    ACADEMY_CHECKLIST,
    missionRewardBonusPct,
    boostAmount,
    hasDailyMissionSlot,
    hasDailyHuntSlot,
    markMissionCompletedFields,
    markHuntCompletedFields,
    applyCurrencyRewardFields,
    grantTerritoryScrollsToInventory,
    grantItemsToInventory,
    FIELD_MISSION_SCROLLS,
    HUNT_MISSION_SCROLLS,
    type CurrencyKey,
} from './_mission-catalog.js';

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
//   • field        — level requirement + daily cap + single-use server evidence
//                    for every explore/raid progress event.
//   • hunt         — Hunter Guild contract: level req + the INDEPENDENT daily
//                    hunt cap; grants material drops (itemRewards) server-side so
//                    they can't be minted client-side (audit M-1). Track/kill
//                    progress likewise requires single-use server evidence.
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
    }
    | {
        applied: true;
        saveVersion: number;
        reward: {
            xpBoosted: number;        // base after town-hall boost; client passes to gainXp
            ryo: number;
            stamina: number;
            territoryScrolls: number;
            currency: Partial<Record<CurrencyKey, number>>;
            items: string[];          // literal item ids (hunt material drops)
        };
        combat?: { aiProfileId: string; missionKey: string };
        completion: 'daily' | 'total' | 'none' | 'hunt';
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
        if (missionType !== 'combat' && missionType !== 'field' && missionType !== 'hunt' && missionType !== 'academy-trial' && missionType !== 'academy-checklist') {
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

            const bonusPct = missionRewardBonusPct(char);

            // ── Resolve mission + per-type eligibility ──────────────────────
            let baseXp = 0, baseRyo = 0, baseStamina = 0;
            let scrolls = 0;
            let items: string[] = [];
            let currencyBase: Partial<Record<CurrencyKey, number>> | undefined;
            let combat: { aiProfileId: string; missionKey: string } | undefined;
            let completion: 'daily' | 'total' | 'none' | 'hunt' = 'daily';
            let academyTrialClaimed = false;
            let academyChecklistClaimed = false;
            let progressReceiptKeyToClear: string | null = null;
            let progressReceiptToConsume: MissionProgressReceipt | null = null;
            const claimReservations: Array<{ key: string; ttl: number; reservation: EconomicReceiptReservation }> = [];

            if (missionType === 'combat') {
                const def = combatMissionByKey(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission' };
                if (!clientTrustedCombatMissionRewardAllowed(def)) {
                    return { applied: false, reason: COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON };
                }
                const eligibility = canPlayerClaimMission(char, def);
                if (!eligibility.ok) return eligibilityFailure(eligibility);
                // Server-authoritative claim gate: the single-use token minted by
                // /api/missions/queue-combat-claim when the fight was won. Preferred
                // over the pendingCombatMissionClaims flag because the client can't
                // forge a KV token via the save endpoint, and it's single-use.
                // Legacy fallback: a client on the prior build (or a token that
                // aged past its TTL) still carries the durable flag on the save —
                // accept that too so no in-flight claim is ever stranded. We're
                // inside the save lock, so this get→del is race-free per player.
                const tokenKey = `missions:combat-claim:${playerName}:${def.key}`;
                const hasToken = !!(await kv.get(tokenKey).catch(() => null));
                const pending = Array.isArray(char.pendingCombatMissionClaims) ? char.pendingCombatMissionClaims as string[] : [];
                const hasLegacyFlag = pending.includes(def.key);
                if (!hasToken && !hasLegacyFlag) return { applied: false, reason: 'not-queued' };
                if (!hasDailyMissionSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                // Consume the token once eligibility passes (before payout), so a
                // retry / racing duplicate can't double-claim. A cap-blocked claim
                // returned above WITHOUT consuming it, so the player can still claim
                // after the daily reset via the durable flag.
                if (hasToken) {
                    const consumed = await kv.del(tokenKey);
                    if (consumed <= 0 && !hasLegacyFlag) return { applied: false, reason: 'not-queued' };
                }
                baseXp = def.xp; baseRyo = def.ryo; scrolls = def.territoryScrolls;
                combat = { aiProfileId: def.aiProfileId, missionKey: def.key };
                completion = 'daily';
            } else if (missionType === 'field') {
                const def = fieldMissionById(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission' };
                const eligibility = canPlayerClaimMission(char, def);
                if (!eligibility.ok) return eligibilityFailure(eligibility);
                if (!hasDailyMissionSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                const progressKey = missionProgressReceiptKey(playerName, missionId);
                const progressReceipt = cleanMissionProgressReceipt(await kv.get(progressKey));
                const progress = validateMissionProgressReceipt(
                    progressReceipt,
                    { playerName, missionId, missionType: 'field', mission: def },
                );
                if (!progress.ok) return { applied: false, reason: progress.reason };
                progressReceiptKeyToClear = progressKey;
                progressReceiptToConsume = progressReceipt;
                baseXp = def.xpReward; baseRyo = def.ryoReward; baseStamina = def.staminaReward;
                scrolls = FIELD_MISSION_SCROLLS; currencyBase = def.currencyRewards;
                completion = 'daily';
            } else if (missionType === 'hunt') {
                // Hunter Guild contract — own daily pool, grants material drops.
                // Creator-authored hunts aren't in the catalog and are not paid.
                const def = huntMissionById(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission' };
                const eligibility = canPlayerClaimMission(char, def);
                if (!eligibility.ok) return eligibilityFailure(eligibility);
                if (!hasDailyHuntSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                const progressKey = missionProgressReceiptKey(playerName, missionId);
                const progressReceipt = cleanMissionProgressReceipt(await kv.get(progressKey));
                const progress = validateMissionProgressReceipt(
                    progressReceipt,
                    { playerName, missionId, missionType: 'hunt', mission: def },
                );
                if (!progress.ok) return { applied: false, reason: progress.reason };
                progressReceiptKeyToClear = progressKey;
                progressReceiptToConsume = progressReceipt;
                baseXp = def.xpReward; baseRyo = def.ryoReward; baseStamina = def.staminaReward;
                scrolls = HUNT_MISSION_SCROLLS; currencyBase = def.currencyRewards;
                items = def.itemRewards ?? [];
                completion = 'hunt';
            } else if (missionType === 'academy-trial') {
                // academy-trial — one-time, off the daily cap.
                if (char.academyTrialClaimed) return { applied: false, reason: 'already-claimed' };
                baseXp = ACADEMY_TRIAL.xp; baseRyo = ACADEMY_TRIAL.ryo; baseStamina = ACADEMY_TRIAL.stamina;
                completion = 'total';
                academyTrialClaimed = true;
            } else {
                // academy-checklist — the one-time graduation capstone. Off the
                // daily cap, doesn't count toward mission totals (completion 'none'),
                // grants a small premium (Fate Shards) bonus from the sealed catalog.
                if (char.academyChecklistClaimed) return { applied: false, reason: 'already-claimed' };
                baseXp = ACADEMY_CHECKLIST.xp; baseRyo = ACADEMY_CHECKLIST.ryo; baseStamina = ACADEMY_CHECKLIST.stamina;
                currencyBase = { fateShards: ACADEMY_CHECKLIST.fateShards };
                completion = 'none';
                academyChecklistClaimed = true;
            }

            // Per-mission idempotency for field/hunt claims. Both reservations
            // fail CLOSED: without a durable latch the client could replay the
            // reward. The daily latch enforces the one-card-per-day rule, while
            // the long-lived evidence-bundle latch prevents a progress receipt
            // whose cleanup failed from paying again on a later UTC day.
            if (missionType === 'field' || missionType === 'hunt') {
                if (!progressReceiptToConsume) return { applied: false, reason: 'missing-progress-receipt' };
                const claimKey = `missions:field-claimed:${playerName}:${missionId}:${todayKey}`;
                const dailyReservation = await reserveEconomicReceipt(kv, {
                    key: claimKey,
                    fingerprint: `mission:${playerName}:${missionType}:${missionId}:${todayKey}`,
                    ttlSeconds: 26 * 60 * 60,
                    metadata: { playerName, missionType, missionId, todayKey },
                });
                if (dailyReservation.status === 'conflict') return { applied: false, reason: 'claim-receipt-conflict' };
                if (dailyReservation.status === 'replay') return { applied: false, reason: 'already-claimed-today' };
                claimReservations.push({ key: claimKey, ttl: 26 * 60 * 60, reservation: dailyReservation });

                const evidenceKey = missionProgressEvidenceBundleKey(playerName, progressReceiptToConsume);
                const evidenceReservation = await reserveEconomicReceipt(kv, {
                    key: evidenceKey,
                    fingerprint: `mission-evidence:${playerName}:${missionType}:${missionId}`,
                    ttlSeconds: 90 * 24 * 60 * 60,
                    metadata: { playerName, missionType, missionId },
                });
                if (evidenceReservation.status !== 'reserved') {
                    await Promise.all(claimReservations.map((entry) =>
                        abortEconomicReceipt(kv, entry.key, entry.reservation).catch(() => false)));
                    return {
                        applied: false,
                        reason: evidenceReservation.status === 'conflict'
                            ? 'claim-receipt-conflict'
                            : 'progress-receipt-already-consumed',
                    };
                }
                claimReservations.push({ key: evidenceKey, ttl: 90 * 24 * 60 * 60, reservation: evidenceReservation });
            }

            // ── Compute server-authoritative amounts ────────────────────────
            const xpBoosted = boostAmount(baseXp, bonusPct);
            const ryoBoosted = boostAmount(baseRyo, bonusPct);
            const staminaBoosted = baseStamina > 0 ? boostAmount(baseStamina, bonusPct) : 0;

            // ── Apply onto the saved character ──────────────────────────────
            let next = gainXp(char, xpBoosted) as SaveChar;
            next = { ...next, ryo: Number(next.ryo ?? 0) + ryoBoosted };
            if (staminaBoosted > 0) {
                const maxStamina = Number(next.maxStamina ?? 0);
                next = { ...next, stamina: Math.min(maxStamina, Number(next.stamina ?? 0) + staminaBoosted) };
            }
            if (scrolls > 0) {
                next = { ...next, inventory: grantTerritoryScrollsToInventory(next, scrolls) };
            }
            if (items.length > 0) {
                next = { ...next, inventory: grantItemsToInventory(next, items) };
            }
            const currencyFields = applyCurrencyRewardFields(next, currencyBase);
            next = { ...next, ...currencyFields };

            if (combat) {
                const aiId = combat.aiProfileId;
                const missionKey = combat.missionKey;
                const defeated = Array.isArray(next.defeatedAiIds) ? next.defeatedAiIds as string[] : [];
                const aiKills = (next.aiKills && typeof next.aiKills === 'object') ? next.aiKills as Record<string, number> : {};
                const pending = Array.isArray(next.pendingCombatMissionClaims) ? next.pendingCombatMissionClaims as string[] : [];
                next = {
                    ...next,
                    totalAiKills: Number(next.totalAiKills ?? 0) + 1,
                    dailyAiKills: Number(next.dailyAiKills ?? 0) + 1,
                    defeatedAiIds: defeated.includes(aiId) ? defeated : [...defeated, aiId],
                    aiKills: { ...aiKills, [aiId]: Number(aiKills[aiId] ?? 0) + 1 },
                    pendingCombatMissionClaims: pending.filter((k) => k !== missionKey),
                };
            }

            if (completion === 'daily') {
                // Personal Village Merit toward a Kage challenge (day-capped completion).
                next = { ...next, ...markMissionCompletedFields(next, todayKey, monthKey), villageMerit: meritNum(next.villageMerit) + MERIT_MISSION };
            } else if (completion === 'hunt') {
                next = { ...next, ...markHuntCompletedFields(next, todayKey, monthKey), villageMerit: meritNum(next.villageMerit) + MERIT_MISSION };
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

            const updated: Record<string, unknown> = { ...applyClaimedMissionState(record, missionType, missionId), character: next };
            bumpSaveVersion(updated);
            try {
                await kv.set(saveKey, mergePreservingImages(updated, record));
            } catch (error) {
                await Promise.all(claimReservations.map((entry) =>
                    abortEconomicReceipt(kv, entry.key, entry.reservation).catch(() => false)));
                throw error;
            }
            // The save is durable now. Commit each reservation; if a commit
            // write fails, its pending owner row remains replay-blocking.
            for (const entry of claimReservations) {
                await commitEconomicReceipt(kv, entry.key, entry.reservation, entry.ttl);
            }
            if (progressReceiptKeyToClear) {
                await kv.del(progressReceiptKeyToClear).catch(() => 0);
            }

            return {
                applied: true,
                saveVersion: Number(updated._saveVersion ?? 0),
                reward: {
                    xpBoosted,
                    ryo: ryoBoosted,
                    stamina: staminaBoosted,
                    territoryScrolls: scrolls,
                    currency: currencyBase ? { ...currencyBase } : {},
                    items: [...items],
                },
                combat,
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
        if (outcome.applied) {
            try {
                await reportNewbieEvent({ playerName, kind: 'newbie-missions' });
                if (missionType === 'combat') {
                    await reportNewbieEvent({ playerName, kind: 'newbie-battle-wins' });
                }
            } catch (e) {
                console.error('[claim-mission newbie]', e);
            }
            // Legacy tracking (ENABLE_LEGACY): mission/hunt completions are the
            // PvE spine of Legacy eligibility. Best-effort, after the save lock.
            {
                const legacyDeltas: Record<string, number> = {};
                if (outcome.completion === 'hunt') legacyDeltas.huntCompletions = 1;
                else if (outcome.completion === 'daily' || outcome.completion === 'total') legacyDeltas.missionCompletions = 1;
                if (missionType === 'combat') legacyDeltas.pveKills = 1;
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
            const finalRecord = await kv.get<Record<string, unknown>>(saveKey).catch(() => null);
            const finalChar = (finalRecord?.character ?? null) as Record<string, unknown> | null;
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
            finalSaveVersion = Number(finalRecord?._saveVersion ?? finalSaveVersion);
        }

        if (outcome.applied) {
            const { saveVersion, ...body } = outcome;
            return res.status(200).json({ ok: true, ...body, _saveVersion: finalSaveVersion });
        }
        return res.status(200).json({ ok: true, ...outcome });
    } catch (err) {
        console.error('[missions/claim-mission]', err);
        if (isEconomicReceiptStorageError(err)) {
            return res.status(503).json({ error: 'Could not reserve the mission reward receipt. Please retry.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
