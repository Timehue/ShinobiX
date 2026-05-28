"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _storage_js_2 = require("./_storage.js");
// POST /api/clan/war/challenge
// Body shapes:
//   { action: 'send',         warId, mode }          — 1v1 creates 'pending'; 2v2 creates 'queuing'
//   { action: 'join-send',    warId, challengeId }   — 2v2 only: 2nd challenger joins → flips to 'pending'
//   { action: 'leave-send',   warId, challengeId }   — 2v2 only: leave the send queue
//   { action: 'accept',       warId, challengeId }   — 1v1 → 'accepted'; 2v2 → adds 1st defender, stays 'pending'
//   { action: 'join-accept',  warId, challengeId }   — 2v2 only: 2nd defender joins → flips to 'accepted'
//   { action: 'leave-accept', warId, challengeId }   — 2v2 only: leave the accept queue
//   { action: 'decline',      warId, challengeId }   — defender clan refuses entire challenge
//   { action: 'cancel',       warId, challengeId }   — sender clan pulls the challenge
//
// Queue rules (2v2):
//   • Send queue: fromPlayer is the seed challenger (status='queuing').
//     A second clanmate calls join-send → fromPlayer2 set, status → 'pending'.
//     The defender clan only sees challenges with status 'pending'.
//   • Accept queue: defender 1 calls accept → acceptedPlayer set, status stays 'pending'.
//     Defender 2 calls join-accept → acceptedPlayer2 set, status → 'accepted'.
//   • Anyone in either queue may leave at any time (leave-send / leave-accept).
//     Leaving as the only queue member effectively cancels the queue slot
//     (challenge cancelled if seed challenger leaves; accept queue reset if
//     only defender leaves).
const VALID_MODES = new Set(['pvp1v1', 'pvp2v2', 'pet1v1', 'pet2v2', 'tilecards']);
const TWO_V_TWO = new Set(['pvp2v2', 'pet2v2']);
function eq(a, b) {
    return (a ?? '').toLowerCase() === b.toLowerCase();
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    // 30 challenge ops/min/player is plenty — UI doesn't fire faster
    // than a click rate and prevents script abuse spamming the queue.
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-war-challenge', 30, 60_000, identity.name)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const action = String(body?.action ?? '').toLowerCase();
        const warId = String(body?.warId ?? '').trim();
        if (!warId)
            return res.status(400).json({ error: 'Missing warId.' });
        const key = `clan-war:${warId}`;
        const ctx = await (0, _storage_js_2.loadClanContext)(identity.admin ? '' : identity.name);
        const result = await (0, _lock_js_1.withKvLock)(key, async () => {
            const fresh = await _storage_js_1.kv.get(key);
            if (!fresh)
                return { status: 404, body: { error: 'War not found.' } };
            const { war: war0, changed: didExpire, needsCooldownStamp } = (0, _storage_js_2.applyLazyClanWarExpiry)(fresh);
            let war = war0;
            if (war.endedAt) {
                if (didExpire) {
                    await _storage_js_1.kv.set(key, war);
                    // If the war just auto-finalized via 14-day timeout,
                    // stamp the rematch cooldown so parity holds with
                    // HP-driven war-end in report.ts.
                    if (needsCooldownStamp) {
                        await _storage_js_1.kv.set((0, _storage_js_2.clanWarCooldownKey)(war.clans[0], war.clans[1]), war.endedAt, { ex: _storage_js_2.CLAN_WAR_REMATCH_COOLDOWN_SEC });
                    }
                }
                return { status: 409, body: { error: 'War has ended.', war } };
            }
            // ── send ──────────────────────────────────────────────────
            if (action === 'send') {
                const mode = String(body?.mode ?? '');
                if (!VALID_MODES.has(mode))
                    return { status: 400, body: { error: 'Invalid mode.' } };
                if (!identity.admin && !ctx.clan)
                    return { status: 403, body: { error: 'You must be in a clan.' } };
                const fromClan = identity.admin ? String(body?.fromClan ?? '') : ctx.clan;
                if (!war.clans.includes(fromClan))
                    return { status: 403, body: { error: 'Your clan is not in this war.' } };
                const myActiveFromClan = war.pendingChallenges.filter(c => c.fromClan === fromClan && (c.status === 'pending' || c.status === 'queuing')).length;
                if (myActiveFromClan >= 10) {
                    return { status: 429, body: { error: 'Too many active challenges from your clan. Wait for some to resolve.' } };
                }
                if (war.pendingChallenges.length >= _storage_js_2.MAX_PENDING_CHALLENGES) {
                    return { status: 429, body: { error: 'Challenge queue is full. Wait for some to resolve.' } };
                }
                const isTwoV = TWO_V_TWO.has(mode);
                const fromPlayer = identity.admin ? String(body?.fromPlayer ?? '') : ctx.name;
                // Per-player cap: count in-flight challenges (pending or
                // queuing) where this player sits in EITHER challenger
                // slot. Stops a single player from carpet-bombing the
                // defender. 2v2 partners count too — joining a partner's
                // queue eats one of your slots.
                if (!identity.admin) {
                    const myInFlight = war.pendingChallenges.filter(c => {
                        if (c.status !== 'pending' && c.status !== 'queuing')
                            return false;
                        return (c.fromPlayer ?? '').toLowerCase() === fromPlayer.toLowerCase()
                            || (c.fromPlayer2 ?? '').toLowerCase() === fromPlayer.toLowerCase();
                    }).length;
                    if (myInFlight >= _storage_js_2.MAX_PENDING_PER_PLAYER) {
                        return { status: 429, body: { error: `You already have ${_storage_js_2.MAX_PENDING_PER_PLAYER} active challenges. Wait for them to resolve, cancel one, or expire.` } };
                    }
                }
                const now = Date.now();
                const challenge = {
                    id: `ch-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    mode,
                    fromClan,
                    fromPlayer,
                    fromPlayer2: undefined,
                    createdAt: now,
                    // 2v2 modes start in the 'queuing' state until a partner joins.
                    status: isTwoV ? 'queuing' : 'pending',
                    expiresAt: now + _storage_js_2.CHALLENGE_EXPIRY_MS,
                    // Pet modes use a deterministic seed shared between both
                    // clients' simulations (matches the existing pet PvP flow).
                    petBattleSeed: (mode === 'pet1v1' || mode === 'pet2v2') ? now + Math.floor(Math.random() * 100000) : undefined,
                };
                war = {
                    ...war,
                    pendingChallenges: [...war.pendingChallenges, challenge],
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge } };
            }
            // ── join-send (2v2 second challenger) ─────────────────────
            if (action === 'join-send') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch)
                    return { status: 404, body: { error: 'Challenge not found.' } };
                if (!TWO_V_TWO.has(ch.mode))
                    return { status: 400, body: { error: 'Only 2v2 challenges have a send queue.' } };
                if (ch.status !== 'queuing')
                    return { status: 409, body: { error: 'Send queue is already full.' } };
                if (!identity.admin && ctx.clan !== ch.fromClan) {
                    return { status: 403, body: { error: 'Only the sending clan can join this queue.' } };
                }
                const joiner = identity.admin ? String(body?.fromPlayer2 ?? '') : ctx.name;
                if (!joiner)
                    return { status: 400, body: { error: 'Missing player name.' } };
                if (eq(ch.fromPlayer, joiner))
                    return { status: 400, body: { error: 'You are already the seed challenger.' } };
                // Per-player cap also applies to joining a partner's
                // queue — keeps the slot count honest across both
                // challenger paths.
                if (!identity.admin) {
                    const myInFlight = war.pendingChallenges.filter(c => {
                        if (c.id === ch.id)
                            return false;
                        if (c.status !== 'pending' && c.status !== 'queuing')
                            return false;
                        return (c.fromPlayer ?? '').toLowerCase() === joiner.toLowerCase()
                            || (c.fromPlayer2 ?? '').toLowerCase() === joiner.toLowerCase();
                    }).length;
                    if (myInFlight >= _storage_js_2.MAX_PENDING_PER_PLAYER) {
                        return { status: 429, body: { error: `You already have ${_storage_js_2.MAX_PENDING_PER_PLAYER} active challenges. Wait for them to resolve, cancel one, or expire.` } };
                    }
                }
                const now = Date.now();
                const updated = { ...ch, fromPlayer2: joiner, status: 'pending' };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: updated } };
            }
            // ── leave-send (2v2 challenger leaves the queue) ──────────
            if (action === 'leave-send') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch)
                    return { status: 404, body: { error: 'Challenge not found.' } };
                if (!TWO_V_TWO.has(ch.mode))
                    return { status: 400, body: { error: 'Only 2v2 challenges have a send queue.' } };
                if (ch.status !== 'queuing' && ch.status !== 'pending') {
                    return { status: 409, body: { error: 'Challenge is no longer in the send queue.' } };
                }
                if (!identity.admin && ctx.clan !== ch.fromClan) {
                    return { status: 403, body: { error: 'Only the sending clan can leave this queue.' } };
                }
                const me = identity.admin ? String(body?.player ?? '') : ctx.name;
                const isSeed = eq(ch.fromPlayer, me);
                const isPartner = eq(ch.fromPlayer2, me);
                if (!isSeed && !isPartner)
                    return { status: 403, body: { error: 'You are not in this send queue.' } };
                const now = Date.now();
                // If the partner leaves: drop fromPlayer2, revert to 'queuing'.
                // If the seed leaves with a partner present: promote partner → seed, revert to 'queuing'.
                // If the seed leaves alone: cancel the entire challenge.
                //
                // When status regresses to 'queuing' the challenge becomes
                // hidden from the defender clan, so any defenders queued
                // for accept get stranded. Clear the accept queue so they
                // re-queue if a new partner joins — no invisible state.
                if (isPartner) {
                    const updated = {
                        ...ch,
                        fromPlayer2: undefined,
                        status: 'queuing',
                        acceptedPlayer: undefined,
                        acceptedPlayer2: undefined,
                    };
                    war = {
                        ...war,
                        pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                        updatedAt: now,
                    };
                    await _storage_js_1.kv.set(key, war);
                    return { status: 200, body: { war, challenge: updated } };
                }
                // isSeed
                if (ch.fromPlayer2) {
                    const updated = {
                        ...ch,
                        fromPlayer: ch.fromPlayer2,
                        fromPlayer2: undefined,
                        status: 'queuing',
                        acceptedPlayer: undefined,
                        acceptedPlayer2: undefined,
                    };
                    war = {
                        ...war,
                        pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                        updatedAt: now,
                    };
                    await _storage_js_1.kv.set(key, war);
                    return { status: 200, body: { war, challenge: updated } };
                }
                // seed leaves alone → cancel
                const cancelled = { ...ch, status: 'cancelled', completedAt: now };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.filter(c => c.id !== ch.id),
                    completedChallenges: [cancelled, ...war.completedChallenges].slice(0, 200),
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: cancelled } };
            }
            // ── accept ────────────────────────────────────────────────
            // 1v1 modes: full accept in one call (status → 'accepted').
            // 2v2 modes: first defender queues (acceptedPlayer set, status stays 'pending').
            if (action === 'accept') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch)
                    return { status: 404, body: { error: 'Challenge not found.' } };
                if (ch.status !== 'pending')
                    return { status: 409, body: { error: 'Challenge is not currently acceptable.' } };
                const toClan = war.clans.find(c => c !== ch.fromClan);
                if (!toClan)
                    return { status: 500, body: { error: 'Invalid war record.' } };
                if (!identity.admin && ctx.clan !== toClan) {
                    return { status: 403, body: { error: 'Only the defending clan can accept this challenge.' } };
                }
                const isTwoV = TWO_V_TWO.has(ch.mode);
                const me = identity.admin ? String(body?.acceptedPlayer ?? '') : ctx.name;
                if (!me)
                    return { status: 400, body: { error: 'Missing player name.' } };
                if (isTwoV && ch.acceptedPlayer) {
                    return { status: 409, body: { error: 'Accept queue already has a defender — use join-accept to join as the second.' } };
                }
                const now = Date.now();
                // For PvP modes, stamp a battleId that the clients use to
                // optimistically open the PvpBattleScreen. The PvP session
                // itself is still created by /api/pvp/session.
                const battleId = (ch.mode === 'pvp1v1' || ch.mode === 'pvp2v2')
                    ? `pvp-clanwar-${ch.id}`
                    : ch.battleId;
                const updated = isTwoV
                    ? { ...ch, acceptedPlayer: me, battleId } // queue 1/2
                    : { ...ch, acceptedPlayer: me, status: 'accepted', acceptedAt: now, battleId };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: updated } };
            }
            // ── join-accept (2v2 second defender) ─────────────────────
            if (action === 'join-accept') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch)
                    return { status: 404, body: { error: 'Challenge not found.' } };
                if (!TWO_V_TWO.has(ch.mode))
                    return { status: 400, body: { error: 'Only 2v2 challenges have an accept queue.' } };
                if (ch.status !== 'pending')
                    return { status: 409, body: { error: 'Challenge is not currently joinable.' } };
                if (!ch.acceptedPlayer)
                    return { status: 409, body: { error: 'No defender has queued yet — use accept first.' } };
                const toClan = war.clans.find(c => c !== ch.fromClan);
                if (!identity.admin && ctx.clan !== toClan) {
                    return { status: 403, body: { error: 'Only the defending clan can join the accept queue.' } };
                }
                const me = identity.admin ? String(body?.acceptedPlayer2 ?? '') : ctx.name;
                if (!me)
                    return { status: 400, body: { error: 'Missing player name.' } };
                if (eq(ch.acceptedPlayer, me))
                    return { status: 400, body: { error: 'You are already the queued defender.' } };
                const now = Date.now();
                const updated = {
                    ...ch,
                    acceptedPlayer2: me,
                    status: 'accepted',
                    acceptedAt: now,
                };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: updated } };
            }
            // ── leave-accept (2v2 defender leaves the accept queue) ───
            if (action === 'leave-accept') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch)
                    return { status: 404, body: { error: 'Challenge not found.' } };
                if (!TWO_V_TWO.has(ch.mode))
                    return { status: 400, body: { error: 'Only 2v2 challenges have an accept queue.' } };
                if (ch.status !== 'pending')
                    return { status: 409, body: { error: 'Accept queue is closed (challenge already accepted or resolved).' } };
                const toClan = war.clans.find(c => c !== ch.fromClan);
                if (!identity.admin && ctx.clan !== toClan) {
                    return { status: 403, body: { error: 'Only the defending clan can leave the accept queue.' } };
                }
                const me = identity.admin ? String(body?.player ?? '') : ctx.name;
                const isFirst = eq(ch.acceptedPlayer, me);
                const isSecond = eq(ch.acceptedPlayer2, me);
                if (!isFirst && !isSecond)
                    return { status: 403, body: { error: 'You are not in this accept queue.' } };
                // If the 2nd defender leaves: just clear acceptedPlayer2.
                // If the 1st defender leaves with a 2nd present: promote 2nd → 1st.
                // If the 1st defender leaves alone: clear both (queue resets to 0/2).
                const now = Date.now();
                let updated;
                if (isSecond) {
                    updated = { ...ch, acceptedPlayer2: undefined };
                }
                else if (ch.acceptedPlayer2) {
                    updated = { ...ch, acceptedPlayer: ch.acceptedPlayer2, acceptedPlayer2: undefined };
                }
                else {
                    updated = { ...ch, acceptedPlayer: undefined };
                }
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: updated } };
            }
            // ── decline / cancel ─────────────────────────────────────
            if (action === 'decline' || action === 'cancel') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch)
                    return { status: 404, body: { error: 'Challenge not found.' } };
                if (ch.status !== 'pending' && ch.status !== 'queuing') {
                    return { status: 409, body: { error: 'Challenge already resolved.' } };
                }
                // 'cancel' = sender pulls back. 'decline' = defender refuses.
                if (action === 'cancel') {
                    if (!identity.admin && ctx.clan !== ch.fromClan) {
                        return { status: 403, body: { error: 'Only the sending clan can cancel this challenge.' } };
                    }
                }
                else {
                    if (ch.status === 'queuing') {
                        return { status: 409, body: { error: 'Cannot decline a queue that is still being filled.' } };
                    }
                    const toClan = war.clans.find(c => c !== ch.fromClan);
                    if (!identity.admin && ctx.clan !== toClan) {
                        return { status: 403, body: { error: 'Only the defending clan can decline this challenge.' } };
                    }
                }
                const now = Date.now();
                const updated = { ...ch, status: action === 'cancel' ? 'cancelled' : 'expired', completedAt: now };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.filter(c => c.id !== ch.id),
                    completedChallenges: [updated, ...war.completedChallenges].slice(0, 200),
                    updatedAt: now,
                };
                await _storage_js_1.kv.set(key, war);
                return { status: 200, body: { war, challenge: updated } };
            }
            return { status: 400, body: { error: `Unknown action: ${action}` } };
        });
        return res.status(result.status).json(result.body);
    }
    catch (err) {
        console.error('[clan/war/challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
