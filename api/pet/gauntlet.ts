import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { replayGauntlet } from '../_pet-sim/gauntlet-sim.js';

/*
 * /api/pet/gauntlet — Pet Gauntlet rewards + weekly leaderboard.
 *
 *   GET  [?week=current|<key>][&top=N]        → { weekKey, total, leaderboard }
 *   POST { action:'start' }                    → { runToken, seed, weekKey, rewardEligible, maxRounds }
 *   POST { action:'report', runToken,
 *          transcript }                        → { ryo, fateShards, boneCharms, score, rank, ... }
 *
 * SERVER-AUTHORITATIVE (mint-token + SERVER RE-SIMULATION — P1 reward integrity;
 * see docs/DATABASE_AND_BACKGROUND_JOB_AUDIT.md §5 + auth-and-anti-cheat §2):
 *   • `start` mints a single-use run token that SEALS the Ryo schedule + the daily
 *     rewarded-run eligibility AND a PER-RUN random seed. The seed is server-minted
 *     (was a client random before) so the server can replay the run; variety is
 *     unchanged (each run still gets its own random draw).
 *   • `report` REQUIRES that token and a decision TRANSCRIPT, and RE-SIMULATES the
 *     whole run server-side (replayGauntlet: the ported board sim + state machine +
 *     drift-tested pool). roundsCleared / heartsLeft / premium eligibility come from
 *     the RE-SIM — never from a client-asserted value. It pays Ryo from the sealed
 *     schedule and banks a Fate Shard / Bone Charm only when the RE-SIMULATED run
 *     actually queued the buy AND cleared round 9 (buyPremium enforces both), still
 *     capped once/day/currency via the NX flags below. A fabricated transcript can
 *     at most reproduce a legal (losing) run — the fights are actually re-fought.
 */

// ── Tunables (sealed server-side) ────────────────────────────────────────────
const MAX_ROUNDS = 10;            // mirrors GAUNTLET_MAX_ROUNDS on the client
const START_HEARTS = 3;           // mirrors GAUNTLET_START_HEARTS
const RYO_PER_ROUND = 250;        // Ryo per round cleared
const CLEAR_BONUS = 1500;         // extra Ryo for clearing all rounds
const REWARDED_RUNS_PER_DAY = 3;  // only the first N rewarded runs/day pay Ryo
const TOKEN_TTL_SECONDS = 60 * 60; // a full run fits comfortably
const LB_MAX = 1000;
// A legit run is a few hundred actions at most; cap the transcript so a huge
// payload can't make the re-sim do unbounded work before the run naturally ends.
const MAX_TRANSCRIPT = 5000;

interface SealedRun { player: string; weekKey: string; seed: number; rewardEligible: boolean; perRound: number; clearBonus: number; maxRounds: number; startHearts: number; }
interface LbEntry { slug: string; name: string; village?: string; score: number; roundsCleared: number; heartsLeft: number; at: number; }

// Epoch-Monday week index (Jan 1 2024 was a Monday) → stable weekly reset, UTC.
const EPOCH_MONDAY = Date.UTC(2024, 0, 1);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function currentWeekIndex(): number { return Math.floor((Date.now() - EPOCH_MONDAY) / WEEK_MS); }
function weekKeyOf(idx: number): string { return `w${idx}`; }
const dayStamp = () => new Date().toISOString().slice(0, 10);

