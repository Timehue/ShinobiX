import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { computeLoginReward, daysUntilShardBonus, STREAK_SHARD_INTERVAL, type LoginReward } from './_daily-login.js';
import { bumpLegacyStats, reconcileLegacyStatsFromSave } from '../_legacy-track.js';
import { deliverPendingEconomyLegacyIntents } from '../_legacy-economy-outbox.js';

/*
 * /api/player/daily-login — POST only
 *
 * Server-authoritative daily login-streak reward. Grants level-scaled ryo once
 * per UTC day, plus 5 fate shards on every 7th consecutive day. The credit
 * commits through mutatePlayerSave (the fail-closed save lock and an exact
 * compare-and-set), so a concurrent /api/save can't clobber it, and the idle
 * recovery the player earned since their last save is settled into the same
 * write rather than discarded by it. Idempotency is the date stamp on the save
 * itself (char.lastLoginRewardDate) read inside the lock — claiming twice in a
 * day is a no-op that just echoes the current streak.
 *
 * The reward params are sealed server-side (api/player/_daily-login.ts) — the
 * client body carries no amounts. Both a first claim and a receipt retry return
 * the authoritative character with its version for one atomic client commit.
 *
 * Body: { playerName }. Caller MUST be the player (or admin). Rate-limited
 * 30/min per actor.
 */

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function utcDateOffset(deltaDays: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'daily-login', 30, 60_000, identity.name))) return;

        const today = utcDateOffset(0);
        const yesterday = utcDateOffset(-1);

        let committed: PlayerSaveMutationResult<LoginReward>;
        try {
            // The day stamp commits in the same write as the reward, so running
            // the whole mutation again after a lost compare-and-set pays at most
            // once: the retry either finds today's stamp or re-reads a save the
            // reward never reached.
            committed = await retryOnSaveVersionConflict(() => mutatePlayerSave<LoginReward>(playerName, ({ character: char }) => {
                const reward = computeLoginReward({
                    lastDate: String(char.lastLoginRewardDate ?? ''),
                    prevStreak: num(char.loginStreak),
                    level: num(char.level),
                    today,
                    yesterday,
                });
                if (reward.alreadyClaimed) return { ok: true, write: false, character: char, value: reward };

                const nextChar = {
                    ...char,
                    ryo: num(char.ryo) + reward.ryo,
                    fateShards: num(char.fateShards) + reward.fateShards,
                    loginStreak: reward.streak,
                    lastLoginRewardDate: today,
                };
                return { ok: true, character: nextChar, value: reward };
            }));
        } catch (e) {
            console.error('[player/daily-login] credit failed', e);
            return res.status(503).json({ error: 'Could not grant your daily reward — please retry.' });
        }

        if (!committed.ok) {
            if (committed.status === 404) return res.status(404).json({ error: 'Your save was not found.' });
            return res.status(committed.status).json({ error: committed.error });
        }
        const out = {
            ...committed.value,
            totalRyo: num(committed.character.ryo),
            totalFateShards: num(committed.character.fateShards),
            saveVersion: committed._saveVersion,
            legacyCharacter: committed.character,
        };

        // Legacy tracking (ENABLE_LEGACY): one tenure day per claimed login day
        // (already once-per-UTC-day by the alreadyClaimed gate above), plus the
        // daily capped reconcile of client-tracked progression counters.
        //
        // The same date receipt is retried even when the reward was already
        // committed. That closes the old crash window where the save payout
        // succeeded, the fire-and-forget sidecar write failed, and every retry
        // skipped Legacy progress forever.
        const legacyCharacter = out.legacyCharacter ?? null;
        const legacyDelivered = await bumpLegacyStats(
            playerName,
            { villageTenureDays: 1 },
            {
                characterForBootstrap: legacyCharacter,
                receiptId: `daily-login:${playerName}:${today}`,
            },
        );
        await reconcileLegacyStatsFromSave(playerName, legacyCharacter);
        // Sweeping unrelated, already-committed economy intents is best-effort;
        // the outbox keeps them retryable without invalidating today's reward.
        await deliverPendingEconomyLegacyIntents(playerName).catch((error) => {
            console.error('[daily-login] Legacy economy sweep failed:', error);
        });
        if (!legacyDelivered) {
            return res.status(503).json({
                error: 'Your daily reward is safe, but its Legacy record is still being sealed. Please retry.',
                code: 'legacy-delivery-pending',
            });
        }

        return res.status(200).json({
            ok: true,
            alreadyClaimed: out.alreadyClaimed,
            streak: out.streak,
            granted: { ryo: out.ryo, fateShards: out.fateShards },
            balances: { ryo: out.totalRyo, fateShards: out.totalFateShards },
            shardInterval: STREAK_SHARD_INTERVAL,
            daysUntilShardBonus: daysUntilShardBonus(out.streak),
            character: out.legacyCharacter,
            _saveVersion: out.saveVersion,
        });
    } catch (err) {
        console.error('[player/daily-login]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
