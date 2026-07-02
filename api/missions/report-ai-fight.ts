import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { aiFightReward, AI_FIGHT_DAILY_COUNT_TTL_SECONDS } from './_ai-fight-reward.js';
import { computeCombatStatGrowth, AI_FIGHT_STAT_POINTS_PER_WIN, DAILY_COMBAT_STAT_CAP } from '../_stat-growth.js';

// P0.2b — server-authoritative daily SOFT-CAP for AI-fight XP/ryo.
//
// The client reports the base XP/ryo it computed for an AI win; the server applies
// the soft-cap using an AUTHORITATIVE per-day counter (atomic incr, so a client
// can't fake its running daily total) and RETURNS the allowed amounts. The client
// then grants exactly that, inside its single save write.
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

        // Authoritative running daily count (atomic; TTL so date keys self-evict).
        const dailyCount = await kv.incr(`ai-fight-count:${playerName}:${utcDateKey()}`, { ex: AI_FIGHT_DAILY_COUNT_TTL_SECONDS });
        const reward = aiFightReward(body.xp, body.ryo, dailyCount);

        // Combat-use stat growth (Stage 4): a small, hard-daily-capped stat reward
        // for the win — auto-grown into the stats the player has invested in, plus a
        // free-pool share. The client applies the returned allocation in its single
        // save write (sanitizer-bounded). A bonus — never a reason to fail the report.
        let statGrowth: { allocated: Record<string, number>; unspentGain: number } = { allocated: {}, unspentGain: 0 };
        try {
            const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = record?.character as Record<string, unknown> | undefined;
            if (char) {
                const stats = (char.stats ?? {}) as Record<string, number>;
                const level = Number(char.level) || 1;
                const budgetKey = `combat-stat-count:${playerName}:${utcDateKey()}`;
                statGrowth = await withKvLock(budgetKey, async () => {
                    const spentToday = Number((await kv.get<number>(budgetKey)) ?? 0);
                    const remaining = Math.max(0, DAILY_COMBAT_STAT_CAP - spentToday);
                    const g = computeCombatStatGrowth(stats, level, AI_FIGHT_STAT_POINTS_PER_WIN, remaining);
                    if (g.spent > 0) await kv.set(budgetKey, spentToday + g.spent, { ex: 25 * 60 * 60 }).catch(() => undefined);
                    return { allocated: g.allocated as Record<string, number>, unspentGain: g.unspentGain };
                });
            }
        } catch (err) {
            console.warn('[missions/report-ai-fight] stat-growth skipped:', err);
        }

        return res.status(200).json({ ok: true, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount, statGrowth });
    } catch (err) {
        console.error('[missions/report-ai-fight]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
