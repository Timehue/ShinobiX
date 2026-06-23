import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';

/*
 * /api/pet/gauntlet — Pet Gauntlet rewards + weekly leaderboard.
 *
 *   GET  [?week=current|<key>][&top=N]        → { weekKey, total, leaderboard }
 *   POST { action:'start' }                    → { runToken, seed, weekKey, rewardEligible, maxRounds }
 *   POST { action:'report', runToken,
 *          roundsCleared, heartsLeft }         → { ryo, score, rank, weekKey, roundsCleared, heartsLeft }
 *
 * SERVER-AUTHORITATIVE (mint-token pattern, same shape as pet/ranked-start →
 * pet/battle-result and missions/claim-mission):
 *   • `start` mints a single-use run token that SEALS the Ryo reward schedule +
 *     reward-eligibility (the daily rewarded-run cap is decided here, not by the
 *     client) and hands back the WEEKLY SHARED SEED so every player faces the
 *     same gauntlet → a fair leaderboard.
 *   • `report` REQUIRES that token, consumes it atomically (under its own lock),
 *     and pays Ryo from the SEALED schedule — never from a client-supplied
 *     amount. roundsCleared / heartsLeft are clamped to their legal bounds before
 *     they feed the payout or the board, so a tampered body can at most claim a
 *     perfect run (bounded by the sealed per-round Ryo + the daily cap). The
 *     in-run Valor economy is purely client-side and never touches Ryo.
 *
 * v1 trust model matches field/hunt missions + pet expeditions: the run is
 * deterministic from the seed, so a future hardening can re-simulate it
 * server-side (port pet-board-sim, like _duel-sim is the ranked twin) to make
 * the leaderboard fully replay-validated. For now the token + clamps + daily cap
 * bound the abuse surface.
 */

// ── Tunables (sealed server-side) ────────────────────────────────────────────
const MAX_ROUNDS = 10;            // mirrors GAUNTLET_MAX_ROUNDS on the client
const START_HEARTS = 3;           // mirrors GAUNTLET_START_HEARTS
const RYO_PER_ROUND = 250;        // Ryo per round cleared
const CLEAR_BONUS = 1500;         // extra Ryo for clearing all rounds
const REWARDED_RUNS_PER_DAY = 3;  // only the first N rewarded runs/day pay Ryo
const TOKEN_TTL_SECONDS = 60 * 60; // a full run fits comfortably
const LB_MAX = 1000;

interface SealedRun { player: string; weekKey: string; seed: number; rewardEligible: boolean; perRound: number; clearBonus: number; maxRounds: number; startHearts: number; }
interface LbEntry { slug: string; name: string; village?: string; score: number; roundsCleared: number; heartsLeft: number; at: number; }

// Epoch-Monday week index (Jan 1 2024 was a Monday) → stable weekly reset, UTC.
const EPOCH_MONDAY = Date.UTC(2024, 0, 1);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function currentWeekIndex(): number { return Math.floor((Date.now() - EPOCH_MONDAY) / WEEK_MS); }
function weekKeyOf(idx: number): string { return `w${idx}`; }
function seedForWeek(idx: number): number { return (Math.imul(idx + 1, 2654435761) >>> 0) & 0x7fffffff; }
const dayStamp = () => new Date().toISOString().slice(0, 10);

const tokenKey = (id: string) => `petgauntlet:tok:${id}`;
const lbKey = (weekKey: string) => `petgauntlet:lb:${weekKey}`;
const rewardCountKey = (slug: string, day: string) => `petgauntlet:rewarded:${slug}:${day}`;

