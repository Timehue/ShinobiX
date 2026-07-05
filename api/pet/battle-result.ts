import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { creditRankedOutcome } from '../_ranked-rating.js';

// Pet Arena reward recorder. Non-ranked wins require a short-lived start token
// minted by /api/pet/battle-start for the same reportKey. The battle is still
// client-resolved, but bare result-only reward posts no longer pay out.

const ARENA_WIN_RATE_LIMIT = 5_000;   // ms — one win per 5s per player
const DAILY_ARENA_WIN_CAP = 100;       // max server-validated wins per UTC day
// Ranked-rating credit receipt window. A stale tab re-reporting hours later
// must not re-apply the Elo swing. Matches the 24h receipt in pvp/claim-rewards.ts.
const RANKED_RECEIPT_TTL_SECONDS = 24 * 60 * 60;

type PetBattleOutcome = 'win' | 'loss';

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function petArenaRyoReward(opponentLevel: number): number {
    // Ryo economy rebalance: tuned down from `level * 5` to `level * 2` so the
    // pet arena — a low-effort, 100/day faucet — stops out-earning the active
    // mission loop and inflating ryo. Floor of 20 keeps low-level wins worth it.
    return Math.max(20, opponentLevel * 2);
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
        // Ranked-pet-ladder marker (audit #7 / Stage 3). LIVE — the client sends
        // this from the pet-ranked queue (shinobij.client/src/screens/PetArena.tsx
        // posts { ranked: true, matchToken } here). When true the SERVER owns the
        // petRankedRating swing (computed from the caller's + opponent's ratings as
        // sealed by the match token) instead of the client self-applying
        // rankedDelta. When absent the casual path below runs unchanged.
        const ranked = body.ranked === true;
        let opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(body.opponentLevel ?? 1))));
        // Optional opponent name — used to verify the claimed opponentLevel
        // against the opponent's actual saved level. Stops a level-5 player
        // from claiming wins against level-100 opponents to maximize the
        // `level * 2` ryo formula (200 ryo × 100/day = 20k ryo/day cheat).
        const opponentNameRaw = typeof body.opponentName === 'string' ? safeName(body.opponentName) : '';
        // Optional reportKey for refresh-replay dedup. Clients pass
        // `${battleSeed}:1v1` or `${battleSeed}:match:${i}`; same key from
        // the same player within REPORT_KEY_TTL_SECONDS is treated as a
        // duplicate (the refresh-replay scenario for pet PvP). Sanitized
        // to alphanumerics + : / - so it can't pollute the keyspace.
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        const battleTokenRaw = typeof body.battleToken === 'string' ? body.battleToken.trim() : '';
        const battleToken = /^[A-Za-z0-9]+$/.test(battleTokenRaw) ? battleTokenRaw : '';
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
        // because losses don't pay out so duplicates are harmless.
        if (outcome === 'win' && !identity.admin && !reportKey) {
            return res.status(400).json({ error: 'Missing or invalid reportKey for win.' });
        }

        let casualBattleTokenKey: string | null = null;
        if (outcome === 'win' && !ranked && !identity.admin) {
            if (!battleToken) return res.status(400).json({ error: 'A valid pet battle start token is required.' });
            const tokenKey = `pet:battle-token:${playerName}:${battleToken}`;
            const tokenData = await kv.get<{ playerName?: string; reportKey?: string; opponentLevel?: number }>(tokenKey);
            if (!tokenData || (tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return res.status(200).json({ ok: true, reward: 0, reason: 'invalid-or-spent-pet-battle-token' });
            }
            if (tokenData.reportKey !== reportKey) {
                return res.status(403).json({ error: 'Pet battle token does not match this battle report.' });
            }
            opponentLevelRaw = Math.max(1, Math.min(100, Math.floor(Number(tokenData.opponentLevel ?? opponentLevelRaw))));
            casualBattleTokenKey = tokenKey;
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
        // 200-ryo-per-win formula (× the 100/day cap = 20k ryo/day for no battles).
        let opponentLevel = opponentLevelRaw;
        let verifiedLevel: number | null = null;
        if (opponentNameRaw && opponentNameRaw !== playerName) {
            const oppSave = await kv.get<Record<string, unknown>>(`save:${opponentNameRaw}`);
            const oppChar = (oppSave?.character ?? null) as Record<string, unknown> | null;
            if (oppChar) {
                verifiedLevel = Math.max(1, Math.min(100, Math.floor(Number(oppChar.level ?? 1))));
            }
        }
        if (verifiedLevel != null) {
            // Authenticated opponent — use their real level even if the client
            // claimed higher (silent correction; the player still gets a reward).
            opponentLevel = verifiedLevel;
        } else if (!identity.admin) {
            // Opponent level could NOT be authenticated — clamp the claim to the
            // player's own level + 10, read from their real save (not the body).
            const meSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const meChar = (meSave?.character ?? null) as Record<string, unknown> | null;
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
                ? await kv.get<{ a: string; b: string; aRating: number; bRating: number }>(`pet:ranked-token:${matchToken}`)
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
            const settlePet = async (slug: string, role: 'winner' | 'loser') => {
                const sk = `save:${slug}`;
                const record = await kv.get<Record<string, unknown>>(sk);
                const char = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !char) return undefined;
                const placed = await kv.set(`pet:ranked-settled:${slug}:${matchToken}`, { role, ts: Date.now() }, { nx: true, ex: RANKED_RECEIPT_TTL_SECONDS } as never);
                const r = creditRankedOutcome(char, { role, winnerRating, loserRating, kind: 'pet' });
                if (placed) {
                    const updated = bumpSaveVersion({ ...record, character: { ...char, ...r.patch } });
                    await kv.set(sk, mergePreservingImages(updated, record));
                    return { field: 'petRankedRating', value: r.newRating, delta: r.delta };
                }
                const cur = Number(char.petRankedRating);
                return { field: 'petRankedRating', value: Number.isFinite(cur) ? cur : r.newRating, delta: r.delta };
            };

            try {
                // Lock both saves in deterministic key order (deadlock-free).
                const [k1, k2] = [`save:${winnerName}`, `save:${loserName}`].sort();
                const out = await withKvLock(k1, () => withKvLock(k2, async () => {
                    const w = await settlePet(winnerName, 'winner');
                    const l = (loserName !== winnerName) ? await settlePet(loserName, 'loser') : undefined;
                    return { rating: playerName === winnerName ? w : l };
                }, { failClosed: true }), { failClosed: true });
                const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
                return res.status(200).json({ ok: true, ranked: true, reward: 0, rating: out.rating, _saveVersion: Number(finalSave?._saveVersion ?? 0) });
            } catch (rankedErr) {
                // Lock contention/outage (failClosed) — receipt NOT placed, so
                // the client can safely retry. 503 signals "transient, retry".
                console.error('[pet/battle-result] ranked credit failed', rankedErr);
                return res.status(503).json({ error: 'Could not record ranked result — please retry.' });
            }
        }

        // Apply under a per-player lock so simultaneous result POSTs (e.g.
        // double-clicked Confirm) can't both award ryo + increment counters.
        const result = await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            if (!record) return { error: 'no-save' as const };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { error: 'no-character' as const };
            if (casualBattleTokenKey) {
                const consumed = await kv.del(casualBattleTokenKey);
                if (consumed <= 0) {
                    return {
                        ok: true,
                        reward: 0,
                        reason: 'invalid-or-spent-pet-battle-token',
                        totalPetWins: Number(char.totalPetWins ?? 0),
                        dailyPetWins: Number(char.dailyPetWins ?? 0),
                        _saveVersion: Number(record._saveVersion ?? 0),
                    };
                }
            }

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
                    _saveVersion: Number(record._saveVersion ?? 0),
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
                    _saveVersion: Number(record._saveVersion ?? 0),
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
            bumpSaveVersion(updated);
            await kv.set(saveKey, mergePreservingImages(updated, record));
            return {
                ok: true,
                reward,
                totalPetWins: updatedChar.totalPetWins,
                dailyPetWins: updatedChar.dailyPetWins,
                _saveVersion: Number((updated as Record<string, unknown>)._saveVersion ?? 0),
            };
        }, { failClosed: true });

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
