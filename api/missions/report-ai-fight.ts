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
import { huntMissionByAiProfileId } from './_mission-catalog.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
} from './_mission-progress-receipt.js';
import {
    APEX_RECEIPT_TTL_SECONDS,
    apexKillReceiptKey,
    canTakeApex,
    isApexBeastForWeek,
    isoWeekKey,
} from './_apex-contract.js';

const HUNT_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

// P0.2b — server-authoritative daily SOFT-CAP for AI-fight XP/ryo.
//
// The client reports the base XP/ryo it computed for an AI win with a single-use
// token minted by /api/missions/ai-fight-start. The server validates the claim
// against that sealed token, applies the authoritative daily soft-cap, and returns
// the allowed amounts. The client then grants exactly that, inside its single save
// write.
//
// Why return-only (not credit-on-the-server): the AI-win grant is entangled — the
// client must still write territory/kills/crates/missions to the save — so if this
// endpoint ALSO wrote the save we'd have two writers racing on save:<name>. By
// returning the allowed amount and letting the client apply it, there is exactly
// one writer and no race. AI-fight rewards affect PROGRESSION SPEED, not the PvP
// power ceiling, so capping honest play here (the 90-day-curve concern) is the goal;
// the existing per-save / per-minute save-sanitizer caps remain the floor against a
// tampered client.
//
// The client only calls this (and honors the result) when aiFightServerAuth.v1 is
// on; stale clients never call it. The endpoint credits nothing, so it is safe to
// expose unconditionally — the only state it touches is the caller's own daily
// counter (auth-gated to the player's own name).

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
        // Peek the token's sealed opponentId BEFORE the reward mutation consumes it —
        // the hunt-kill producer below matches it against an accepted hunt's beast AI.
        const sealedOpponentId = await kv.get<AiFightToken>(tokenKey)
            .then((t) => (typeof t?.opponentId === 'string' ? t.opponentId : ''))
            .catch(() => '');
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

            const dailyCount = await kv.incr(`ai-fight-count:${playerName}:${utcDateKey()}`, { ex: AI_FIGHT_DAILY_COUNT_TTL_SECONDS });
            const reward = aiFightReward(claim.xp, claim.ryo, dailyCount);
            const leveled = gainXp(character, reward.xp) as Record<string, unknown>;
            const paid = { ...leveled, ryo: Number(leveled.ryo ?? 0) + reward.ryo };
            const nextCharacter = applyAiFightSecondaryRewards(
                paid,
                tokenData,
                dailyCount <= AI_FIGHT_HARD_CAP_PER_DAY,
                randomInt(100) < 15,
            );
            const redemption = { token: aiFightToken, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount };
            return {
                ok: true as const,
                character: { ...nextCharacter, redeemedAiFightRewards: [...redeemed.slice(-99), redemption] },
                value: { ...redemption, replayed: false },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        await kv.del(tokenKey).catch(() => undefined);
        const reward = result.value;
        const dailyCount = reward.dailyCount;

        // Legacy tracking (ENABLE_LEGACY): PvE kill credit follows the same
        // daily soft cap as the reward — grinding past it stops feeding Legacy
        // eligibility too. Style kills bucket by the save's declared specialty.
        if (!reward.replayed && legacyEnabled() && dailyCount <= AI_FIGHT_SOFT_CAP_PER_DAY) {
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
        if (!reward.replayed && sealedOpponentId) {
            const hunt = huntMissionByAiProfileId(sealedOpponentId);
            const rc = result.character as Record<string, unknown> | undefined;
            const acceptedIds = Array.isArray(rc?.acceptedMissionIds) ? (rc!.acceptedMissionIds as unknown[]).map(String) : [];
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
        if (!reward.replayed && sealedOpponentId.startsWith('apex-ai-')) {
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
        return res.status(200).json({ ok: true, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount, character: result.character, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[missions/report-ai-fight]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
