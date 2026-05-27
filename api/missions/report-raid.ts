import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { reportMissionEvent, type CompletedMissionInfo } from './_progress.js';

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
// Idempotency dedup window for raidId — same id within 10 min is treated
// as a refresh-replay (the client may retry the POST on flaky networks).
const RAID_REPORT_DEDUP_TTL_SECONDS = 10 * 60;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

// Vanguard raid-mission progress reporter. Fires once per completed village
// raid — counts the same whether the defender was a human guard or an AI
// fill-in. Rate-limited to 1 report per 30s per player + a 60/day hard cap.
//
// No server-side "did the raid actually happen" check today — the raid
// system itself is partly client-side. The rate limit + daily cap + per-save
// XP cap bound the impact of any abuse.

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
        // Optional client-supplied raidId for refresh-replay dedup. Sanitized
        // so attackers can't pollute the KV namespace. Same id from the same
        // player within RAID_REPORT_DEDUP_TTL_SECONDS short-circuits to a
        // 200 alreadyReported result.
        const raidIdRaw = typeof body.raidId === 'string' ? body.raidId.slice(0, 80) : '';
        const raidId = /^[A-Za-z0-9:_-]+$/.test(raidIdRaw) ? raidIdRaw : '';
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own raids.' });
        }

        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (char?.profession !== 'vanguard') {
            return res.status(200).json({ ok: true, vanguard: false });
        }

        // Idempotency: NX-reserve the raidId so a retry (or a double-fire
        // from a flaky network) is a no-op. Admin path skips the reservation
        // so test scripts can replay freely. kv.set with NX returns a truthy
        // value on placement and null when the key already existed; we treat
        // a thrown/null result as "fail open" so a KV hiccup doesn't deny
        // legitimate raid reports.
        if (raidId && !identity.admin) {
            const idemKey = `raid-reported:${playerName}:${raidId}`;
            const placed: unknown = await kv.set(idemKey, '1', { nx: true, ex: RAID_REPORT_DEDUP_TTL_SECONDS } as never).catch(() => 'error');
            if (placed === null) {
                return res.status(200).json({
                    ok: true,
                    vanguard: true,
                    alreadyReported: true,
                    xpAwarded: 0,
                    missionsCompleted: [],
                    bonusRyo: 0,
                    bonusSeals: 0,
                });
            }
        }

        // Daily report cap, under a lock so concurrent reports can't both
        // read N and both write N+1 (bypassing the cap on the boundary).
        // The cap lookup + bump is the only KV write here; we hold the lock
        // just long enough to atomically read-check-increment, then release
        // before doing the (slower) mission/XP/bonus work.
        const today = utcDateKey();
        const dailyKey = `raid-report-count:${playerName}:${today}`;
        const capCheck = await withKvLock(dailyKey, async () => {
            const reportedToday = Number((await kv.get<number>(dailyKey)) ?? 0);
            if (reportedToday >= MAX_RAID_REPORTS_PER_DAY) {
                return { capped: true as const };
            }
            // 25h TTL so the counter survives the rollover window without
            // permanently squatting.
            await kv.set(dailyKey, reportedToday + 1, { ex: 25 * 60 * 60 }).catch(() => undefined);
            return { capped: false as const };
        });
        if (capCheck.capped) {
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
                // Wrap the bonus credit in withKvLock(save:*) so a concurrent
                // /api/save auto-save or another reportMissionEvent-triggered
                // XP grant doesn't clobber the ryo/seals delta. Re-read inside
                // the lock so we apply the bonus on top of any concurrent gain.
                const saveKey = `save:${playerName}`;
                await withKvLock(saveKey, async () => {
                    const fresh = await kv.get<Record<string, unknown>>(saveKey);
                    const freshChar = fresh?.character as Record<string, unknown> | undefined;
                    if (!freshChar) return;
                    const updated = {
                        ...fresh,
                        character: {
                            ...freshChar,
                            ryo: Number(freshChar.ryo ?? 0) + bonusRyo,
                            honorSeals: Number(freshChar.honorSeals ?? 0) + bonusSeals,
                        },
                    };
                    await kv.set(saveKey, mergePreservingImages(updated, fresh));
                });
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
