"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const session_js_1 = require("../pvp/session.js");
const notify_js_1 = require("../_realtime/notify.js");
const CHALLENGE_TTL = 120; // seconds — survives two heartbeat cycles
// Match the public projection in api/player/challenge.ts. The challenges:*
// key prefix is anon-readable via Supabase Realtime, so the attacker's
// full character would leak (ryo, jutsu, equipment, stats) without this.
const CHALLENGER_PUBLIC_FIELDS = new Set([
    'name', 'level', 'village', 'specialty',
    'avatarImage', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'rankedRating',
    'clan',
    // Keep parity with api/player/challenge.ts — pet-challenge accept
    // handlers read challenge.challenger.pets to find the matching pet.
    'pets',
]);
function projectChallengerCharacter(c) {
    if (!c)
        return {};
    const out = {};
    for (const k of CHALLENGER_PUBLIC_FIELDS)
        if (k in c)
            out[k] = c[k];
    return out;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Require auth + rate-limit per identity (1 challenge per 3s, max 30 / 5 min).
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    const authedName = identity.admin ? null : identity.name;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'village-guard-challenge', 30, 5 * 60_000, authedName))
        return;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'village-guard-challenge-burst', 1, 3_000, authedName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { attackerCharacter, village, battleId, guardName } = body;
        if (!village)
            return res.status(400).json({ error: 'Missing village.' });
        // The attacker name in the body must match the authed identity (admins exempt).
        if (!identity.admin && attackerCharacter) {
            const attackerName = (0, _utils_js_1.safeName)(String(attackerCharacter.name ?? ''));
            if (attackerName && attackerName !== identity.name) {
                return res.status(403).json({ error: 'Cannot attack as another player.' });
            }
        }
        // Find all active guards for this village
        const keys = await _storage_js_1.kv.keys('guard:*');
        const guards = (await _storage_js_1.kv.mget(...keys))
            .filter((g) => !!g && g.village === village);
        if (guards.length === 0) {
            return res.status(200).json({ noGuard: true });
        }
        // Use the requested guard when the client already picked one for a shared PvP session.
        const requestedGuard = guardName ? guards.find(g => (0, _utils_js_1.safeName)(g.name) === (0, _utils_js_1.safeName)(guardName)) : undefined;
        const guard = requestedGuard ?? guards[Math.floor(Math.random() * guards.length)];
        // Fetch guard's full character from their persistent save
        const guardSave = await _storage_js_1.kv.get(`save:${(0, _utils_js_1.safeName)(guard.name)}`);
        const guardCharacter = guardSave?.character ?? null;
        if (!guardCharacter) {
            // Guard's save is missing — fall back to AI. Cap the defense
            // bonus at 100% so a stale guard entry with an absurd value
            // (admin edit, corrupted state) can't make raids unwinnable.
            const cappedBonus = Math.max(0, Math.min(100, Number(guard.defenseBonusPercent ?? 0) || 0));
            return res.status(200).json({ pvp: false, guardName: guard.name, guardLevel: guard.level, defenseBonusPercent: cappedBonus });
        }
        // Send a sectorAttack-style DuelChallenge to the guard.
        // Their heartbeat will pick it up in pendingChallenges and the auto-routing
        // effect will immediately route them to the arena as the defender.
        if (attackerCharacter && battleId) {
            const challenge = {
                id: `guard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                fromName: attackerCharacter.name ?? 'Raider',
                toName: guard.name,
                // Strip the attacker's character to the inbox-public projection
                // before it lands on the challenges:* key (anon-readable via
                // Supabase Realtime). Without this strip the raider's ryo /
                // jutsu / equipment / stats leak to any anon WS subscriber.
                challenger: projectChallengerCharacter(attackerCharacter),
                createdAt: Date.now(),
                mode: 'standard',
                sectorAttack: true,
                ...(battleId ? { battleId } : {}),
            };
            const challengeKey = `challenges:${(0, _utils_js_1.safeName)(guard.name)}`;
            // Lock the guard's inbox during the read-append-write so a
            // concurrent /api/player/challenge POST can't be overwritten.
            await (0, _lock_js_1.withKvLock)(challengeKey, async () => {
                const existing = await _storage_js_1.kv.get(challengeKey) ?? [];
                await _storage_js_1.kv.set(challengeKey, [...existing, challenge].slice(-20), { ex: CHALLENGE_TTL });
            });
            // Instant delivery: nudge the guard to run an immediate heartbeat —
            // same one-shot "poll now" kick the player attack/challenge paths use.
            // The Supabase Realtime challenges:* subscription also pushes this, but
            // the kick removes any reliance on that being configured, which matters
            // now the queued-guard heartbeat is 20s while the socket is connected.
            (0, notify_js_1.kickPlayer)(guard.name, 'challenge');
        }
        // Project the guard down to the combat-safe field set before returning
        // it to the ATTACKER. Previously the guard's full private save (ryo,
        // bank, inventory, daily ledgers, mission journals, pets, lifetime
        // counters) was handed to whoever attacked them — a free pre-battle
        // scouting + economic-intel leak. The PvP session endpoint re-hydrates
        // the guard from their authoritative save anyway, so the attacker only
        // needs the combat/display fields this projection keeps.
        const safeGuardCharacter = (0, session_js_1.stripNonCombatFields)(guardCharacter);
        return res.status(200).json({ pvp: true, guardCharacter: safeGuardCharacter, guardName: guard.name });
    }
    catch (err) {
        console.error('[village-guard/challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
