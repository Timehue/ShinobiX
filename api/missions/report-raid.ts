import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { reportMissionEvent, type CompletedMissionInfo } from './_progress.js';
import type { PvpSession } from '../pvp/session.js';

// Replay window for PvP-flavored raid reports — keyed off the same 24h
// window report-pvp-win uses (session KV TTL is typically 1h but a player
// could re-submit a battleId pulled from browser history much later).
const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Vanguard Rank 10 perk: +1 Honor Seal per raid mission completion.
const RANK_10_BONUS_SEAL_PER_MISSION = 1;
// Vanguard Rank 4 perk: +25% Ryo bonus on raid mission rewards (raid missions
// award profession XP + this Ryo bonus for Rank 4+; flat 200 Ryo base × 1.25).
const RAID_MISSION_BASE_RYO = 200;
const RANK_4_RYO_MULT = 1.25;
// Hard daily ceiling on raid reports per player. Legit play tops out
// around 30 raids/day even for a grinder; 60 is comfortably above that
// and well below a botnet's potential. Past the cap the call still
// returns 200 but grants no XP / currency / mission progress.
const MAX_RAID_REPORTS_PER_DAY = 60;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

// Vanguard raid-mission progress reporter. Fires once per completed village
// raid — counts the same whether the defender was a human guard or an AI
// fill-in.
//
// PvP-flavored raids (human defender) now pass `battleId`, and the server
// cross-validates that battleId against the actual PvpSession KV record
// (same pattern as report-pvp-win): session exists, is done, the reporter
// won, and the session age is within the 24h replay window. An atomic NX
// idempotency key on (player, battleId) means each PvP battle can produce
// AT MOST one raid mission report — closing the "spam this endpoint to
// inflate Vanguard rank" exploit for the dominant raid path.
//
// AI-flavored raids (no defender battleId available) keep the legacy
// rate-limit-only path: 1 report / 30s + 60 / day hard cap. The exploit
// surface there is bounded but not closed; tightening it further would
// require a server-side raid-start endpoint, which is the obvious next
// step if abuse appears in telemetry.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    // 30s (was 15s). Halves the worst-case throughput even before the
    // daily cap trips.
    if (!enforceRateLimit(req, res, 'report-raid', 1, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const battleId: string | undefined = typeof body.battleId === 'string' && body.battleId.trim()
            ? body.battleId.trim()
            : undefined;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own raids.' });
        }

        // ── PvP-raid cross-validation ─────────────────────────────────
        // When the client passes a battleId, treat this as a PvP-flavored
        // raid report and verify it against the actual PvpSession record.
        // Same validation pattern as /api/missions/report-pvp-win.
        if (battleId) {
            const session = await kv.get<PvpSession>(`pvp:${battleId}`);
            if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
            if (session.status !== 'done' || !session.winner) {
                return res.status(409).json({ error: 'Battle not yet decided.' });
            }
            const sessionAge = Date.now() - Number(session.createdAt ?? 0);
            if (sessionAge > SESSION_REPLAY_WINDOW_MS) {
                return res.status(409).json({ error: 'Battle session is too old to report.' });
            }
            const winnerName = session.winner === 'p1' ? session.p1.name : session.winner === 'p2' ? session.p2.name : '';
            if (winnerName.toLowerCase() !== playerName.toLowerCase()) {
                return res.status(403).json({ error: 'You are not the winner of this battle.' });
            }
            // Atomic NX idempotency — each battle can only produce one
            // raid mission report. Two racing reports both used to pass
            // a separate get→check→set and double-count; the loser of
            // the NX now short-circuits as alreadyReported.
            const idemKey = `missions:raid-reported:${playerName}:${battleId}`;
            const placed = await kv.set(idemKey, true, { nx: true, ex: 24 * 60 * 60 });
            if (!placed) {
                return res.status(200).json({ ok: true, alreadyReported: true });
            }
        }

        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (char?.profession !== 'vanguard') {
            return res.status(200).json({ ok: true, vanguard: false });
        }

        // Daily report cap. Tracked in a dedicated KV key (not on the
        // character save) so it can't be rolled back via the client-clock
        // save-stamp tricks the audit caught earlier.
        const today = utcDateKey();
        const dailyKey = `raid-report-count:${playerName}:${today}`;
        const reportedToday = Number((await kv.get<number>(dailyKey)) ?? 0);
        if (reportedToday >= MAX_RAID_REPORTS_PER_DAY) {
            return res.status(200).json({
                ok: true,
                vanguard: true,
                reason: 'daily-raid-cap',
                xpAwarded: 0,
                missionsCompleted: [],
                bonusRyo: 0,
                bonusSeals: 0,
            });
        }
        // 25h TTL so the counter survives the rollover window without
        // permanently squatting.
        await kv.set(dailyKey, reportedToday + 1, { ex: 25 * 60 * 60 }).catch(() => undefined);

        const result = await reportMissionEvent({
            playerName,
            profession: 'vanguard',
            kind: 'vanguard-raids',
        });
        const missionsCompleted: CompletedMissionInfo[] = result.missionsCompleted;

        // Even-rank Vanguard perks paid out when a raid mission completes.
        // Rank 4: +25% Ryo bonus (flat 250 Ryo per raid mission complete at R4+).
        // Rank 10: +1 bonus Honor Seal per raid mission complete.
        let bonusRyo = 0;
        let bonusSeals = 0;
        if (missionsCompleted.length > 0) {
            const rank = Number(char.professionRank ?? 1);
            const completedCount = missionsCompleted.length;
            if (rank >= 4) {
                bonusRyo = Math.floor(RAID_MISSION_BASE_RYO * RANK_4_RYO_MULT) * completedCount;
            }
            if (rank >= 10) {
                bonusSeals = RANK_10_BONUS_SEAL_PER_MISSION * completedCount;
            }
            if (bonusRyo > 0 || bonusSeals > 0) {
                // Re-read post-XP-grant character then add Ryo/Seals.
                const fresh = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const freshChar = fresh?.character as Record<string, unknown> | undefined;
                if (freshChar) {
                    const updated = {
                        ...fresh,
                        character: {
                            ...freshChar,
                            ryo: Number(freshChar.ryo ?? 0) + bonusRyo,
                            honorSeals: Number(freshChar.honorSeals ?? 0) + bonusSeals,
                        },
                    };
                    await kv.set(`save:${playerName}`, mergePreservingImages(updated, fresh));
                }
            }
        }

        return res.status(200).json({
            ok: true,
            vanguard: true,
            xpAwarded: result.xpAwarded,
            missionsCompleted,
            bonusRyo,
            bonusSeals,
        });
    } catch (err) {
        console.error('[missions/report-raid]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
