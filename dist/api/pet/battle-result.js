"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
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
const ARENA_WIN_RATE_LIMIT = 5_000; // ms — one win per 5s per player
const DAILY_ARENA_WIN_CAP = 100; // max server-validated wins per UTC day
const REPORT_KEY_TTL_SECONDS = 10 * 60; // 10-min dedup window per reportKey
function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}
function petArenaRyoReward(opponentLevel) {
    return Math.max(20, opponentLevel * 5);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Rate limit BEFORE auth so unauthenticated spam at unknown names also
    // gets throttled. 5s window matches the realistic minimum battle length.
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'pet-battle-result', 12, 60_000, peekName))
        return;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'pet-battle-result-burst', 1, ARENA_WIN_RATE_LIMIT, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const outcome = (body.outcome === 'win' || body.outcome === 'loss') ? body.outcome : null;
        const opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(body.opponentLevel ?? 1))));
        // Optional opponent name — used to verify the claimed opponentLevel
        // against the opponent's actual saved level. Stops a level-5 player
        // from claiming wins against level-100 opponents to maximize the
        // `level * 5` ryo formula (500 ryo × 100/day = 50k ryo/day cheat).
        const opponentNameRaw = typeof body.opponentName === 'string' ? (0, _utils_js_1.safeName)(body.opponentName) : '';
        // Optional reportKey for refresh-replay dedup. Clients pass
        // `${battleSeed}:1v1` or `${battleSeed}:match:${i}`; same key from
        // the same player within REPORT_KEY_TTL_SECONDS is treated as a
        // duplicate (the refresh-replay scenario for pet PvP). Sanitized
        // to alphanumerics + : / - so it can't pollute the keyspace.
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!outcome)
            return res.status(400).json({ error: 'Invalid outcome.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own battles.' });
        }
        // reportKey is REQUIRED for wins. Previously optional, which let a
        // botted client omit it (or randomize per call) and farm the daily
        // cap with zero real battles. Admins and 'loss' outcomes are exempt
        // because losses don't pay out so duplicates are harmless.
        if (outcome === 'win' && !identity.admin && !reportKey) {
            return res.status(400).json({ error: 'Missing or invalid reportKey for win.' });
        }
        // ── opponentLevel cross-check ─────────────────────────────────
        // When the client tells us who the opponent was, verify the
        // claimed level matches that opponent's actual save. Players who
        // omit opponentName (legacy clients, AI duels with no named foe)
        // fall back to the level-cap rule below.
        let opponentLevel = opponentLevelRaw;
        if (opponentNameRaw && opponentNameRaw !== playerName) {
            const oppSave = await _storage_js_1.kv.get(`save:${opponentNameRaw}`);
            const oppChar = (oppSave?.character ?? null);
            if (oppChar) {
                const actualLevel = Math.max(1, Math.min(100, Math.floor(Number(oppChar.level ?? 1))));
                // Use the actual saved level — even if the client claimed
                // higher. This silently corrects the claim rather than
                // erroring (so the player still gets a valid reward).
                opponentLevel = actualLevel;
            }
        }
        else if (!identity.admin) {
            // No opponent name supplied — clamp claimed level to
            // playerLevel + 10 so the unnamed-opponent path can't exploit
            // the formula. Look up the player's own actual level (not the
            // value in the request body, which we don't trust here).
            const meSave = await _storage_js_1.kv.get(`save:${playerName}`);
            const meChar = (meSave?.character ?? null);
            const myLevel = Math.max(1, Math.min(100, Math.floor(Number(meChar?.level ?? 1))));
            opponentLevel = Math.min(opponentLevelRaw, myLevel + 10);
        }
        // Refresh-replay dedup: NX-reserve the reportKey atomically. If it
        // was already set, the client has already reported this exact
        // battle outcome — return 200 alreadyReported so the caller's UI
        // doesn't error out, but skip the ryo + counter increments.
        if (reportKey && outcome === 'win') {
            const dedupKey = `pet:reported:${playerName}:${reportKey}`;
            const placed = await _storage_js_1.kv.set(dedupKey, '1', { nx: true, ex: REPORT_KEY_TTL_SECONDS }).catch(() => null);
            if (placed === null) {
                // KV write errored — fail open to avoid denying real wins.
            }
            else if (!placed) {
                return res.status(200).json({ ok: true, alreadyReported: true, reward: 0 });
            }
        }
        const saveKey = `save:${playerName}`;
        // Apply under a per-player lock so simultaneous result POSTs (e.g.
        // double-clicked Confirm) can't both award ryo + increment counters.
        const result = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            if (!record)
                return { error: 'no-save' };
            const char = record.character;
            if (!char)
                return { error: 'no-character' };
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
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
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
    }
    catch (err) {
        console.error('[pet/battle-result]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