const tokenKey = (id: string) => `petgauntlet:tok:${id}`;
const lbKey = (weekKey: string) => `petgauntlet:lb:${weekKey}`;

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

        // ── start: mint a single-use run token + a SEALED per-run seed ─────────
        if (action === 'start') {
            if (!enforceRateLimit(req, res, 'pet-gauntlet-start', 10, 60_000, me)) return;
            const idx = currentWeekIndex();
            const weekKey = weekKeyOf(idx);
            const startSave = await kv.get<Record<string, unknown>>(`save:${me}`);
            const startChar = (startSave?.character ?? null) as Record<string, unknown> | null;
            const used = startChar?.petGauntletRewardDate === dayStamp() ? Number(startChar.petGauntletRewardCount ?? 0) : 0;
            const rewardEligible = used < REWARDED_RUNS_PER_DAY;
            // Per-run random seed, minted + sealed server-side so `report` can replay
            // the exact run. The client uses this seed for startGauntletRun (it used
            // to mint its own random one — same variety, now verifiable).
            const sealed: SealedRun = {
                player: me, weekKey, seed: randomInt(1, 0x7fffffff), rewardEligible,
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
            const sealed = await kv.get<SealedRun>(tokenKey(id));
            if (!sealed) return res.status(409).json({ error: 'Run token already used or expired.' });
            if (sealed.player !== me) return res.status(403).json({ error: 'Run token belongs to another player.' });

            // RE-SIMULATE the run from the SEALED seed + the client's decision
            // transcript. roundsCleared / heartsLeft / premium eligibility are the
            // SERVER's, computed by re-fighting every round — never the client's word.
            const transcript = body.transcript;
            if (transcript != null && (!Array.isArray(transcript) || transcript.length > MAX_TRANSCRIPT)) {
                return res.status(400).json({ error: 'Invalid run transcript.' });
            }
            const replay = replayGauntlet(sealed.seed, transcript);
            const roundsCleared = clampInt(replay.roundsCleared, 0, sealed.maxRounds);
            const heartsLeft = clampInt(replay.heartsLeft, 0, sealed.startHearts);
            const score = scoreOf(roundsCleared, heartsLeft);

            // ── Pay Ryo from the SEALED schedule (under the save lock), honouring
            //    the daily rewarded-run cap (re-checked atomically here so abandoned
            //    runs never burn a slot). ─────────────────────────────────────────
            let ryo = 0;
            // Premium-currency buys (Fate Shard / Bone Charm) are taken straight from
            // the RE-SIM: replayGauntlet only sets these when the run actually queued
            // the buy AND cleared round 9 AND could afford the Valor (buyPremium
            // enforces all three), so the client can never mint premium currency. Each
            // is still capped once/day/currency via the NX claim flags below.
            const wantShard = replay.boughtFateShard;
            const wantCharm = replay.boughtBoneCharm;
            const day = dayStamp();
            let name = me;
            let village: string | undefined;
            let grantedFateShards = 0;
            let grantedBoneCharms = 0;
            let saveVersion = 0;
            let balances = { ryo: 0, fateShards: 0, boneCharms: 0 };
            let saveMissing = false;
            let settled = false;
            const saveKey = `save:${me}`;
            await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!record || !char) { saveMissing = true; return; }
                saveVersion = Number(record._saveVersion ?? 0);
                name = String(char.name ?? me).slice(0, 40);
                if (typeof char.village === 'string') village = char.village;
                balances = { ryo: Number(char.ryo ?? 0), fateShards: Number(char.fateShards ?? 0), boneCharms: Number(char.boneCharms ?? 0) };
                // Daily once-per-currency claim via NX; fail CLOSED (a KV hiccup just
                // means no grant this time — never a double-grant, never a crash).
                const receipts = Array.isArray(char.redeemedPetGauntletRuns) ? char.redeemedPetGauntletRuns as Array<Record<string, unknown>> : [];
                const prior = receipts.find((entry) => entry.token === id);
                if (prior) {
                    ryo = Number(prior.ryo ?? 0); grantedFateShards = Number(prior.fateShards ?? 0); grantedBoneCharms = Number(prior.boneCharms ?? 0);
                    await kv.del(tokenKey(id)).catch(() => undefined);
                    settled = true; return;
                }
                const rewardedToday = char.petGauntletRewardDate === day ? Math.max(0, Number(char.petGauntletRewardCount ?? 0)) : 0;
                const rewardThisRun = sealed.rewardEligible && roundsCleared > 0 && rewardedToday < REWARDED_RUNS_PER_DAY;
                ryo = rewardThisRun ? sealed.perRound * roundsCleared + (roundsCleared >= sealed.maxRounds ? sealed.clearBonus : 0) : 0;
                const premiumToday = char.petGauntletPremiumDate === day;
                grantedFateShards = wantShard && (!premiumToday || char.petGauntletFateClaimed !== true) ? 1 : 0;
                grantedBoneCharms = wantCharm && (!premiumToday || char.petGauntletBoneClaimed !== true) ? 1 : 0;
                const receipt = { token: id, ryo, fateShards: grantedFateShards, boneCharms: grantedBoneCharms };
                const next = {
                    ...char,
                    ryo: Number(char.ryo ?? 0) + ryo,
                    fateShards: Number(char.fateShards ?? 0) + grantedFateShards,
                    boneCharms: Number(char.boneCharms ?? 0) + grantedBoneCharms,
                    petGauntletRewardDate: day,
                    petGauntletRewardCount: rewardedToday + (rewardThisRun ? 1 : 0),
                    petGauntletPremiumDate: day,
                    petGauntletFateClaimed: (premiumToday && char.petGauntletFateClaimed === true) || grantedFateShards > 0,
                    petGauntletBoneClaimed: (premiumToday && char.petGauntletBoneClaimed === true) || grantedBoneCharms > 0,
                    redeemedPetGauntletRuns: [...receipts.slice(-49), receipt],
                };
                const updated = bumpSaveVersion({ ...record, character: next });
                await kv.set(saveKey, mergePreservingImages(updated, record));
                await kv.del(tokenKey(id)).catch(() => undefined);
                settled = true;
                saveVersion = Number((updated as Record<string, unknown>)._saveVersion ?? 0);
                balances = { ryo: Number(next.ryo), fateShards: Number(next.fateShards), boneCharms: Number(next.boneCharms) };
            }, { failClosed: true });

            // ── Update the weekly leaderboard (best-per-player). ────────────────
            if (saveMissing) return res.status(404).json({ error: 'Player save not found.' });
            if (!settled) return res.status(503).json({ error: 'Gauntlet result could not be settled. Please retry.' });
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

            return res.status(200).json({ ryo, fateShards: grantedFateShards, boneCharms: grantedBoneCharms, balances, score, rank, weekKey: sealed.weekKey, roundsCleared, heartsLeft, _saveVersion: saveVersion });
        }

        return res.status(400).json({ error: 'Invalid action.' });
    } catch (err) {
        console.error('[pet/gauntlet]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
