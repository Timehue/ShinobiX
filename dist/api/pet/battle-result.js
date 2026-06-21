"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _ranked_rating_js_1 = require("../_ranked-rating.js");
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
// Ranked-rating credit receipt window (audit #7 / Stage 3). Longer than the
// 10-min casual dedup because the rating change is a durable economic credit,
// not just a ryo grant — a stale tab re-reporting hours later must not
// re-apply the Elo swing. Matches the 24h receipt in pvp/claim-rewards.ts.
const RANKED_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
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
        // Ranked-pet-ladder marker (audit #7 / Stage 3). LIVE — the client sends
        // this from the pet-ranked queue (shinobij.client/src/screens/PetArena.tsx
        // posts { ranked: true, matchToken } here). When true the SERVER owns the
        // petRankedRating swing (computed from the caller's + opponent's ratings as
        // sealed by the match token) instead of the client self-applying
        // rankedDelta. When absent the casual path below runs unchanged.
        const ranked = body.ranked === true;
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
        // The opponent's level is trusted ONLY when we can AUTHENTICATE it
        // against their real save. In every other case — no opponent named, OR a
        // named opponent whose save doesn't exist — the claimed level is clamped
        // to myLevel + 10. This closes the hole (audit #5) where supplying a
        // non-existent opponentName took the `if` branch but found no oppChar, so
        // BOTH the actual-level correction and the myLevel+10 clamp were skipped,
        // letting a level-1 player claim opponentLevel 100 for the full
        // 500-ryo-per-win formula (× the 100/day cap = 50k ryo/day for no battles).
        let opponentLevel = opponentLevelRaw;
        let verifiedLevel = null;
        if (opponentNameRaw && opponentNameRaw !== playerName) {
            const oppSave = await _storage_js_1.kv.get(`save:${opponentNameRaw}`);
            const oppChar = (oppSave?.character ?? null);
            if (oppChar) {
                verifiedLevel = Math.max(1, Math.min(100, Math.floor(Number(oppChar.level ?? 1))));
            }
        }
        if (verifiedLevel != null) {
            // Authenticated opponent — use their real level even if the client
            // claimed higher (silent correction; the player still gets a reward).
            opponentLevel = verifiedLevel;
        }
        else if (!identity.admin) {
            // Opponent level could NOT be authenticated — clamp the claim to the
            // player's own level + 10, read from their real save (not the body).
            const meSave = await _storage_js_1.kv.get(`save:${playerName}`);
            const meChar = (meSave?.character ?? null);
            const myLevel = Math.max(1, Math.min(100, Math.floor(Number(meChar?.level ?? 1))));
            opponentLevel = Math.min(opponentLevelRaw, myLevel + 10);
        }
        const saveKey = `save:${playerName}`;
        // ── Ranked pet ladder credit (audit #7 / Stage 3 — LIVE) ────────────
        // Reached when the client sends `ranked:true` — the pet-ranked queue does:
        // PetArena.tsx posts { ranked: true, matchToken } here after a match
        // accepted via /api/pet/ranked-start (Arena.tsx mints that token). When the
        // flag is absent the casual path below runs unchanged. The SERVER owns the
        // petRankedRating swing: it computes the Elo change from the caller's +
        // opponent's ratings as SEALED by the match token (read below) and the
        // reported outcome, then credits the caller's save. This mirrors the
        // client's pet-ranked appliers exactly (creditRankedOutcome), so it is a
        // zero-balance change.
        //
        // Differences from the casual path, by design (matching the client's
        // ranked-pet branch in App.tsx, which grants NO ryo and bypasses the
        // daily arena cap): no ryo, no totalPetWins/dailyPetWins touch — only
        // petRankedRating + petRankedWins/petRankedLosses move here. The general
        // pet-win counters stay client-owned during the convergence window, like
        // the non-rating PvP counters do in claim-rewards.
        //
        // Exactly-once: the receipt is placed INSIDE the save lock together with
        // the rating write (failClosed), so a contention abort (→503) leaves
        // NOTHING placed and a retry credits cleanly without ever double-applying
        // the swing. reportKey is REQUIRED (for losses too, since a ranked loss
        // also moves the rating) so the receipt is stable across refresh-replays.
        if (ranked) {
            // #9: a ranked pet result REQUIRES a server-minted match token (from
            // /api/pet/ranked-start) that sealed BOTH fighters' pre-match
            // petRankedRating. Without it a client could move the ladder by
            // asserting ranked:true against an arbitrary opponent. The token also
            // lets the server settle BOTH accounts from the SAME sealed snapshot,
            // exactly once each — so the loser can't dodge their drop by never
            // reporting. (Client wiring: PetArena.tsx sends ranked:true + matchToken;
            // Arena.tsx mints the token via api/pet/ranked-start.ts.)
            const matchToken = typeof body.matchToken === 'string' ? body.matchToken.trim() : '';
            const tok = matchToken
                ? await _storage_js_1.kv.get(`pet:ranked-token:${matchToken}`)
                : null;
            if (!tok) {
                return res.status(400).json({ error: 'A valid pet ranked match token is required (start via /api/pet/ranked-start).' });
            }
            if (tok.a !== playerName && tok.b !== playerName) {
                return res.status(403).json({ error: 'Match token does not name you.' });
            }
            const callerIsA = tok.a === playerName;
            const opponentName = callerIsA ? tok.b : tok.a;
            const myRating = Number(callerIsA ? tok.aRating : tok.bRating);
            const oppRating = Number(callerIsA ? tok.bRating : tok.aRating);
            const winnerName = outcome === 'win' ? playerName : opponentName;
            const loserName = outcome === 'win' ? opponentName : playerName;
            const winnerRating = outcome === 'win' ? myRating : oppRating;
            const loserRating = outcome === 'win' ? oppRating : myRating;
            // Settle ONE side's petRankedRating once (NX receipt keyed by token +
            // slug) and report its resulting rating.
            const settlePet = async (slug, role) => {
                const sk = `save:${slug}`;
                const record = await _storage_js_1.kv.get(sk);
                const char = (record?.character ?? null);
                if (!record || !char)
                    return undefined;
                const placed = await _storage_js_1.kv.set(`pet:ranked-settled:${slug}:${matchToken}`, { role, ts: Date.now() }, { nx: true, ex: RANKED_RECEIPT_TTL_SECONDS });
                const r = (0, _ranked_rating_js_1.creditRankedOutcome)(char, { role, winnerRating, loserRating, kind: 'pet' });
                if (placed) {
                    await _storage_js_1.kv.set(sk, (0, _utils_js_1.mergePreservingImages)({ ...record, character: { ...char, ...r.patch } }, record));
                    return { field: 'petRankedRating', value: r.newRating, delta: r.delta };
                }
                const cur = Number(char.petRankedRating);
                return { field: 'petRankedRating', value: Number.isFinite(cur) ? cur : r.newRating, delta: r.delta };
            };
            try {
                // Lock both saves in deterministic key order (deadlock-free).
                const [k1, k2] = [`save:${winnerName}`, `save:${loserName}`].sort();
                const out = await (0, _lock_js_1.withKvLock)(k1, () => (0, _lock_js_1.withKvLock)(k2, async () => {
                    const w = await settlePet(winnerName, 'winner');
                    const l = (loserName !== winnerName) ? await settlePet(loserName, 'loser') : undefined;
                    return { rating: playerName === winnerName ? w : l };
                }, { failClosed: true }), { failClosed: true });
                return res.status(200).json({ ok: true, ranked: true, reward: 0, rating: out.rating });
            }
            catch (rankedErr) {
                // Lock contention/outage (failClosed) — receipt NOT placed, so
                // the client can safely retry. 503 signals "transient, retry".
                console.error('[pet/battle-result] ranked credit failed', rankedErr);
                return res.status(503).json({ error: 'Could not record ranked result — please retry.' });
            }
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
