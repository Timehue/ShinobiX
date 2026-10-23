import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { replayGauntlet } from '../_pet-sim/gauntlet-sim.js';
import { debitGauntletEntry } from './_gauntlet-entry.js';
import { petGauntletRyoSchedule } from '../../shared/pet-gauntlet-economy.js';
import { recordEconomyTxn } from '../_economy.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';

/*
 * /api/pet/gauntlet — Pet Gauntlet rewards + weekly leaderboard.
 *
 *   GET  [?week=current|<key>][&top=N]        → { weekKey, total, leaderboard }
 *   POST { action:'start', requestId? }        → { runToken, seed, weekKey, rewardEligible, maxRounds }
 *   POST { action:'report', runToken,
 *          transcript }                        → { ryo, fateShards, boneCharms, score, rank, ... }
 *
 * SERVER-AUTHORITATIVE (mint-token + SERVER RE-SIMULATION — P1 reward integrity;
 * see docs/DATABASE_AND_BACKGROUND_JOB_AUDIT.md §5 + auth-and-anti-cheat §2):
 *   • `start` seals a single-use entry proof with the Ryo schedule + the daily
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
// Ryo per round cleared and the full-clear bonus scale with A(L) and are sealed
// at start: 250 / 1,500 from L70 (shared/pet-gauntlet-economy.ts).
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

/** Economy telemetry (I-19) for one committed run payout, keyed on its single-use
 *  run token. A replayed report and a zero grant record nothing. */
