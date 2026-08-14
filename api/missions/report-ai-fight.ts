import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomInt } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { aiFightReward, AI_FIGHT_DAILY_COUNT_TTL_SECONDS, AI_FIGHT_HARD_CAP_PER_DAY, AI_FIGHT_SOFT_CAP_PER_DAY } from './_ai-fight-reward.js';
import { legacyEnabled, bumpLegacyStats, type LegacyStatDeltas } from '../_legacy-track.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { gainXp } from '../_xp-engine.js';
import { withKvLock } from '../_lock.js';
import {
    AI_FIGHT_TOKEN_TTL_SECONDS,
    aiFightTokenKey,
    cleanAiFightToken,
    validateAiFightRewardClaim,
    type AiFightToken,
} from './_ai-fight-token.js';
import { settleRaidAiToken } from './_generic-ai-fight-authority.js';
import { applyAiFightSecondaryRewards } from './_ai-fight-secondary.js';
import { compareWriteSoloPveSession, readSoloPveSession } from '../solo-pve/_store.js';
import { isSoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
import { settleSoloPveTerminalUsage } from '../solo-pve/_usage-authority.js';
import { deductUsedItems } from '../pvp/claim-rewards.js';
import {
    aiFightPaysReward,
    aiFightPlayerActor,
    aiFightPlayerItemsUsed,
    applyAiFightOutcomeToCharacter,
    resolveAiFightOutcome,
    type AiFightOutcome,
    type AiFightSession,
} from './_ai-fight-outcome.js';
import { huntMissionByAiProfileId, huntMissionById } from './_mission-catalog.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
    savedAcceptedMissionIds,
    savedMissionProgress,
} from './_mission-progress-receipt.js';
import {
    APEX_RECEIPT_TTL_SECONDS,
    apexKillReceiptKey,
    canTakeApex,
    isApexBeastForWeek,
    isoWeekKey,
} from './_apex-contract.js';
import { settleRaidProgression, type RaidProgressionSettlement } from './_raid-progression.js';
import {
    aiFightDailyCounterKey,
    aiFightRedemptionFingerprint,
    aiFightSavedDailyCounts,
    commitAiFightRedemptionAuthority,
    inspectAiFightRedemptionAuthority,
    mirrorAiFightDailyCountMonotonic,
    reserveAiFightDailyOrdinal,
    type AiFightRedemption,
} from './_ai-fight-redemption-authority.js';
import {
    applyWorldAiDurableProgression,
    applyWorldAiFightSettlement,
    cleanWorldAiActivePointer,
    settleWorldAiChainStage,
    WORLD_AI_BOUNTY_COOLDOWN_SECONDS,
    worldAiActiveKey,
    worldAiBountyCooldownKey,
    worldHuntKillEvidenceId,
} from './_world-ai-fight.js';
import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';
import { applyDungeonWardenSettlement } from '../dungeon/_ai-fight.js';

const HUNT_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;
const genericAiFightActiveKey = (playerName: string) => `ai-fight-active:${playerName}`;

// Settles ONE AI fight against its single-use token from /api/missions/ai-fight-start.
// The token seals opponentId, battleKind, the reward ceilings and (when the fight
// was resolved by the server engine) its runId; everything paid here is derived
// from that seal, never from the request body.
//
// TWO AUTHORITY TRACKS, chosen by whether the token carries a runId:
//
//   runId present — the server engine resolved this fight, so its SESSION decides
//     (step 4, api/missions/_ai-fight-outcome.ts): whether the player won, the HP
//     they survived with, and the hospital stay on a defeat or a forfeit. Nothing
//     is taken on trust. This is the track every migrated launch site uses.
//
//   no runId — the local-Arena fallback (a client-authored `temp-*` opponent the
//     profile catalog cannot resolve, or DISABLE_SERVER_AI_COMBAT). There is no
//     session to read, so calling this endpoint IS still the claim of a win, and
//     the client keeps applying the HP/defeat itself. Step 5 retires this track
//     along with the local engine.
//
// The reward amounts were never client-supplied on either track: the token carries
// baseXp/baseRyo (rewardSource 'server-save'), so validateAiFightRewardClaim
// ignores whatever the body says. AI-fight rewards affect PROGRESSION SPEED, not
// the PvP power ceiling, which is why the daily soft cap (the 90-day-curve
// concern) is the lever here — see feedback_balanced_pvp_design_pillar.
//
// The payout, the secondary rewards and the physical outcome all land in ONE
// mutatePlayerSave, so a win cannot bank its reward while losing the damage it
// cost. The field-raid/hunt/apex progress receipts are written after it,
// idempotent settlement pass. Durable mission proofs must finish before the
// retained token/active pointer is released, so a retry heals partial effects.

