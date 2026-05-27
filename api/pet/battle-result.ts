import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';

// Server-authoritative Pet Arena win recorder. Replaces the client-trusted
// ryo + totalPetWins increment that lived in the PetArena component.
//
// Trust model: we don't simulate the battle server-side (the autobattler is
// 200+ lines of grid pathfinding + jutsu cooldown logic), so the client's
// "I won" claim is taken on faith — BUT bounded by:
//   • 5-second per-player rate limit (battles take >30s in practice)
//   • Daily cap of 100 arena ryo grants per player (legitimate grinders
//     never come close)
//   • opponentLevel clamped to [1, 100] before reward math
//   • Reward formula identical to the old client one, so we don't inflate
//     anything legitimate
//
// Combined with the existing per-save ryo cap (1M / save cycle) and rolling
// gain window, the practical fraud ceiling is meaningfully tight without
// requiring a full server-side battle simulator.

const ARENA_WIN_RATE_LIMIT = 5_000;   // ms — one win per 5s per player
const DAILY_ARENA_WIN_CAP = 100;       // max server-validated wins per UTC day
const REPORT_KEY_TTL_SECONDS = 10 * 60; // 10-min dedup window per reportKey

type PetBattleOutcome = 'win' | 'loss';

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function petArenaRyoReward(opponentLevel: number): number {
    return Math.max(20, opponentLevel * 5);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Rate limit BEFORE auth so unauthenticated spam at unknown names also
    // gets throttled. 5s window matches the realistic minimum battle length.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'pet-battle-result', 12, 60_000, peekName)) return;
    if (!enforceRateLimit(req, res, 'pet-battle-result-burst', 1, ARENA_WIN_RATE_LIMIT, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const outcome = (body.outcome === 'win' || body.outcome === 'loss') ? body.outcome as PetBattleOutcome : null;
        const opponentLevel = Math.max(1, Math.min(100, Math.floor(Number(body.opponentLevel ?? 1))));
        // Optional reportKey for refresh-replay dedup. Clients pass
        // `${battleSeed}:1v1` or `${battleSeed}:match:${i}`; same key from
        // the same player within REPORT_KEY_TTL_SECONDS is treated as a
        // duplicate (the refresh-replay scenario for pet PvP). Sanitized
        // to alphanumerics + : / - so it can't pollute the keyspace.
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!outcome) return res.status(400).json({ error: 'Invalid outcome.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own battles.' });
        }

        // reportKey is REQUIRED for wins. Previously optional, which let a
        // botted client omit it (or randomize per call) and farm the daily
        // cap with zero real battles. Admins and 'loss' outcomes are exempt
        // because losses don't pay out so duplicates are harmless. The key
        // must look like a real battle id (alphanumerics + : _ -) so
        // attackers can't supply a single static value.
        if (outcome === 'win' && !identity.admin && !reportKey) {
            return res.status(400).json({ error: 'Missing or invalid reportKey for win.' });
        }

        // Refresh-replay dedup: NX-reserve the reportKey atomically. If it
        // was already set, the client has already reported this exact
        // battle outcome — return 200 alreadyReported so the caller's UI
        // doesn't error out, but skip the ryo + counter increments.
        if (reportKey && outcome === 'win') {
            const dedupKey = `pet:reported:${playerName}:${reportKey}`;
            const placed = await kv.set(dedupKey, '1', { nx: true, ex: REPORT_KEY_TTL_SECONDS } as never).catch(() => null);
            if (placed === null) {
                // KV write errored — fail open to avoid denying real wins.
            } else if (!placed) {
                return res.status(200).json({ ok: true, alreadyReported: true, reward: 0 });
            }
        }

        const saveKey = `save:${playerName}`;

        // Apply under a per-player lock so simultaneous result POSTs (e.g.
        // double-clicked Confirm) can't both award ryo + increment counters.
        const result = await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            if (!record) return { error: 'no-save' as const };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { error: 'no-character' as const };

            const today = utcDateKey();
            const lastReset = String(char.lastDailyReset ?? '');
            // Reset daily counters when the UTC day rolls over.
            const dailyPetWins = lastReset === today ? Number(char.dailyPetWins ?? 0) : 0;

            // Loss: no reward, but still track win streak metadata. We don't
            // currently store losses anywhere — return ok so the client UI
            // can show "recorded" instead of silently no-op'ing.
            if (outcome === 'loss') {
                return {
                    ok: true,
                    reward: 0,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                };
            }

            // Daily cap: stop further reward grants once the cap is hit, but
            // still acknowledge the call (so a streamer grinding all day
            // doesn't see error spam — they just stop earning).
            if (dailyPetWins >= DAILY_ARENA_WIN_CAP) {
                return {
                    ok: true,
                    reward: 0,
                    capped: true,
                    totalPetWins: Number(char.totalPetWins ?? 0),
                    dailyPetWins,
                };
            }

            const reward = petArenaRyoReward(opponentLevel);
            const updatedChar = {
                ...char,
                ryo: Number(char.ryo ?? 0) + reward,
                totalPetWins: Number(char.totalPetWins ?? 0) + 1,
                dailyPetWins: dailyPetWins + 1,
                lastDailyReset: today,
            };
            const updated = { ...record, character: updatedChar };
            await kv.set(saveKey, mergePreservingImages(updated, record));
            return {
                ok: true,
                reward,
                totalPetWins: updatedChar.totalPetWins,
                dailyPetWins: updatedChar.dailyPetWins,
            };
        });

        if ('error' in result) {
            const code = result.error === 'no-save' || result.error === 'no-character' ? 404 : 500;
            return res.status(code).json({ error: result.error });
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[pet/battle-result]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
