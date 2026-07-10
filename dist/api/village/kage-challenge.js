"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _presence_beat_js_1 = require("../_realtime/_presence-beat.js");
const _kage_challenge_js_1 = require("./_kage-challenge.js");
const _kage_settle_js_1 = require("./_kage-settle.js");
/*
 * /api/village/kage-challenge — POST only
 *
 * Server-authoritative Kage succession. Replaces the old client-side challenge
 * theater (votes + a 23:00–03:00 UTC window that could never resolve) with a
 * real, async, online-only contest. See _kage-challenge.ts for the model + rules.
 *
 * Actions (body.action):
 *   - declare : a gated villager stakes 500 Honor Seals to open a challenge.
 *               Eligibility now requires PERSONAL Village Merit (char.villageMerit),
 *               not the shared village contribution pool.
 *   - press   : the challenger pings to burn the Kage's "accept obligation",
 *               but ONLY while BOTH are verifiably online (live presence). The
 *               Kage can't dodge by hiding; an AFK challenger can't steal the seat.
 *   - accept  : the seated Kage agrees to duel — halts the forfeit clock, seals
 *               the official duel's battleId, and writes the `kage-duel:<battleId>`
 *               pointer so PvP completion can auto-settle the seat.
 *   - resolve : either fighter (or the auto path in api/pvp/move.ts) settles the
 *               duel against the real PvpSession — the client can't fake the outcome.
 *
 * All seat-bearing mutations run under withKvLock(village:kage:<slug>) with
 * { failClosed: true }. The 500-seal debit nests the challenger's save lock
 * inside (kage-outer / save-inner — no other path takes them the other way).
 */