function recordGauntletPayout(
    player: string,
    runToken: string,
    paid: { ryo: number; fateShards: number; boneCharms: number },
    character: Record<string, unknown>,
): void {
    void recordEconomyTxn({ txnId: `pet-gauntlet:${runToken}:ryo`, player, currency: 'ryo', delta: paid.ryo, source: 'pet.gauntlet', balanceAfter: Number(character.ryo ?? 0) });
    void recordEconomyTxn({ txnId: `pet-gauntlet:${runToken}:fateShards`, player, currency: 'fateShards', delta: paid.fateShards, source: 'pet.gauntlet', balanceAfter: Number(character.fateShards ?? 0) });
    void recordEconomyTxn({ txnId: `pet-gauntlet:${runToken}:boneCharms`, player, currency: 'boneCharms', delta: paid.boneCharms, source: 'pet.gauntlet', balanceAfter: Number(character.boneCharms ?? 0) });
}

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
            const requestId = String(body.requestId ?? '');
            if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return res.status(400).json({ error: 'Invalid Gauntlet entry request.' });
            const id = requestId || randomUUID();
            return await withKvLock(tokenKey(id), async () => {
                const reply = (sealed: SealedRun, character: Record<string, unknown>, version: number, chargedRyo: number, resumed = false) => {
                    const used = character.petGauntletRewardDate === dayStamp() ? Number(character.petGauntletRewardCount ?? 0) : 0;
                    return res.status(200).json({ runToken: id, seed: sealed.seed, weekKey: sealed.weekKey, rewardEligible: sealed.rewardEligible,
                        maxRounds: sealed.maxRounds, perRound: sealed.perRound, clearBonus: sealed.clearBonus,
                        rewardedRunsLeft: Math.max(0, REWARDED_RUNS_PER_DAY - used), chargedRyo, resumed,
                        balances: { ryo: Number(character.ryo ?? 0) }, character, _saveVersion: version });
                };
                const existing = await kv.get<SealedRun>(tokenKey(id));
                if (existing) {
                    if (existing.player !== me) return res.status(403).json({ error: 'That Gauntlet entry belongs to another player.' });
                    const saved = await kv.get<{ character?: Record<string, unknown>; _saveVersion?: number }>(`save:${me}`);
                    if (!saved?.character) return res.status(404).json({ error: 'Player save not found.' });
                    return reply(existing, saved.character, Number(saved._saveVersion), 0, true);
                }
                const reservation = await retryOnSaveVersionConflict(() => mutatePlayerSave<{ chargedRyo: number; sealed: SealedRun }>(me, ({ character: char }) => {
                    if (Array.isArray(char.redeemedPetGauntletRuns) && char.redeemedPetGauntletRuns.some(entry => (entry as { token?: unknown })?.token === id)) {
                        return { ok: false, status: 409, error: 'This Gauntlet entry has already finished. Its reward is saved.' };
                    }
                    const result = debitGauntletEntry(char, dayStamp());
                    if (!result.ok) return { ok: false, status: 409, error: `A new Gauntlet run costs ${result.required.toLocaleString()} ryo. Not enough ryo.` };
                    const used = char.petGauntletRewardDate === dayStamp() ? Number(char.petGauntletRewardCount ?? 0) : 0;
                    const schedule = petGauntletRyoSchedule(char.level);
                    const sealed: SealedRun = { player: me, weekKey, seed: randomInt(1, 0x7fffffff), rewardEligible: used < REWARDED_RUNS_PER_DAY,
                        perRound: schedule.perRound, clearBonus: schedule.clearBonus, maxRounds: MAX_ROUNDS, startHearts: START_HEARTS };
                    // The existing run-seal row and the save/ledger commit in
                    // one transaction. A lost reply cannot debit another entry.
                    return { ok: true, character: result.character, value: { chargedRyo: result.charged, sealed },
                        atomicProof: { key: tokenKey(id), value: sealed, ex: TOKEN_TTL_SECONDS } };
                }));
                if (!reservation.ok) return res.status(reservation.status).json({ error: reservation.error });
                // Economy telemetry (I-19): the committed entry fee, keyed on the
                // save version that charged it. The day's first run is free and the
                // zero delta records nothing; a resumed entry charged nothing here.
                void recordEconomyTxn({ txnId: `pet-gauntlet-entry:${me}:${reservation._saveVersion}`, player: me, currency: 'ryo', delta: -reservation.value.chargedRyo, source: 'pet.gauntlet.fee', balanceAfter: Number(reservation.character.ryo ?? 0) });
                return reply(reservation.value.sealed, reservation.character, reservation._saveVersion, reservation.value.chargedRyo);
            }, { failClosed: true });
        }

        // ── report: consume token, pay sealed Ryo, update weekly board ─────────
        if (action === 'report') {
            if (!enforceRateLimit(req, res, 'pet-gauntlet-report', 10, 60_000, me)) return;
            const id = String(body.runToken ?? '');
            if (!id) return res.status(400).json({ error: 'Missing run token.' });

            // The save receipt prevents double payment. The leaderboard must
            // accept the result before payout can retire the run seal.
            const sealed = await kv.get<SealedRun>(tokenKey(id));
            if (!sealed) {
                const saved = await kv.get<{ character?: Record<string, unknown>; _saveVersion?: number }>(`save:${me}`);
                const char = saved?.character;
                const receipts = Array.isArray(char?.redeemedPetGauntletRuns) ? char.redeemedPetGauntletRuns as Array<Record<string, unknown>> : [];
                const prior = receipts.find(entry => entry.token === id);
                if (!char || !prior) return res.status(409).json({ code: 'GAUNTLET_REPORT_EXPIRED', error: 'Run token expired and no saved reward receipt is available.' });
                // A reply lost after both commits still has a paid receipt.
                // Historical receipts do not contain a score or weekly rank.
                return res.status(200).json({ ryo: Number(prior.ryo ?? 0), fateShards: Number(prior.fateShards ?? 0), boneCharms: Number(prior.boneCharms ?? 0),
                    balances: { ryo: Number(char.ryo ?? 0), fateShards: Number(char.fateShards ?? 0), boneCharms: Number(char.boneCharms ?? 0) },
                    character: char, _saveVersion: saved!._saveVersion, score: null, rank: null, weekKey: '', roundsCleared: null, heartsLeft: null });
            }
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
            const current = await kv.get<{ character?: Record<string, unknown> }>(`save:${me}`);
            if (!current?.character) return res.status(404).json({ error: 'Player save not found.' });
            const name = String(current.character.name ?? me).slice(0, 40);
            const village = typeof current.character.village === 'string' ? current.character.village : undefined;
            // Deliver the non-currency score first. A failed leaderboard write
            // leaves an unpaid seal for retry, rather than retaining a paid
            // seal whose rolling reward receipt could later be evicted.
            let rank: number | null = null;
            await withKvLock(lbKey(sealed.weekKey), async () => {
                const list = (await kv.get<LbEntry[]>(lbKey(sealed.weekKey))) ?? [];
                const i = list.findIndex((e) => e.slug === me);
                const entry: LbEntry = { slug: me, name, village, score, roundsCleared, heartsLeft, at: Date.now() };
                if (i >= 0) { if (score > list[i].score) list[i] = entry; }
                else list.push(entry);
                list.sort((a, b) => b.score - a.score || a.at - b.at);
                const trimmed = list.slice(0, LB_MAX);
                await kv.set(lbKey(sealed.weekKey), trimmed, { ex: 60 * 24 * 3600 });
                const pos = trimmed.findIndex((e) => e.slug === me);
                rank = pos >= 0 ? pos + 1 : null;
            }, { failClosed: true });
            let grantedFateShards = 0;
            let grantedBoneCharms = 0;
            let saveVersion = 0;
            let balances = { ryo: 0, fateShards: 0, boneCharms: 0 };
            let saveMissing = false;
            let settled = false;
            // The run's receipt commits with the payout, so re-running the whole
            // settlement after a lost compare-and-set pays it once.
            const committed = await retryOnSaveVersionConflict(() => mutatePlayerSave<null>(me, async ({ character: char }) => {
                balances = { ryo: Number(char.ryo ?? 0), fateShards: Number(char.fateShards ?? 0), boneCharms: Number(char.boneCharms ?? 0) };
                // Daily once-per-currency claim via NX; fail CLOSED (a KV hiccup just
                // means no grant this time — never a double-grant, never a crash).
                const receipts = Array.isArray(char.redeemedPetGauntletRuns) ? char.redeemedPetGauntletRuns as Array<Record<string, unknown>> : [];
                const prior = receipts.find((entry) => entry.token === id);
                if (prior) {
                    ryo = Number(prior.ryo ?? 0); grantedFateShards = Number(prior.fateShards ?? 0); grantedBoneCharms = Number(prior.boneCharms ?? 0);
                    return { ok: true, write: false, character: char, value: null };
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
                balances = { ryo: Number(next.ryo), fateShards: Number(next.fateShards), boneCharms: Number(next.boneCharms) };
                return {
                    ok: true,
                    character: next,
                    value: null,
                    // The run seal is retired after the reply is built (below);
                    // only the payout telemetry rides the commit.
                    afterCommit: async () => {
                        recordGauntletPayout(me, id, { ryo, fateShards: grantedFateShards, boneCharms: grantedBoneCharms }, next);
                    },
                };
            }));
            if (!committed.ok) {
                saveMissing = true;
            } else {
                settled = true;
                saveVersion = committed._saveVersion;
            }

            if (saveMissing) return res.status(404).json({ error: 'Player save not found.' });
            if (!committed.ok) return res.status(503).json({ error: 'Gauntlet result could not be settled. Please retry.' });
            if (!settled) return res.status(503).json({ error: 'Gauntlet result could not be settled. Please retry.' });
            await kv.del(tokenKey(id));
            return res.status(200).json({ ryo, fateShards: grantedFateShards, boneCharms: grantedBoneCharms, balances, score, rank, weekKey: sealed.weekKey, roundsCleared, heartsLeft, character: committed.character, _saveVersion: saveVersion });
        }

        return res.status(400).json({ error: 'Invalid action.' });
    } catch (err) {
        // Nothing was written and no run token was minted, so a retry is exact.
        if (isPlayerSaveVersionConflict(err)) return res.status(409).json(SAVE_VERSION_CONFLICT_REPLY);
        console.error('[pet/gauntlet]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