const clampInt = (v: unknown, lo: number, hi: number): number => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
};
const scoreOf = (roundsCleared: number, heartsLeft: number): number => roundsCleared * 1000 + heartsLeft * 100;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: public weekly leaderboard ────────────────────────────────────────
    if (req.method === 'GET') {
        const idx = currentWeekIndex();
        const reqWeek = String(req.query.week ?? 'current');
        const weekKey = !reqWeek || reqWeek === 'current' ? weekKeyOf(idx) : safeName(reqWeek).slice(0, 16);
        const topRaw = Number(req.query.top);
        const limit = Number.isInteger(topRaw) && topRaw > 0 && topRaw <= 100 ? topRaw : 50;
        const list = (await kv.get<LbEntry[]>(lbKey(weekKey))) ?? [];
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            weekKey,
            total: list.length,
            leaderboard: list.slice(0, limit).map((e, i) => ({ rank: i + 1, name: e.name, village: e.village, score: e.score, roundsCleared: e.roundsCleared, heartsLeft: e.heartsLeft })),
        });
    }

    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const action = String(body.action ?? '');

        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (identity.admin) return res.status(400).json({ error: 'Gauntlet runs require a player identity.' });
        const me = identity.name;

        // ── start: mint a single-use run token + hand back the weekly seed ─────
        if (action === 'start') {
            if (!enforceRateLimit(req, res, 'pet-gauntlet-start', 10, 60_000, me)) return;
            const idx = currentWeekIndex();
            const weekKey = weekKeyOf(idx);
            const used = Number((await kv.get<number>(rewardCountKey(me, dayStamp()))) ?? 0);
            const rewardEligible = used < REWARDED_RUNS_PER_DAY;
            const sealed: SealedRun = {
                player: me, weekKey, seed: seedForWeek(idx), rewardEligible,
                perRound: RYO_PER_ROUND, clearBonus: CLEAR_BONUS, maxRounds: MAX_ROUNDS, startHearts: START_HEARTS,
            };
            const id = randomUUID();
            await kv.set(tokenKey(id), sealed, { ex: TOKEN_TTL_SECONDS });
            return res.status(200).json({ runToken: id, seed: sealed.seed, weekKey, rewardEligible, maxRounds: MAX_ROUNDS, rewardedRunsLeft: Math.max(0, REWARDED_RUNS_PER_DAY - used) });
        }

        // ── report: consume token, pay sealed Ryo, update weekly board ─────────
        if (action === 'report') {
            if (!enforceRateLimit(req, res, 'pet-gauntlet-report', 10, 60_000, me)) return;
            const id = String(body.runToken ?? '');
            if (!id) return res.status(400).json({ error: 'Missing run token.' });

            // Atomically consume the token (read + delete under its own lock) so a
            // replayed report can't be paid twice.
            const sealed = await withKvLock<SealedRun | null>(tokenKey(id), async () => {
                const doc = await kv.get<SealedRun>(tokenKey(id));
                if (!doc) return null;
                await kv.del(tokenKey(id));
                return doc;
            }, { failClosed: true });
            if (!sealed) return res.status(409).json({ error: 'Run token already used or expired.' });
            if (sealed.player !== me) return res.status(403).json({ error: 'Run token belongs to another player.' });

            const roundsCleared = clampInt(body.roundsCleared, 0, sealed.maxRounds);
            const heartsLeft = clampInt(body.heartsLeft, 0, sealed.startHearts);
            const score = scoreOf(roundsCleared, heartsLeft);

            // ── Pay Ryo from the SEALED schedule (under the save lock), honouring
            //    the daily rewarded-run cap (re-checked atomically here so abandoned
            //    runs never burn a slot). ─────────────────────────────────────────
            let ryo = 0;
            if (sealed.rewardEligible && roundsCleared > 0) {
                const used = await kv.incr(rewardCountKey(me, dayStamp()), { ex: 36 * 3600 });
                if (used <= REWARDED_RUNS_PER_DAY) {
                    ryo = sealed.perRound * roundsCleared + (roundsCleared >= sealed.maxRounds ? sealed.clearBonus : 0);
                }
            }
            let name = me;
            let village: string | undefined;
            const saveKey = `save:${me}`;
            await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!record || !char) return;
                name = String(char.name ?? me).slice(0, 40);
                if (typeof char.village === 'string') village = char.village;
                if (ryo > 0) {
                    const next = { ...char, ryo: Number(char.ryo ?? 0) + ryo };
                    await kv.set(saveKey, mergePreservingImages({ ...record, character: next }, record));
                }
            }, { failClosed: true });

            // ── Update the weekly leaderboard (best-per-player). ────────────────
            let rank: number | null = null;
            await withKvLock(lbKey(sealed.weekKey), async () => {
                const list = (await kv.get<LbEntry[]>(lbKey(sealed.weekKey))) ?? [];
                const i = list.findIndex((e) => e.slug === me);
                const entry: LbEntry = { slug: me, name, village, score, roundsCleared, heartsLeft, at: Date.now() };
                if (i >= 0) { if (score > list[i].score) list[i] = entry; }
                else list.push(entry);
                list.sort((a, b) => b.score - a.score || a.at - b.at);
                const trimmed = list.slice(0, LB_MAX);
                await kv.set(lbKey(sealed.weekKey), trimmed, { ex: 60 * 24 * 3600 });   // keep ~60 days
                const pos = trimmed.findIndex((e) => e.slug === me);
                rank = pos >= 0 ? pos + 1 : null;
            }, { failClosed: true });

            return res.status(200).json({ ryo, score, rank, weekKey: sealed.weekKey, roundsCleared, heartsLeft });
        }

        return res.status(400).json({ error: 'Invalid action.' });
    } catch (err) {
        console.error('[pet/gauntlet]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