const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUDIT_PREFIX = 'audit:kage-challenge:';
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
async function audit(village, entry) {
    await _storage_js_1.kv.set(`${AUDIT_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}:${Date.now()}`, { ts: Date.now(), ...entry }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const battleId = typeof body.battleId === 'string' ? body.battleId.trim() : '';
        if (!village || !playerName)
            return res.status(400).json({ error: 'Missing village or playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `kage-challenge-${action}`, action === 'press' ? 12 : 6, 60_000, identity.name)))
            return;
        const key = (0, _kage_settle_js_1.kageKey)(village);
        const now = Date.now();
        // Self-heal: finish any stuck auto-settle (immediate settle threw at
        // duel-finish) from the durable record before acting. Idempotent + cheap.
        await (0, _kage_settle_js_1.reconcilePendingKageSettle)(village, now).catch(() => undefined);
        // ── DECLARE ──────────────────────────────────────────────────────────
        if (action === 'declare') {
            const save = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (save?.character ?? null);
            if (!char)
                return res.status(404).json({ error: 'Your save was not found.' });
            const challengerName = String(char.name ?? playerName);
            const out = await (0, _lock_js_1.withKvLock)(key, async () => {
                let state = (await _storage_js_1.kv.get(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && (0, _kage_challenge_js_1.isChallengeExpired)(state.challenge, now))
                    state = (0, _kage_challenge_js_1.applyExpiry)(state, now);
                const elig = (0, _kage_challenge_js_1.canDeclareChallenge)({
                    now, state, challengerName,
                    challengerLevel: num(char.level),
                    challengerSeals: num(char.honorSeals),
                    challengerAccountCreatedAt: num(char.createdAt),
                    challengerMerit: num(char.villageMerit),
                    isMember: identity.admin || String(char.village ?? '').trim() === village,
                });
                if (!elig.ok)
                    return { status: 403, body: { error: elig.reason } };
                // Stake the 500 seals (debit the challenger's save) BEFORE opening
                // the challenge — committed first, like the treasury-donate pattern.
                const debit = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                    const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                    const c = (rec?.character ?? null);
                    if (!rec || !c)
                        return { ok: false };
                    if (num(c.honorSeals) < _kage_challenge_js_1.KAGE_DECLARE_SEAL_COST)
                        return { ok: false };
                    const nextChar = { ...c, honorSeals: num(c.honorSeals) - _kage_challenge_js_1.KAGE_DECLARE_SEAL_COST };
                    const nextRec = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: nextChar });
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)(nextRec, rec));
                    return { ok: true };
                }, { failClosed: true });
                if (!debit.ok)
                    return { status: 400, body: { error: `Challenging costs ${_kage_challenge_js_1.KAGE_DECLARE_SEAL_COST} Honor Seals.` } };
                const next = { ...state, challenge: (0, _kage_challenge_js_1.newChallenge)(challengerName, now, (0, node_crypto_1.randomUUID)()) };
                await _storage_js_1.kv.set(key, next);
                return { status: 200, body: { ok: true, challenge: next.challenge } };
            }, { failClosed: true });
            if (out.status === 200)
                await audit(village, { action: 'declare', challenger: challengerName });
            return res.status(out.status).json(out.body);
        }
        // ── PRESS (burn the accept obligation during verified overlap) ────────
        if (action === 'press') {
            // The presser proves their own liveness by making this authenticated
            // request (the client only presses on a visible tab); stamp their beat.
            (0, _presence_beat_js_1.stampPresenceBeat)(playerName);
            const out = await (0, _lock_js_1.withKvLock)(key, async () => {
                let state = (await _storage_js_1.kv.get(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && (0, _kage_challenge_js_1.isChallengeExpired)(state.challenge, now)) {
                    state = (0, _kage_challenge_js_1.applyExpiry)(state, now);
                    await _storage_js_1.kv.set(key, state);
                    return { status: 200, body: { ok: true, expired: true, challenge: null } };
                }
                const challenge = state.challenge;
                if (!challenge || challenge.status !== 'pending')
                    return { status: 200, body: { ok: true, challenge: challenge ?? null } };
                // Only the challenger drives their own clock.
                if ((0, _utils_js_1.safeName)(challenge.challenger) !== playerName && !identity.admin) {
                    return { status: 403, body: { error: 'Only the challenger can press a Kage challenge.' } };
                }
                // "Both online" is verified cross-worker (in-memory store + durable
                // presence beat). The challenger who is pressing is provably online
                // by virtue of this request; the seated Kage is checked for real.
                const challengerOnline = playerName === (0, _utils_js_1.safeName)(challenge.challenger) || await (0, _presence_beat_js_1.isPlayerOnline)(challenge.challenger);
                const bothOnline = (await (0, _presence_beat_js_1.isPlayerOnline)(state.seatedKage)) && challengerOnline;
                const pressed = (0, _kage_challenge_js_1.applyPress)(challenge, now, bothOnline);
                if (pressed.forfeited) {
                    const nextState = (0, _kage_challenge_js_1.applySeatTransfer)(state, challenge.challenger, village, now, 'forfeit');
                    await _storage_js_1.kv.set(key, nextState);
                    return { status: 200, body: { ok: true, forfeited: true, seatedKage: nextState.seatedKage }, forfeitTo: challenge.challenger };
                }
                await _storage_js_1.kv.set(key, { ...state, challenge: pressed.challenge });
                return { status: 200, body: { ok: true, obligationRemainingMs: pressed.challenge.obligationRemainingMs, bothOnline } };
            }, { failClosed: true });
            if (out.forfeitTo)
                await audit(village, { action: 'forfeit', newKage: out.forfeitTo });
            return res.status(out.status).json(out.body);
        }
        // ── ACCEPT (Kage agrees to duel — halts the forfeit clock) ────────────
        if (action === 'accept') {
            if (!battleId)
                return res.status(400).json({ error: 'Missing battleId — accept the official duel to defend, not the challenge directly.' });
            // Load the claimed duel BEFORE sealing (see resolveAcceptDecision): a
            // bogus battleId would otherwise freeze the forfeit clock forever. The
            // duel must be a live session fought by exactly {seated Kage, challenger}
            // (an abandoned real duel is handled by PvP's own AFK-claim, which
            // completes the session and auto-settles the seat).
            const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
            const sessionFighters = session ? [(0, _utils_js_1.safeName)(session.p1.name), (0, _utils_js_1.safeName)(session.p2.name)] : null;
            const out = await (0, _lock_js_1.withKvLock)(key, async () => {
                let state = (await _storage_js_1.kv.get(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && (0, _kage_challenge_js_1.isChallengeExpired)(state.challenge, now)) {
                    state = (0, _kage_challenge_js_1.applyExpiry)(state, now);
                    await _storage_js_1.kv.set(key, state);
                }
                const challenge = state.challenge;
                const decision = (0, _kage_challenge_js_1.resolveAcceptDecision)({
                    challenge,
                    seatNorm: (0, _utils_js_1.safeName)(state.seatedKage ?? ''),
                    challengerNorm: (0, _utils_js_1.safeName)(challenge?.challenger ?? ''),
                    callerNorm: playerName,
                    isAdmin: identity.admin,
                    battleId,
                    sessionFighters,
                });
                if (decision.kind === 'reject')
                    return { status: decision.status, body: { error: decision.error } };
                if (decision.kind === 'idempotent') {
                    return { status: 200, body: { ok: true, challenge }, sealBattleId: battleId, challengeId: challenge.challengeId };
                }
                const next = { ...state, challenge: { ...challenge, status: 'accepted', battleId } };
                await _storage_js_1.kv.set(key, next);
                return { status: 200, body: { ok: true, challenge: next.challenge }, sealBattleId: battleId, challengeId: challenge.challengeId };
            }, { failClosed: true });
            // Point the official duel back at this village/challenge so PvP
            // completion (api/pvp/move.ts) can auto-settle the seat. Written
            // SERVER-side (not client-trusted); TTL matches the replay window.
            if (out.status === 200 && out.sealBattleId) {
                await _storage_js_1.kv.set((0, _kage_settle_js_1.kageDuelKey)(out.sealBattleId), { village, challengeId: out.challengeId }, { ex: Math.floor(SESSION_REPLAY_WINDOW_MS / 1000) }).catch(() => undefined);
                await audit(village, { action: 'accept', battleId: out.sealBattleId });
            }
            return res.status(out.status).json(out.body);
        }
        // ── RESOLVE (settle the duel against the real PvpSession) ─────────────
        // Manual backup for the auto-settle in api/pvp/move.ts. Same shared
        // helper, so behavior is identical; the caller must be a participant.
        if (action === 'resolve') {
            if (!battleId)
                return res.status(400).json({ error: 'Missing battleId.' });
            const outcome = await (0, _kage_settle_js_1.settleKageDuel)(village, battleId, now, { callerName: playerName, isAdmin: identity.admin });
            if (!outcome.ok)
                return res.status(outcome.status).json({ error: outcome.error });
            if (outcome.result === 'transferred')
                await audit(village, { action: 'duel-transfer', newKage: outcome.newKage, battleId });
            else
                await audit(village, { action: 'duel-defended', battleId });
            return res.status(200).json({ ok: true, seatedKage: outcome.seatedKage, result: outcome.result });
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        console.error('[village/kage-challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
