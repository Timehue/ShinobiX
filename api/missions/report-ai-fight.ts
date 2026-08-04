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
    aiFightTokenKey,
    cleanAiFightToken,
    validateAiFightRewardClaim,
    type AiFightToken,
} from './_ai-fight-token.js';
import { applyAiFightSecondaryRewards } from './_ai-fight-secondary.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { isSoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
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
import { huntMissionByAiProfileId } from './_mission-catalog.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
    savedAcceptedMissionIds,
} from './_mission-progress-receipt.js';
import {
    APEX_RECEIPT_TTL_SECONDS,
    apexKillReceiptKey,
    canTakeApex,
    isApexBeastForWeek,
    isoWeekKey,
} from './_apex-contract.js';

const HUNT_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

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
// cost. The hunt/apex kill receipts are written after it, best-effort, and never
// fail an already-applied reward.

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
        const paysReward = aiFightPaysReward(outcome, sealedBattleKind);
        const result = await mutatePlayerSave(playerName, async ({ character }) => {
            const redeemed = Array.isArray(character.redeemedAiFightRewards)
                ? (character.redeemedAiFightRewards as unknown[]).filter((entry): entry is { token: string; xp: number; ryo: number; capped: boolean; dailyCount: number } =>
                    !!entry && typeof entry === 'object' && typeof (entry as { token?: unknown }).token === 'string')
                : [];
            const prior = redeemed.find((entry) => entry.token === aiFightToken);
            if (prior) return { ok: true as const, character, value: { ...prior, replayed: true } };

            const tokenData = await kv.get<AiFightToken>(tokenKey);
            if (!tokenData) return { ok: false as const, status: 409, error: 'AI fight token is invalid or already spent.' };
            if ((tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return { ok: false as const, status: 403, error: 'AI fight token does not belong to this player.' };
            }
            const claim = validateAiFightRewardClaim(tokenData, body.xp, body.ryo);
            if (!claim.ok) return { ok: false as const, status: 409, error: claim.reason };
            // The per-token redemption below is the exactly-once receipt. Item
            // deduction rides in this SAME save mutation as HP and payout, so a
            // retry cannot keep a spent consumable or deduct it twice.
            const companionCharacter = isSoloPveSession(sealedSession)
                ? applySoloPveUsageCosts(character, sealedSession)
                : Object.keys(playerItemsUsed).length > 0
                    ? deductUsedItems(character, playerItemsUsed)
                    : character;

            // A loss, draw or forfeit consumes the token and writes the physical
            // consequence, but pays nothing and never touches the daily counter —
            // the counter is a REWARD counter, and a defeat earned no reward.
            if (!paysReward) {
                const settled = applyAiFightOutcomeToCharacter(companionCharacter, outcome, playerActor, Date.now());
                const redemption = { token: aiFightToken, xp: 0, ryo: 0, capped: false, dailyCount: 0 };
                return {
                    ok: true as const,
                    character: { ...settled, redeemedAiFightRewards: [...redeemed.slice(-99), redemption] },
                    value: { ...redemption, replayed: false },
                };
            }

            const dailyCount = await kv.incr(`ai-fight-count:${playerName}:${utcDateKey()}`, { ex: AI_FIGHT_DAILY_COUNT_TTL_SECONDS });
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
            const nextCharacter = applyAiFightOutcomeToCharacter(rewarded, outcome, playerActor, Date.now());
            const redemption = { token: aiFightToken, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount };
            return {
                ok: true as const,
                character: { ...nextCharacter, redeemedAiFightRewards: [...redeemed.slice(-99), redemption] },
                value: { ...redemption, replayed: false },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        const reward = result.value;
        const dailyCount = reward.dailyCount;
        if (isSoloPveSession(sealedSession) && sealedSession.terminalEvidence) {
            const settledAt = Date.now();
            await writeSoloPveSession(withSoloPveSettlementReceipt(sealedSession, {
                kind: 'ai-fight',
                id: aiFightToken,
                settledAt,
                rewards: { outcome, xp: reward.xp, ryo: reward.ryo, replayed: reward.replayed },
            }));
        }
        await kv.del(tokenKey).catch(() => undefined);

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
        // ── Hunt-kill producer ───────────────────────────────────────────────
        // A validated win against a hunt's beast (opponentId sealed at fight start)
        // stamps that accepted hunt's kill onto its progress receipt so claim-mission
        // can pay the Hunter contract. Gated on the hunt being ACCEPTED and its
        // tracking already done (applyMissionProgressEvent only flips huntKill once
        // exploreCount has reached target-1). Best-effort + idempotent (the sealed
        // token id dedups), and never fails the already-applied reward.
        if (paysReward && !reward.replayed && sealedOpponentId) {
            const hunt = huntMissionByAiProfileId(sealedOpponentId);
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
                            evidenceId: `huntkill_${aiFightToken}`.slice(0, 96),
                        });
                        await kv.set(receiptKey, next, { ex: HUNT_RECEIPT_TTL_SECONDS });
                    }, { failClosed: true });
                } catch (e) {
                    console.error('[report-ai-fight hunt-kill]', e);
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
        if (paysReward && !reward.replayed && sealedOpponentId.startsWith('apex-ai-')) {
            try {
                const rc = result.character as Record<string, unknown> | undefined;
                const weekKey = isoWeekKey(new Date());
                if (canTakeApex(rc) && isApexBeastForWeek(sealedOpponentId, weekKey)) {
                    await kv.set(apexKillReceiptKey(playerName, weekKey), { playerName, weekKey, apexAiId: sealedOpponentId, at: Date.now() }, { ex: APEX_RECEIPT_TTL_SECONDS });
                }
            } catch (e) {
                console.error('[report-ai-fight apex-kill]', e);
            }
        }
        // `outcome` lets the client's result card state what actually happened
        // instead of assuming a win — a forfeit and a loss read differently.
        return res.status(200).json({ ok: true, outcome, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount, character: result.character, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[missions/report-ai-fight]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
