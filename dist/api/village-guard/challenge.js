"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const CHALLENGE_TTL = 120; // seconds — survives two heartbeat cycles
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
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
            const attackerName = String(attackerCharacter.name ?? '').toLowerCase().trim();
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
        const requestedGuard = guardName ? guards.find(g => g.name.toLowerCase().trim() === guardName.toLowerCase().trim()) : undefined;
        const guard = requestedGuard ?? guards[Math.floor(Math.random() * guards.length)];
        // Fetch guard's full character from their persistent save
        const guardSave = await _storage_js_1.kv.get(`save:${guard.name.toLowerCase()}`);
        const guardCharacter = guardSave?.character ?? null;
        if (!guardCharacter) {
            // Guard's save is missing — fall back to AI
            return res.status(200).json({ pvp: false, guardName: guard.name, guardLevel: guard.level, defenseBonusPercent: guard.defenseBonusPercent ?? 0 });
        }
        // Send a sectorAttack-style DuelChallenge to the guard.
        // Their heartbeat will pick it up in pendingChallenges and the auto-routing
        // effect will immediately route them to the arena as the defender.
        if (attackerCharacter && battleId) {
            const challenge = {
                id: `guard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                fromName: attackerCharacter.name ?? 'Raider',
                toName: guard.name,
                challenger: attackerCharacter,
                createdAt: Date.now(),
                mode: 'standard',
                sectorAttack: true,
                ...(battleId ? { battleId } : {}),
            };
            const challengeKey = `challenges:${guard.name.toLowerCase().trim()}`;
            const existing = await _storage_js_1.kv.get(challengeKey) ?? [];
            await _storage_js_1.kv.set(challengeKey, [...existing, challenge].slice(-20), { ex: CHALLENGE_TTL });
        }
        return res.status(200).json({ pvp: true, guardCharacter, guardName: guard.name });
    }
    catch (err) {
        console.error('[village-guard/challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
