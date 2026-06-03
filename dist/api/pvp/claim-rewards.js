"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _ranked_rating_js_1 = require("../_ranked-rating.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
// Session-replay window — tightened from 24h to 2h. Sessions themselves
// have a 15-min KV TTL (see pvp/session.ts), so a 24h claim window outlived
// the evidence by 23+ hours. 2 hours gives players with bad connections,
// background-tab freezes, and mobile-app-switch delays plenty of headroom
// while closing most of the reward-shifting gap.
const SESSION_REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;
// One-shot idempotency gate for the CLIENT-side PvP reward payout.
//
// Server-side Vanguard rewards are already idempotent inside
// _vanguard-rewards.ts (vanguardRewardsGranted flag on the session). This
// endpoint covers the client-applied side: ryo, XP, monthlyPvpKills,
// totalPvpKills, ranked rating, ranked W/L counts, clan-war points, and
// the optional sector-raid damage tick. Without it, a refresh while the
// session is in 'done' state would re-mount PvpBattleScreen, reset the
// in-memory pvpRewardRef, fire the win effect again, and double-apply
// every one of those local grants.
//
// Contract:
//   POST { battleId, playerName, outcome: 'win' | 'loss' }
//   → 200 { ok: true, alreadyClaimed: boolean }
//   The caller MUST skip its local reward grant when alreadyClaimed is true.
//
// Storage: pvp:rewarded:<playerName>:<battleId>  (24h TTL — well past the
// 60-min session TTL, so even a slow re-mount can't slip past.)
const CLAIM_TTL_SECONDS = 24 * 60 * 60;
function claimKey(playerName, battleId) {
    return `pvp:rewarded:${(0, _utils_js_1.safeName)(playerName)}:${battleId}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Tight rate-limit — a legit win path calls this once. Anything beyond
    // a handful per minute is either a bug loop or someone hammering for
    // a race-condition window.
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pvp-claim-rewards', 30, 60_000)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body?.playerName ?? ''));
        const battleId = String(body?.battleId ?? '').trim();
        const outcome = String(body?.outcome ?? '').trim();
        if (!playerName || !battleId) {
            return res.status(400).json({ error: 'Missing playerName or battleId.' });
        }
        if (outcome !== 'win' && outcome !== 'loss') {
            return res.status(400).json({ error: "outcome must be 'win' or 'loss'." });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own rewards.' });
        }
        // Authoritative outcome check — load the actual session and verify
        // that the caller really is the recorded winner/loser. Without this,
        // a malicious client could POST { battleId: '<any-old-id>',
        // outcome: 'win' } and the NX reserve alone would let it pass,
        // unlocking the client-applied ryo / XP / ranked-rating / clan-war
        // grants on the next save flush. Mirrors the verification regime
        // already used by api/missions/report-pvp-win.ts.
        const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
        if (!session)
            return res.status(404).json({ error: 'Battle session not found or expired.' });
        if (session.status !== 'done' || !session.winner) {
            return res.status(409).json({ error: 'Battle not yet decided.' });
        }
        const sessionAge = Date.now() - Number(session.createdAt ?? 0);
        if (sessionAge > SESSION_REPLAY_WINDOW_MS) {
            return res.status(409).json({ error: 'Battle session is too old to claim.' });
        }
        const winnerName = (session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '';
        const loserName = (session.winner === 'p1' ? session.p2.name : session.p1.name) ?? '';
        // winnerName/loserName are stored DISPLAY names (may contain spaces);
        // canonicalize through safeName to compare with the slug `playerName`.
        const expectedSide = outcome === 'win' ? winnerName : loserName;
        if (!identity.admin && (0, _utils_js_1.safeName)(expectedSide) !== playerName) {
            return res.status(403).json({
                error: `Recorded ${outcome === 'win' ? 'winner' : 'loser'} of this battle is not you.`,
            });
        }
        const key = claimKey(playerName, battleId);
        // ── Server-credited paths (audit #7 / Stage 3) ─────────────────────
        // Two server-authoritative credits can apply to a claim:
        //   • RANKED rating (Phase 1) — when the session was stamped ranked at
        //     creation, the SERVER owns the rating change (computed from the
        //     pre-match Elo snapshot + the server-verified winner). Draws skip
        //     (the Elo formula is win/loss only).
        //   • BASE ryo + XP (Phase 3) — when the session was stamped baseRewards
        //     AND this is the WINNER's claim. The amount comes from the verbatim
        //     gainXp port computed on the winner's full save (pet trait + elder
        //     focus + exam gates), with the Death's Gate (sector 99) 2× bonus
        //     keyed off the session's stamped rewardSector. Loser/draw earn none.
        // When either applies we take the save lock ONCE, place the receipt, and
        // apply BOTH credits in a single atomic write keyed by the same NX
        // receipt — a ranked win credits rating + ryo/xp exactly-once, and a
        // contention abort (failClosed → 503) leaves NOTHING placed so a retry
        // credits cleanly without ever double-crediting. A casual,
        // non-baseRewards session keeps the byte-for-byte unchanged NX-only path
        // below, so this is a no-op until a client opts a session into either.
        const isRankedClaim = session.ranked === true &&
            (session.rankedKind === 'player' || session.rankedKind === 'pet') &&
            (session.winner === 'p1' || session.winner === 'p2');
        const creditBase = session.baseRewards === true && outcome === 'win';
        if (isRankedClaim || creditBase) {
            const saveKey = `save:${playerName}`;
            // Ranked params — only consulted when isRankedClaim.
            const kind = session.rankedKind;
            const ratingField = kind === 'pet' ? 'petRankedRating' : 'rankedRating';
            const winnerRating = Number((session.winner === 'p1' ? session.p1Rating : session.p2Rating) ?? 1000);
            const loserRating = Number((session.winner === 'p1' ? session.p2Rating : session.p1Rating) ?? 1000);
            const role = outcome === 'win' ? 'winner' : 'loser';
            try {
                const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                    const placed = await _storage_js_1.kv.set(key, { outcome, ts: Date.now() }, { nx: true, ex: CLAIM_TTL_SECONDS });
                    const already = !placed;
                    const record = await _storage_js_1.kv.get(saveKey);
                    const char = (record?.character ?? null);
                    if (!record || !char)
                        return { already, rating: undefined, base: undefined };
                    let nextChar = { ...char };
                    let rating;
                    let base;
                    if (isRankedClaim) {
                        const r = (0, _ranked_rating_js_1.creditRankedOutcome)(nextChar, { role, winnerRating, loserRating, kind });
                        if (!already)
                            nextChar = { ...nextChar, ...r.patch };
                        // First call → the freshly computed value; re-claim →
                        // the stored value (falling back to computed on garbage).
                        const cur = Number(char[ratingField]);
                        rating = { field: ratingField, value: already ? (Number.isFinite(cur) ? cur : r.newRating) : r.newRating, delta: r.delta };
                    }
                    if (creditBase) {
                        // Gains depend only on pets + the stamped sector, so read
                        // them from the original save; apply gainXp to nextChar so
                        // a ranked rating patch above is preserved.
                        const { xpGain, ryoGain } = (0, _xp_engine_js_1.computePvpWinGains)(char, session.rewardSector);
                        if (!already) {
                            const credit = (0, _xp_engine_js_1.creditPvpWinBase)(nextChar, xpGain, ryoGain);
                            nextChar = credit.char;
                            base = credit.summary;
                        }
                        else {
                            // Already credited on a prior call — report stored values.
                            base = {
                                ryo: Number(char.ryo) || 0,
                                xp: Number(char.xp) || 0,
                                level: Number(char.level) || 0,
                                rankTitle: typeof char.rankTitle === 'string' ? char.rankTitle : '',
                                maxHp: Number(char.maxHp) || 0,
                                maxChakra: Number(char.maxChakra) || 0,
                                maxStamina: Number(char.maxStamina) || 0,
                                unspentStats: Number(char.unspentStats) || 0,
                            };
                        }
                    }
                    if (!already) {
                        await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)({ ...record, character: nextChar }, record));
                    }
                    return { already, rating, base };
                }, { failClosed: true });
                return res.status(200).json({
                    ok: true,
                    alreadyClaimed: out.already,
                    ...(out.rating ? { rating: out.rating } : {}),
                    ...(out.base ? { base: out.base } : {}),
                });
            }
            catch (creditErr) {
                // Lock contention/outage (failClosed) — receipt NOT placed, so
                // the client can safely retry. 503 signals "transient, retry".
                console.error('[pvp/claim-rewards] server credit failed', creditErr);
                return res.status(503).json({ error: 'Could not record battle result — please retry.' });
            }
        }
        // ── Casual path (unchanged) ─────────────────────────────────────────
        // Atomic NX reserve. If the key already exists, we lost the race
        // (or a duplicate call) — return alreadyClaimed so the caller
        // skips the local grant entirely.
        //
        // Fail-open is scoped to JUST this reserve step (audit #7): if the
        // NX write throws because KV is briefly down, we still let the
        // legitimate, already-verified winner pay out (one possible duplicate
        // during an outage beats denying a real winner). The outer try/catch
        // used to swallow EVERYTHING — including auth/session-verification
        // failures above — into a misleading ok:true. Those now fall through
        // to the outer catch and surface as a real 500, so a broken request
        // can't masquerade as a successful claim.
        let alreadyClaimed = false;
        try {
            const placed = await _storage_js_1.kv.set(key, { outcome, ts: Date.now() }, { nx: true, ex: CLAIM_TTL_SECONDS });
            alreadyClaimed = !placed;
            return res.status(200).json({ ok: true, alreadyClaimed });
        }
        catch (reserveErr) {
            console.error('[pvp/claim-rewards] reserve failed (fail-open)', reserveErr);
            return res.status(200).json({ ok: true, alreadyClaimed: false, degraded: true });
        }
    }
    catch (err) {
        console.error('[pvp/claim-rewards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