function worldHuntTargetWasCommitted(
    character: Record<string, unknown>,
    context: WorldAiFightContext | null,
    proofId: string,
): boolean {
    if (context?.kind !== 'hunt-target' || !context.missionId || !context.huntRunId) return false;
    const trails = character.serverHuntTrails;
    if (!trails || typeof trails !== 'object' || Array.isArray(trails)) return false;
    const trail = (trails as Record<string, unknown>)[context.missionId];
    if (!trail || typeof trail !== 'object' || Array.isArray(trail)) return false;
    const value = trail as Record<string, unknown>;
    return value.runId === context.huntRunId
        && value.targetDefeated === true
        && value.targetProofId === worldHuntKillEvidenceId(proofId);
}

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own fights.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'report-ai-fight', 30, 60_000, identity.name))) return;

        const aiFightToken = cleanAiFightToken(body.aiFightToken ?? body.token);
        if (!aiFightToken) {
            return res.status(200).json({ ok: true, xp: 0, ryo: 0, capped: false, dailyCount: null, reason: 'missing-ai-fight-token' });
        }
        const tokenKey = aiFightTokenKey(playerName, aiFightToken);
        // Peek the token BEFORE the reward mutation consumes it: the hunt-kill
        // producer below matches its sealed opponentId against an accepted hunt,
        // and its sealed runId selects which authority track this report takes.
        const peeked = await kv.get<AiFightToken>(tokenKey).catch(() => null);
        const sealedOpponentId = typeof peeked?.opponentId === 'string' ? peeked.opponentId : '';
        const sealedSessionId = peeked?.sessionRuntime === 'solo-pve' && typeof peeked.sessionId === 'string'
            ? peeked.sessionId
            : '';
        const sealedBattleKind = peeked?.battleKind ?? 'practice';
        const sealedRaidTokenId = typeof peeked?.raidTokenId === 'string' ? peeked.raidTokenId : '';
        const sealedSector = Math.floor(Number(peeked?.sector));
        const sealedWorldContext: WorldAiFightContext | null = peeked?.worldContext ?? null;
        if (!sealedSessionId) {
            return res.status(409).json({ error: 'AI fight token has no standalone combat authority.', outcome: 'unknown' });
        }

        // ── Step 4: the SESSION decides, not the caller ──────────────────────
        // When the token carries a runId, this fight was resolved by the server
        // engine and its session is the authority on both questions that used to
        // be taken on trust: did the player win, and what HP did they walk away
        // with. A token WITHOUT a runId is the local-Arena fallback (every
        // client-authored `temp-*` opponent, or the kill switch), which has no
        // session to read — that track keeps the old behaviour until step 5
        // retires it.
        const sealedSession: AiFightSession | null = await readSoloPveSession(sealedSessionId).catch(() => null);
        const outcome: AiFightOutcome = resolveAiFightOutcome(sealedSession);
        const playerActor = aiFightPlayerActor(sealedSession);
        const playerItemsUsed = aiFightPlayerItemsUsed(sealedSession);
        // A vanished session neither pays nor punishes — see _ai-fight-outcome.
        // 409 so the client's settle retry can pick it up if it was a slow read.
        if (outcome === 'unknown') {
            return res.status(409).json({ error: 'The sealed fight could not be verified.', outcome });
        }
        if (!isSoloPveSession(sealedSession)) {
            return res.status(409).json({ error: 'The sealed fight has no solo-PvE usage authority.', outcome });
        }
        const usage = await settleSoloPveTerminalUsage(sealedSession, playerName);
        if (!usage.ok) return res.status(usage.status).json({ error: usage.error, outcome });
        const settledUsageSession = usage.session;
        const paysReward = aiFightPaysReward(outcome, sealedBattleKind);
        const requestedDailyDate = utcDateKey();
        let dailyCounterKey = aiFightDailyCounterKey(playerName, requestedDailyDate);
        const result = await mutatePlayerSave(playerName, async ({ character, record }) => {
            const redeemed = Array.isArray(character.redeemedAiFightRewards)
                ? (character.redeemedAiFightRewards as unknown[]).filter((entry): entry is { token: string; xp: number; ryo: number; capped: boolean; dailyCount: number } =>
                    !!entry && typeof entry === 'object' && typeof (entry as { token?: unknown }).token === 'string')
                : [];
            const tokenData = await kv.get<AiFightToken>(tokenKey);
            if (!tokenData) return { ok: false as const, status: 409, error: 'AI fight token is invalid or already spent.' };
            if ((tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return { ok: false as const, status: 403, error: 'AI fight token does not belong to this player.' };
            }
            const claim = validateAiFightRewardClaim(tokenData, body.xp, body.ryo);
            if (!claim.ok) return { ok: false as const, status: 409, error: claim.reason };
            const now = Date.now();
            const fingerprint = aiFightRedemptionFingerprint({
                playerName,
                token: aiFightToken,
                tokenData,
                sessionId: settledUsageSession.sessionId,
                outcome,
                battleKind: sealedBattleKind,
                claim,
            });
            const prior = redeemed.find((entry) => entry.token === aiFightToken);
            // Do not allocate a daily ordinal for an unsafe pre-cutover token
            // that has no exact legacy save proof. Existing legacy receipts are
            // migrated below and new v1 tokens reserve against the old scalar.
            if (tokenData.redemptionAuthorityVersion !== 1 && !prior) {
                return { ok: false as const, status: 409, error: 'This pre-upgrade AI-fight token cannot be redeemed safely.' };
            }
            const dailyReservation = paysReward
                ? await reserveAiFightDailyOrdinal(kv, {
                    playerName,
                    token: aiFightToken,
                    mintedAt: tokenData.mintedAt,
                    requestedDate: requestedDailyDate,
                    minimumDailyCounts: aiFightSavedDailyCounts(character),
                    ttlSeconds: AI_FIGHT_DAILY_COUNT_TTL_SECONDS,
                })
                : null;
            const dailyDate = dailyReservation?.date ?? requestedDailyDate;
            dailyCounterKey = dailyReservation?.counterKey ?? aiFightDailyCounterKey(playerName, dailyDate);
            const authority = inspectAiFightRedemptionAuthority({
                character,
                token: aiFightToken,
                fingerprint,
                mintedAt: tokenData.mintedAt,
                now,
                date: dailyDate,
                paysReward,
                reservedDailyCount: dailyReservation?.dailyCount,
            });
            if (!authority.ok) return authority;
            if (authority.replayed) {
                return { ok: true as const, character, value: { ...authority.redemption, replayed: true }, write: false as const };
            }
            if (prior) {
                const migrated: AiFightRedemption = {
                    token: aiFightToken,
                    xp: Math.max(0, Math.floor(Number(prior.xp) || 0)),
                    ryo: Math.max(0, Math.floor(Number(prior.ryo) || 0)),
                    capped: prior.capped === true,
                    dailyCount: Math.max(0, Math.floor(Number(prior.dailyCount) || 0)),
                };
                const migratedWorld = sealedWorldContext
                    ? applyWorldAiFightSettlement(character, sealedWorldContext, outcome, aiFightToken)
                    : character;
                const migratedProgression = sealedWorldContext
                    ? applyWorldAiDurableProgression(record, migratedWorld, sealedWorldContext, outcome)
                    : { character: migratedWorld };
                return {
                    ok: true as const,
                    character: commitAiFightRedemptionAuthority(migratedProgression.character, authority, migrated, { counterAlreadyCommitted: true }),
                    ...(migratedProgression.recordPatch ? { recordPatch: migratedProgression.recordPatch } : {}),
                    value: { ...migrated, replayed: true },
                };
            }
            // The per-token redemption below is the exactly-once receipt. Item
            // deduction rides in this SAME save mutation as HP and payout, so a
            // retry cannot keep a spent consumable or deduct it twice.
            const companionCharacter = isSoloPveSession(settledUsageSession)
                ? applySoloPveUsageCosts(character, settledUsageSession)
                : Object.keys(playerItemsUsed).length > 0
                    ? deductUsedItems(character, playerItemsUsed)
                    : character;

            // A loss, draw or forfeit consumes the token and writes the physical
            // consequence, but pays nothing and never touches the daily counter —
            // the counter is a REWARD counter, and a defeat earned no reward.
            if (!paysReward) {
                const settled = applyAiFightOutcomeToCharacter(companionCharacter, outcome, playerActor, Date.now());
                const dungeonSettled = sealedBattleKind === 'dungeon'
                    ? applyDungeonWardenSettlement({
                        character: settled,
                        dungeonRunToken: tokenData.dungeonRunToken,
                        opponentId: tokenData.opponentId,
                        proofId: aiFightToken,
                        outcome,
                    })
                    : { ok: true as const, character: settled };
                if (!dungeonSettled.ok) {
                    return { ok: false as const, status: 409, error: dungeonSettled.error };
                }
                const worldSettled = sealedWorldContext
                    ? applyWorldAiFightSettlement(dungeonSettled.character, sealedWorldContext, outcome, aiFightToken)
                    : dungeonSettled.character;
                const worldProgression = sealedWorldContext
                    ? applyWorldAiDurableProgression(record, worldSettled, sealedWorldContext, outcome)
                    : { character: worldSettled };
                const redemption: AiFightRedemption = { token: aiFightToken, xp: 0, ryo: 0, capped: false, dailyCount: 0 };
                const withLegacyReceipt = { ...worldProgression.character, redeemedAiFightRewards: [...redeemed.slice(-99), redemption] };
                return {
                    ok: true as const,
                    character: commitAiFightRedemptionAuthority(withLegacyReceipt, authority, redemption),
                    ...(worldProgression.recordPatch ? { recordPatch: worldProgression.recordPatch } : {}),
                    value: { ...redemption, replayed: false },
                };
            }

            const dailyCount = authority.dailyCount;
            const reward = aiFightReward(claim.xp, claim.ryo, dailyCount);
            const leveled = gainXp(companionCharacter, reward.xp) as Record<string, unknown>;
            const paid = { ...leveled, ryo: Number(leveled.ryo ?? 0) + reward.ryo };
            const rewarded = applyAiFightSecondaryRewards(
                paid,
                tokenData,
                dailyCount <= AI_FIGHT_HARD_CAP_PER_DAY,
                randomInt(100) < 15,
            );
            // The surviving HP rides in the SAME mutation as the payout, so a win
            // can never bank the reward while losing the damage it cost (or the
            // other way round). No-op on the local-fallback track, which has no
            // session to read an HP from.
            const physicallySettled = applyAiFightOutcomeToCharacter(rewarded, outcome, playerActor, Date.now());
            const nextCharacter = sealedWorldContext
                ? applyWorldAiFightSettlement(physicallySettled, sealedWorldContext, outcome, aiFightToken)
                : physicallySettled;
            const worldProgression = sealedWorldContext
                ? applyWorldAiDurableProgression(record, nextCharacter, sealedWorldContext, outcome)
                : { character: nextCharacter };
            const redemption: AiFightRedemption = { token: aiFightToken, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount };
            const withLegacyReceipt = { ...worldProgression.character, redeemedAiFightRewards: [...redeemed.slice(-99), redemption] };
            const worldHunt = sealedWorldContext?.kind === 'hunt-target'
                && sealedWorldContext.missionId
                && worldHuntTargetWasCommitted(withLegacyReceipt, sealedWorldContext, aiFightToken)
                ? huntMissionById(sealedWorldContext.missionId)
                : undefined;
            const missionProgress = savedMissionProgress(record);
            return {
                ok: true as const,
                character: commitAiFightRedemptionAuthority(withLegacyReceipt, authority, redemption),
                ...(worldHunt || worldProgression.recordPatch ? {
                    recordPatch: {
                        ...(worldProgression.recordPatch ?? {}),
                        ...(worldHunt ? { missionProgress: { ...missionProgress, [worldHunt.id]: Math.max(1, Math.floor(Number(worldHunt.exploreCount) || 1)) } } : {}),
                    },
                } : {}),
                value: { ...redemption, replayed: false },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        const reward = result.value;
        const dailyCount = reward.dailyCount;
        if (paysReward && dailyCount > 0) {
            await mirrorAiFightDailyCountMonotonic(
                kv,
                dailyCounterKey,
                dailyCount,
                AI_FIGHT_DAILY_COUNT_TTL_SECONDS,
            );
        }
        if (isSoloPveSession(settledUsageSession) && settledUsageSession.terminalEvidence) {
            try {
                const priorReceipt = settledUsageSession.terminalEvidence.receipt;
                if (settledUsageSession.settlementState === 'settled') {
                    if (priorReceipt?.kind !== 'ai-fight' || priorReceipt.id !== aiFightToken) {
                        throw new Error('ai-fight-session-settlement-conflict');
                    }
                } else {
                    const settled = withSoloPveSettlementReceipt(settledUsageSession, {
                        kind: 'ai-fight',
                        id: aiFightToken,
                        settledAt: Date.now(),
                        rewards: { outcome, xp: reward.xp, ryo: reward.ryo, replayed: reward.replayed },
                    });
                    if (!(await compareWriteSoloPveSession(settledUsageSession, settled))) {
                        const readback = await readSoloPveSession(settledUsageSession.sessionId);
                        if (!readback
                            || readback.settlementState !== 'settled'
                            || readback.terminalEvidence?.receipt?.kind !== 'ai-fight'
                            || readback.terminalEvidence.receipt.id !== aiFightToken) {
                            throw new Error('ai-fight-session-settlement-conflict');
                        }
                    }
                }
            } catch (sessionError) {
                // The save receipt above is the payout authority. Once it is
                // committed, a secondary session-projection conflict must not
                // turn a truthful paid response into a 500; a replay remains
                // exact from the non-evicting save manifest.
                console.error('[report-ai-fight] terminal session projection remains pending:', safeLogValue(sessionError));
            }
        }
        // Keep the spent token until its short TTL so a lost settle response can
        // replay the exact in-save receipt. The reward/usage mutation above is
        // already exactly-once; deleting this lookup made that durable replay
        // unreachable.

        // Legacy tracking (ENABLE_LEGACY): PvE kill credit follows the same
        // daily soft cap as the reward — grinding past it stops feeding Legacy
        // eligibility too. Style kills bucket by the save's declared specialty.
        if (paysReward && !reward.replayed && legacyEnabled() && dailyCount <= AI_FIGHT_SOFT_CAP_PER_DAY) {
            try {
                const char = result.character;
                const deltas: LegacyStatDeltas = { pveKills: 1 };
                const specialty = String(char?.specialty ?? '');
                if (specialty === 'Ninjutsu') deltas.ninjutsuKills = 1;
                else if (specialty === 'Genjutsu') deltas.genjutsuKills = 1;
                else if (specialty === 'Taijutsu') deltas.taijutsuKills = 1;
                else if (specialty === 'Bukijutsu') deltas.bukijutsuKills = 1;
                await bumpLegacyStats(playerName, deltas, { characterForBootstrap: char ?? null });
            } catch (legacyErr) {
                // Tracking must never 500 a reward response whose daily counter
                // already advanced (verification finding).
                console.error('[report-ai-fight] legacy tracking failed:', legacyErr);
            }
        }
        // ── Field-raid producer ───────────────────────────────────────────────
        // AI village raids now settle through THIS endpoint and its sealed
        // solo-PvE session. The older client path followed settlement with
        // report-raid, but it had neither a PvP battleId nor a raid-start token,
        // so claim-mission's receipt remained at 0 raids while the local board
        // showed the win. Stamp the proven raid from the same AI-fight token
        // whose sealed session supplied the WIN. The helper hashes the proof and
        // deduplicates it, so retries cannot count one fight twice.
        let durableSideEffectError: unknown = null;
        let fetchMissionsCredited: string[] = [];
        let raidProgression: RaidProgressionSettlement | null = null;
        let raidProgressionReplayed = false;
        let finalCharacter = result.character as Record<string, unknown>;
        let finalSaveVersion = result._saveVersion;
        try {
            if (paysReward && sealedBattleKind === 'raidAi' && sealedRaidTokenId && !sealedWorldContext) {
                const progression = await settleRaidProgression({
                    playerName,
                    proofId: `ai-fight:${aiFightToken}`,
                    proofAt: Number(peeked?.mintedAt ?? 0),
                    sector: sealedSector,
                });
                raidProgression = progression.settlement;
                raidProgressionReplayed = progression.replayed;
                fetchMissionsCredited = progression.settlement.fetchMissionsCredited;
                finalCharacter = progression.character;
                finalSaveVersion = progression._saveVersion;
            }
        } catch (error) {
            durableSideEffectError = error;
        }
        // ── Hunt-kill producer ───────────────────────────────────────────────
        // A validated win against a hunt's beast (opponentId sealed at fight start)
        // stamps that accepted hunt's kill onto its progress receipt so claim-mission
        // can pay the Hunter contract. Gated on the hunt being ACCEPTED and its
        // tracking already done (applyMissionProgressEvent only flips huntKill once
        // exploreCount has reached target-1). Best-effort + idempotent (the sealed
        // token id dedups), and never fails the already-applied reward.
        if (paysReward && sealedOpponentId) {
            const hunt = sealedWorldContext?.kind === 'hunt-target'
                && sealedWorldContext.missionId
                && worldHuntTargetWasCommitted(result.character as Record<string, unknown>, sealedWorldContext, aiFightToken)
                ? huntMissionById(sealedWorldContext.missionId)
                : !sealedWorldContext ? huntMissionByAiProfileId(sealedOpponentId) : undefined;
            // acceptedMissionIds is a top-level save-record field, not a character
            // one — reading it off result.character always found nothing, so the
            // kill receipt was never stamped and no hunt could be claimed.
            const acceptedIds = savedAcceptedMissionIds(result.record as Record<string, unknown> | undefined);
            if (hunt && acceptedIds.includes(hunt.id)) {
                try {
                    const receiptKey = missionProgressReceiptKey(playerName, hunt.id);
                    await withKvLock(receiptKey, async () => {
                        const existing = cleanMissionProgressReceipt(await kv.get(receiptKey));
                        const next = applyMissionProgressEvent(existing, {
                            playerName, missionId: hunt.id, missionType: 'hunt', kind: 'hunt-kill',
                            exploreTarget: Math.floor(Number(hunt.exploreCount ?? 0)), raidTarget: 0,
                            evidenceId: worldHuntKillEvidenceId(aiFightToken),
                        });
                        await kv.set(receiptKey, next, { ex: HUNT_RECEIPT_TTL_SECONDS });
                    }, { failClosed: true });
                } catch (e) {
                    durableSideEffectError = durableSideEffectError ?? e;
                }
            }
        }
        // ── Apex-kill producer ───────────────────────────────────────────────
        // Same shape as the hunt-kill producer above, but keyed on the ISO week
        // rather than an accepted contract: an Apex is always "accepted" for a
        // max-rank hunter. Only THIS week's rostered beast counts, so a stale
        // client cannot re-report an older Apex to farm the purse. The claim
        // still gates on rank/level and stamps apexWeekClaimed, so this receipt
        // alone can never pay twice. Best-effort — never fails a paid reward.
        if (paysReward && !sealedWorldContext && sealedOpponentId.startsWith('apex-ai-')) {
            try {
                const rc = result.character as Record<string, unknown> | undefined;
                const weekKey = isoWeekKey(new Date());
                if (canTakeApex(rc) && isApexBeastForWeek(sealedOpponentId, weekKey)) {
                    await kv.set(apexKillReceiptKey(playerName, weekKey), { playerName, weekKey, apexAiId: sealedOpponentId, at: Date.now() }, { ex: APEX_RECEIPT_TTL_SECONDS });
                }
            } catch (e) {
                durableSideEffectError = durableSideEffectError ?? e;
            }
        }
        if (sealedWorldContext) {
            try {
                await settleWorldAiChainStage(playerName, sealedWorldContext, outcome, aiFightToken);
                if (sealedWorldContext.kind === 'bounty-hunter') {
                    await kv.set(worldAiBountyCooldownKey(playerName, sealedWorldContext.sourceId), {
                        until: Date.now() + WORLD_AI_BOUNTY_COOLDOWN_SECONDS * 1_000,
                        proofId: aiFightToken,
                    }, { ex: WORLD_AI_BOUNTY_COOLDOWN_SECONDS });
                }
            } catch (error) {
                durableSideEffectError = durableSideEffectError ?? error;
            }
        }
        if (!sealedWorldContext && sealedBattleKind === 'raidAi' && sealedRaidTokenId) {
            try {
                await settleRaidAiToken({
                    store: kv,
                    playerName,
                    raidTokenId: sealedRaidTokenId,
                    aiFightToken,
                    sessionId: sealedSessionId,
                    outcome,
                    ttlSeconds: AI_FIGHT_TOKEN_TTL_SECONDS,
                });
            } catch (error) {
                durableSideEffectError = durableSideEffectError ?? error;
            }
        }
        if (durableSideEffectError) {
            // Token + active pointer remain available, so the identical report
            // replay can heal every idempotent progress receipt after a crash.
            return res.status(503).json({
                error: 'AI encounter settlement is still finalizing. Retry with the same token.',
                outcome,
                retryable: true,
                ...(sealedWorldContext ? { worldContext: sealedWorldContext } : {}),
            });
        }

        const activeKey = sealedWorldContext ? worldAiActiveKey(playerName) : genericAiFightActiveKey(playerName);
        await withKvLock(activeKey, async () => {
            if (sealedWorldContext) {
                const active = cleanWorldAiActivePointer(await kv.get(activeKey));
                if (active?.token === aiFightToken) await kv.del(activeKey);
                return;
            }
            const active = await kv.get<{ token?: unknown }>(activeKey);
            if (active?.token === aiFightToken) await kv.del(activeKey);
        }, { failClosed: true });
        // `outcome` lets the client's result card state what actually happened
        // instead of assuming a win — a forfeit and a loss read differently.
        return res.status(200).json({
            ok: true,
            outcome,
            xp: reward.xp,
            ryo: reward.ryo,
            capped: reward.capped,
            dailyCount,
            fetchMissionsCredited,
            ...(raidProgression ? { raidProgression: {
                fetchMissionsCredited: raidProgression.fetchMissionsCredited,
                missionsCompleted: raidProgression.missionsCompleted,
                xpAwarded: raidProgression.xpAwarded,
                bonusRyo: raidProgression.bonusRyo,
                bonusSeals: raidProgression.bonusSeals,
                territoryDamage: raidProgression.territoryDamage,
                sector: raidProgression.sector,
                replayed: raidProgressionReplayed,
            } } : {}),
            character: finalCharacter,
            _saveVersion: finalSaveVersion,
            ...(sealedBattleKind === 'dungeon' ? {
                dungeonRunToken: peeked?.dungeonRunToken ?? null,
                dungeonRun: finalCharacter.activeDungeonRun ?? null,
            } : {}),
            ...(sealedWorldContext ? { worldContext: sealedWorldContext } : {}),
        });
    } catch (err) {
        console.error('[missions/report-ai-fight]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
