"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _storage_js_2 = require("./_storage.js");
// For PvP-mode challenges (mode includes a battleId), cross-check the
// reported result against the authoritative PvpSession. Returns null when
// the session validates the report, or an error tuple to short-circuit.
//
// Pet-mode challenges don't have a session to validate against — those rely
// entirely on the existing two-phase opposite-side-confirmation defense.
async function validateAgainstPvpSession(ch, result) {
    if (!ch.battleId)
        return null;
    const session = await _storage_js_1.kv.get(`pvp:${ch.battleId}`);
    if (!session) {
        // Session may have expired (24h TTL on pvp:* keys). Fall back to
        // the two-phase reporting defense rather than blocking the report.
        return null;
    }
    if (session.status !== 'done' || !session.winner) {
        return { status: 409, body: { error: 'Battle session not yet decided — wait for the fight to finish before reporting.' } };
    }
    // Map the session winner back to challenge sides. fromPlayer / fromPlayer2
    // are on the "from" side; the rest are on the "to" side.
    const winnerName = session.winner === 'p1' ? session.p1.name : session.p2.name;
    const winnerLower = (winnerName ?? '').toLowerCase();
    const fromNames = [ch.fromPlayer, ch.fromPlayer2].filter(Boolean).map((n) => (n ?? '').toLowerCase());
    const winnerOnFromSide = fromNames.includes(winnerLower);
    const expected = winnerOnFromSide ? 'from-wins' : 'to-wins';
    if (result !== expected) {
        return { status: 409, body: { error: `Reported result disagrees with the PvP session. The session recorded ${expected}.` } };
    }
    return null;
}
// POST /api/clan/war/report
// Body: { warId, challengeId, result: 'from-wins' | 'to-wins' | 'draw' }
//
// Two-phase reporting to defeat the single-side fake-win exploit:
//   1. First reporter ("tentative"): server stamps tentativeResult /
//      tentativeBy / tentativeAt on the challenge. No damage applied
//      yet. The challenge stays in pendingChallenges with status
//      'accepted' so participants on the other side can see it and
//      respond. The response carries warEnded=false, tentative=true.
//   2. Second reporter MUST be on the opposite side (i.e. one of the
//      two from-side players reported first → confirm/dispute must
//      come from a to-side player, and vice versa).
//        - If results match → confirm; apply damage, finalize.
//        - If results differ → mark as 'draw'; no damage. (We treat
//          disputes as draws so a malicious actor can't deny rewards
//          either.)
//   3. Auto-confirm: lazy expiry promotes tentative → final after
//      REPORT_AUTO_CONFIRM_MS (15 min). This handles cases where the
//      losing side ghosts. (Future: implemented in a follow-up tick.)
//
// Participant gating: only one of the 2 (or 4 for 2v2) named
// participants on the challenge can submit a result. Admin bypasses.
function isParticipant(playerName, ch) {
    const n = playerName.toLowerCase();
    if ((ch.fromPlayer ?? '').toLowerCase() === n)
        return true;
    if ((ch.fromPlayer2 ?? '').toLowerCase() === n)
        return true;
    if ((ch.acceptedPlayer ?? '').toLowerCase() === n)
        return true;
    if ((ch.acceptedPlayer2 ?? '').toLowerCase() === n)
        return true;
    return false;
}
function playerOnFromSide(playerName, ch) {
    const n = playerName.toLowerCase();
    return (ch.fromPlayer ?? '').toLowerCase() === n
        || (ch.fromPlayer2 ?? '').toLowerCase() === n;
}
// applyFinalResult moved to _storage.ts so the tilecards endpoint
// can share the same HP/MVP/cooldown logic.
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-war-report', 30, 60_000, identity.name)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const warId = String(body?.warId ?? '').trim();
        const challengeId = String(body?.challengeId ?? '').trim();
        const result = String(body?.result ?? '');
        if (!warId || !challengeId)
            return res.status(400).json({ error: 'Missing warId or challengeId.' });
        if (result !== 'from-wins' && result !== 'to-wins' && result !== 'draw') {
            return res.status(400).json({ error: "Invalid result; must be 'from-wins' | 'to-wins' | 'draw'." });
        }
        const key = `clan-war:${warId}`;
        const lockResult = await (0, _lock_js_1.withKvLock)(key, async () => {
            const fresh = await _storage_js_1.kv.get(key);
            if (!fresh)
                return { status: 404, body: { error: 'War not found.' } };
            const expiry = (0, _storage_js_2.applyLazyClanWarExpiry)(fresh);
            let war = expiry.war;
            if (war.endedAt) {
                if (expiry.changed) {
                    await _storage_js_1.kv.set(key, war);
                    if (expiry.needsCooldownStamp) {
                        await _storage_js_1.kv.set((0, _storage_js_2.clanWarCooldownKey)(war.clans[0], war.clans[1]), war.endedAt, { ex: _storage_js_2.CLAN_WAR_REMATCH_COOLDOWN_SEC });
                    }
                }
                return { status: 409, body: { error: 'War has already ended.' } };
            }
            const ch = war.pendingChallenges.find(c => c.id === challengeId);
            if (!ch)
                return { status: 404, body: { error: 'Challenge not found or already completed.' } };
            if (ch.status !== 'accepted')
                return { status: 409, body: { error: 'Challenge has not been accepted yet.' } };
            // Participant check (admin bypasses for both phases).
            if (!identity.admin && !isParticipant(identity.name, ch)) {
                return { status: 403, body: { error: 'Only a participant can report this result.' } };
            }
            // PvP-session cross-check (non-admin only). For challenges that
            // produced a server-side PvP battle, refuse reports that
            // disagree with the authoritative session winner. This blocks
            // colluding-pair / sock-puppet fake wins. Pet modes (no
            // battleId) skip this and rely on two-phase reporting alone.
            if (!identity.admin && result !== 'draw') {
                const sessionError = await validateAgainstPvpSession(ch, result);
                if (sessionError)
                    return sessionError;
            }
            const now = Date.now();
            // Admin: skip two-phase entirely, finalize immediately.
            if (identity.admin) {
                const { war: nextWar, completed, warJustEnded } = (0, _storage_js_2.applyFinalResult)(war, ch, result, now);
                war = nextWar;
                if (warJustEnded) {
                    await _storage_js_1.kv.set((0, _storage_js_2.clanWarCooldownKey)(war.clans[0], war.clans[1]), now, { ex: _storage_js_2.CLAN_WAR_REMATCH_COOLDOWN_SEC });
                }
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: completed, warEnded: warJustEnded, tentative: false } };
            }
            const reporterOnFromSide = playerOnFromSide(identity.name, ch);
            // ── Phase 0: stale tentative → auto-confirm ──────────────
            // If a tentative has been sitting for ≥ REPORT_AUTO_CONFIRM_MS
            // and the opposing side never responded, ANY participant
            // calling /api/clan/war/report finalizes the tentative as
            // submitted (the report body's `result` is ignored — the
            // first reporter's call wins).
            if (ch.tentativeResult && (0, _storage_js_2.isTentativeAutoConfirmable)(ch, now)) {
                const { war: nextWar, completed, warJustEnded } = (0, _storage_js_2.applyFinalResult)(war, ch, ch.tentativeResult, now);
                war = nextWar;
                if (warJustEnded) {
                    await _storage_js_1.kv.set((0, _storage_js_2.clanWarCooldownKey)(war.clans[0], war.clans[1]), now, { ex: _storage_js_2.CLAN_WAR_REMATCH_COOLDOWN_SEC });
                }
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: completed, warEnded: warJustEnded, tentative: false, autoConfirmed: true } };
            }
            // ── Phase 1: no tentative yet → stamp one ────────────────
            if (!ch.tentativeResult) {
                const updated = {
                    ...ch,
                    tentativeResult: result,
                    tentativeBy: identity.name,
                    tentativeAt: now,
                };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: updated, warEnded: false, tentative: true } };
            }
            // ── Phase 2: a tentative exists; only the OTHER side may confirm/dispute ──
            const tentativeReporterOnFromSide = playerOnFromSide(ch.tentativeBy ?? '', ch);
            const samePlayer = (ch.tentativeBy ?? '').toLowerCase() === identity.name.toLowerCase();
            if (samePlayer) {
                return { status: 409, body: { error: 'You already submitted a tentative result. Wait for the opposing side to confirm or dispute.' } };
            }
            if (reporterOnFromSide === tentativeReporterOnFromSide) {
                return { status: 409, body: { error: 'Waiting on the opposing side to confirm or dispute the tentative result.' } };
            }
            // Match → finalize as the tentative result.
            // Mismatch → finalize as 'draw' (disputed results award nothing).
            const finalResult = (ch.tentativeResult === result) ? ch.tentativeResult : 'draw';
            const { war: nextWar, completed, warJustEnded } = (0, _storage_js_2.applyFinalResult)(war, ch, finalResult, now);
            war = nextWar;
            if (warJustEnded) {
                await _storage_js_1.kv.set((0, _storage_js_2.clanWarCooldownKey)(war.clans[0], war.clans[1]), now, { ex: _storage_js_2.CLAN_WAR_REMATCH_COOLDOWN_SEC });
            }
            await _storage_js_1.kv.set(key, war);
            return { status: 200, body: { war, challenge: completed, warEnded: warJustEnded, tentative: false, disputed: finalResult === 'draw' && ch.tentativeResult !== result } };
        });
        return res.status(lockResult.status).json(lockResult.body);
    }
    catch (err) {
        console.error('[clan/war/report]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
