import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { reportMissionEvent, type CompletedMissionInfo } from './_progress.js';

// Vanguard Rank 10 perk: +1 Honor Seal per raid mission completion.
const RANK_10_BONUS_SEAL_PER_MISSION = 1;
// Vanguard Rank 4 perk: +25% Ryo bonus on raid mission rewards (raid missions
// award profession XP + this Ryo bonus for Rank 4+; flat 200 Ryo base × 1.25).
const RAID_MISSION_BASE_RYO = 200;
const RANK_4_RYO_MULT = 1.25;

// Vanguard raid-mission progress reporter. Fires once per completed village
// raid — counts the same whether the defender was a human guard or an AI
// fill-in. Rate-limited to 1 report per 15s per player so a single raid
// can't double-count if the client retries.
//
// No server-side "did the raid actually happen" check today — the raid
// system itself is partly client-side. The rate limit + per-day mission
// caps + per-save XP cap bound the impact of any abuse.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'report-raid', 1, 15_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
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
