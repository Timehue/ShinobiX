"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const _kage_challenge_js_1 = require("./_kage-challenge.js");
/*
 * /api/village/kage-challenge — POST only
 *
 * Server-authoritative Kage succession. Replaces the old client-side challenge
 * theater (votes + a 23:00–03:00 UTC window that could never resolve) with a
 * real, async, online-only contest. See _kage-challenge.ts for the model + rules.
 *
 * Actions (body.action):
 *   - declare : a gated villager stakes 500 Honor Seals to open a challenge.
 *   - press   : the challenger pings to burn the Kage's "accept obligation",
 *               but ONLY while BOTH are verifiably online (live presence). The
 *               Kage can't dodge by hiding; an AFK challenger can't steal the seat.
 *   - accept  : the seated Kage agrees to duel — halts the forfeit clock.
 *   - resolve : either fighter submits the duel's battleId; the seat transfers
 *               (challenger won) or is defended (Kage won), cross-checked against
 *               the real PvpSession — the client can't fake the outcome.
 *
 * All seat-bearing mutations run under withKvLock(village:kage:<slug>) with
 * { failClosed: true }. The 500-seal debit nests the challenger's save lock
 * inside (kage-outer / save-inner — no other path takes them the other way).
 */
const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUDIT_PREFIX = 'audit:kage-challenge:';
function kageKey(village) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
function villageStateKey(village) {
    return `game:village-state:${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function isOnline(name) {
    return !!name && !!online_store_js_1.onlineStore.get(name);
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
        const key = kageKey(village);
        const now = Date.now();
        // ── DECLARE ──────────────────────────────────────────────────────────
        if (action === 'declare') {
            const save = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (save?.character ?? null);
            if (!char)
                return res.status(404).json({ error: 'Your save was not found.' });
            const vState = await _storage_js_1.kv.get(villageStateKey(village));
            const contribution = num(vState?.contributionPoints);
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
                    villageContribution: contribution,
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
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)({ ...rec, character: nextChar }, rec));
                    return { ok: true };
                }, { failClosed: true });
                if (!debit.ok)
                    return { status: 400, body: { error: `Challenging costs ${_kage_challenge_js_1.KAGE_DECLARE_SEAL_COST} Honor Seals.` } };
                const next = { ...state, challenge: (0, _kage_challenge_js_1.newChallenge)(challengerName, now) };
                await _storage_js_1.kv.set(key, next);
                return { status: 200, body: { ok: true, challenge: next.challenge } };
            }, { failClosed: true });
            if (out.status === 200)
                await audit(village, { action: 'declare', challenger: challengerName });
            return res.status(out.status).json(out.body);
        }
        // ── PRESS (burn the accept obligation during verified overlap) ────────
        if (action === 'press') {
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
                const bothOnline = isOnline(state.seatedKage) && isOnline(challenge.challenger);
                const pressed = (0, _kage_challenge_js_1.applyPress)(challenge, now, bothOnline);
                if (pressed.forfeited) {
                    const next = (0, _kage_challenge_js_1.applySeatTransfer)(state, challenge.challenger);
                    await _storage_js_1.kv.set(key, next);
                    return { status: 200, body: { ok: true, forfeited: true, seatedKage: next.seatedKage }, forfeitTo: challenge.challenger };
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
            const out = await (0, _lock_js_1.withKvLock)(key, async () => {
                let state = (await _storage_js_1.kv.get(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && (0, _kage_challenge_js_1.isChallengeExpired)(state.challenge, now)) {
                    state = (0, _kage_challenge_js_1.applyExpiry)(state, now);
                    await _storage_js_1.kv.set(key, state);
                }
                const challenge = state.challenge;
                if (!challenge)
                    return { status: 404, body: { error: 'There is no active challenge to accept.' } };
                if ((0, _utils_js_1.safeName)(state.seatedKage ?? '') !== playerName && !identity.admin) {
                    return { status: 403, body: { error: 'Only the seated Kage can accept a challenge.' } };
                }
                const next = { ...state, challenge: { ...challenge, status: 'accepted', battleId: battleId || challenge.battleId } };
                await _storage_js_1.kv.set(key, next);
                return { status: 200, body: { ok: true, challenge: next.challenge } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── RESOLVE (settle the duel against the real PvpSession) ─────────────
        if (action === 'resolve') {
            if (!battleId)
                return res.status(400).json({ error: 'Missing battleId.' });
            const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
            if (!session)
                return res.status(404).json({ error: 'Battle session not found or expired.' });
            if (session.status !== 'done' || !session.winner || session.winner === 'draw') {
                return res.status(409).json({ error: 'That duel is not decided yet.' });
            }
            if (now - num(session.createdAt) > SESSION_REPLAY_WINDOW_MS) {
                return res.status(409).json({ error: 'That duel is too old to settle the seat.' });
            }
            const winnerName = session.winner === 'p1' ? session.p1.name : session.p2.name;
            const loserName = session.winner === 'p1' ? session.p2.name : session.p1.name;
            const out = await (0, _lock_js_1.withKvLock)(key, async () => {
                let state = (await _storage_js_1.kv.get(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && (0, _kage_challenge_js_1.isChallengeExpired)(state.challenge, now)) {
                    state = (0, _kage_challenge_js_1.applyExpiry)(state, now);
                    await _storage_js_1.kv.set(key, state);
                }
                const challenge = state.challenge;
                if (!challenge)
                    return { status: 409, body: { error: 'There is no active challenge to settle.' } };
                const seat = (0, _utils_js_1.safeName)(state.seatedKage ?? '');
                const challenger = (0, _utils_js_1.safeName)(challenge.challenger);
                const fighters = new Set([(0, _utils_js_1.safeName)(session.p1.name), (0, _utils_js_1.safeName)(session.p2.name)]);
                if (!fighters.has(seat) || !fighters.has(challenger)) {
                    return { status: 400, body: { error: 'That duel was not this Kage challenge.' } };
                }
                // Caller must be one of the two fighters.
                if (!identity.admin && playerName !== seat && playerName !== challenger) {
                    return { status: 403, body: { error: 'Only a participant can settle this challenge.' } };
                }
                const winner = (0, _utils_js_1.safeName)(winnerName);
                const loser = (0, _utils_js_1.safeName)(loserName);
                if (winner === challenger && loser === seat) {
                    const next = (0, _kage_challenge_js_1.applySeatTransfer)(state, challenge.challenger);
                    await _storage_js_1.kv.set(key, next);
                    return { status: 200, body: { ok: true, seatedKage: next.seatedKage, result: 'transferred' }, transferTo: challenge.challenger };
                }
                if (winner === seat && loser === challenger) {
                    const next = (0, _kage_challenge_js_1.applyDefense)(state, challenge.challenger, now);
                    await _storage_js_1.kv.set(key, next);
                    return { status: 200, body: { ok: true, seatedKage: next.seatedKage, result: 'defended' }, defended: true };
                }
                return { status: 400, body: { error: 'That duel result does not match this challenge.' } };
            }, { failClosed: true });
            if (out.transferTo)
                await audit(village, { action: 'duel-transfer', newKage: out.transferTo, battleId });
            else if (out.defended)
                await audit(village, { action: 'duel-defended', battleId });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        console.error('[village/kage-challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
