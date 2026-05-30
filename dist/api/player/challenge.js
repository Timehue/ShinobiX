"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _lock_js_1 = require("../_lock.js");
const CHALLENGE_TTL = 120; // seconds — long enough for two heartbeat cycles
// Public projection for the challenger character stored alongside a
// challenges:<name> entry. The challenges:* prefix is anon-readable via
// Supabase Realtime (see supabase-schema.sql), so the FULL challenger
// character — including ryo, jutsu, equipment, stats — would otherwise
// be world-readable to any anon WS subscriber. Strip down to the bare
// minimum the recipient's inbox needs to render: name, level, village,
// avatar, cosmetic title, ranked rating.
const CHALLENGER_PUBLIC_FIELDS = new Set([
    'name', 'level', 'village', 'specialty',
    'avatarImage', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'rankedRating',
    'clan',
    // Pet-challenge accept handlers (App.tsx :9090, :9107, :17624,
    // :17635, :36432) read challenge.challenger.pets to find the
    // matching pet by id at accept time. Stripping it broke every
    // pet challenge (TypeError on .find).
    'pets',
]);
function projectChallengerCharacter(c) {
    if (!c || typeof c !== 'object')
        return c;
    const src = c;
    const out = {};
    for (const k of CHALLENGER_PUBLIC_FIELDS)
        if (k in src)
            out[k] = src[k];
    return out;
}
function projectChallenge(c) {
    if (!c || typeof c !== 'object')
        return c;
    const rec = c;
    const out = { ...rec };
    if ('challenger' in rec)
        out.challenger = projectChallengerCharacter(rec.challenger);
    return out;
}
function challengeKey(name) {
    return `challenges:${name.toLowerCase().trim()}`;
}
function outgoingKey(name) {
    return `challenge-outgoing:${name.toLowerCase().trim()}`;
}
function challengeId(challenge) {
    return challenge && typeof challenge === 'object' && 'id' in challenge
        ? String(challenge.id ?? '')
        : '';
}
function challengeFromName(challenge) {
    return challenge && typeof challenge === 'object' && 'fromName' in challenge
        ? String(challenge.fromName ?? '').trim()
        : '';
}
// Server-clamp clanWarPoints to the mode's legal value. Without this,
// a malicious challenger could set clanWarPoints: 9999 on the body and
// the client's `addClanWarPoints` call after a win would credit the
// inflated value to the clan leaderboard.
//
// Keep in sync with the client's challengePlayer() call sites
// (App.tsx ~33901-33903):
//   clanWar1v1 → +50
//   clanWar2v2 → +100
//   clanWarPet → +25
//   anything else → 0
const CLAN_WAR_POINTS_BY_MODE = {
    clanWar1v1: 50,
    clanWar2v2: 100,
    clanWarPet: 25,
};
function clampClanWarPoints(challenge) {
    if (!challenge || typeof challenge !== 'object')
        return challenge;
    const rec = challenge;
    const mode = String(rec.mode ?? '');
    const cap = CLAN_WAR_POINTS_BY_MODE[mode] ?? 0;
    if (typeof rec.clanWarPoints !== 'number' && rec.clanWarPoints !== undefined) {
        // Non-number — coerce to 0.
        return { ...rec, clanWarPoints: 0 };
    }
    const pts = Number(rec.clanWarPoints ?? 0);
    if (!Number.isFinite(pts) || pts <= 0) {
        // Strip any falsy or NaN value so downstream UI doesn't choke.
        if ('clanWarPoints' in rec) {
            const { clanWarPoints: _drop, ...rest } = rec;
            void _drop;
            return rest;
        }
        return rec;
    }
    if (pts > cap) {
        return { ...rec, clanWarPoints: cap };
    }
    return rec;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    // All challenge operations require a logged-in player (or admin).
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (req.method === 'DELETE') {
            const { targetName, challengeId: id, fromName } = body;
            if (!targetName && !fromName)
                return res.status(400).json({ error: 'Missing targetName or fromName.' });
            // Ownership gate: a DELETE clears a challenge from targetName's
            // inbox and/or fromName's outgoing slot. The caller must be a PARTY
            // to the challenge — i.e. either its recipient (targetName === me)
            // or its sender (fromName === me). This preserves both legitimate
            // flows, where one name is the caller and the other is the
            // counterparty:
            //   • sender cancels:    targetName=<recipient>, fromName=<me>
            //   • recipient resolves: targetName=<me>, fromName=<sender>
            // It blocks a pure third party (neither sender nor recipient) from
            // clearing someone else's inbox/outgoing slot. Admins bypass.
            if (!identity.admin) {
                const me = identity.name;
                const ownsTarget = targetName ? targetName.toLowerCase().trim() === me : false;
                const ownsFrom = fromName ? fromName.toLowerCase().trim() === me : false;
                if (!ownsTarget && !ownsFrom) {
                    return res.status(403).json({ error: 'Cannot delete another player\'s challenges.' });
                }
            }
            const pendingKey = targetName ? challengeKey(targetName) : '';
            // Lock the recipient's inbox during the read-filter-write so a
            // concurrent POST adding a new challenge can't be silently
            // overwritten by our DELETE (or vice versa).
            if (pendingKey) {
                await (0, _lock_js_1.withKvLock)(pendingKey, async () => {
                    const existing = await _storage_js_1.kv.get(pendingKey) ?? [];
                    const updated = id ? existing.filter(challenge => challengeId(challenge) !== id) : existing;
                    if (updated.length)
                        await _storage_js_1.kv.set(pendingKey, updated, { ex: CHALLENGE_TTL });
                    else
                        await _storage_js_1.kv.del(pendingKey);
                });
            }
            if (fromName)
                await _storage_js_1.kv.del(outgoingKey(fromName));
            return res.status(200).json({ ok: true });
        }
        if (req.method !== 'POST')
            return res.status(405).end();
        const { targetName, challenge } = body;
        if (!targetName || !challenge)
            return res.status(400).json({ error: 'Missing targetName or challenge.' });
        const record = challenge;
        const fromName = challengeFromName(challenge);
        // The challenge's fromName (sender) must match the authed identity unless admin.
        if (!identity.admin && fromName && fromName.toLowerCase() !== identity.name) {
            return res.status(403).json({ error: 'Cannot send a challenge as another player.' });
        }
        // For new challenges (not accept/decline/battle routing), gate on travel + battle state.
        if (!record.accepted && !record.declined && !record.battleId) {
            const targetPresence = await _storage_js_1.kv.get(`presence:${targetName}`);
            if (targetPresence) {
                if (Number(targetPresence.travelingUntil ?? 0) > Date.now()) {
                    return res.status(409).json({ error: 'Target is traveling.' });
                }
                if (targetPresence.inBattle) {
                    return res.status(409).json({ error: 'Target is already in a battle.' });
                }
                if (targetPresence.pendingAttacker) {
                    return res.status(409).json({ error: 'Target is already engaged in combat.' });
                }
            }
        }
        if (record.accepted || record.declined) {
            await _storage_js_1.kv.del(outgoingKey(targetName));
        }
        else if (fromName && !record.battleId) {
            const senderKey = outgoingKey(fromName);
            const existingOutgoing = await _storage_js_1.kv.get(senderKey);
            if (existingOutgoing) {
                return res.status(409).json({ error: 'You already have a pending challenge.' });
            }
            await _storage_js_1.kv.set(senderKey, { targetName, challengeId: challengeId(challenge), createdAt: Date.now() }, { ex: CHALLENGE_TTL });
        }
        // Two server-side transforms before the challenge hits KV:
        //   1. clampClanWarPoints — keeps the win-credit path honest.
        //   2. projectChallenge   — strips the challenger's full character
        //      down to the inbox-renderable public projection. The
        //      challenges:* key prefix is anon-readable via Supabase
        //      Realtime; the full payload would otherwise leak ryo /
        //      jutsu / equipment / stats to any anon WS subscriber.
        const safeChallenge = projectChallenge(clampClanWarPoints(challenge));
        // Lock the recipient's inbox around the read-dedupe-write so two
        // simultaneous challengers can't both read the same snapshot and
        // both produce a final list that's missing the other's entry.
        const key = challengeKey(targetName);
        const cid = challengeId(challenge);
        await (0, _lock_js_1.withKvLock)(key, async () => {
            const existing = await _storage_js_1.kv.get(key) ?? [];
            const deduped = cid ? existing.filter(c => challengeId(c) !== cid) : existing;
            const updated = [...deduped, safeChallenge].slice(-20);
            await _storage_js_1.kv.set(key, updated, { ex: CHALLENGE_TTL });
        });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
