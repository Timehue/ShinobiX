"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const pet_duel_sim_js_1 = require("../_pet-sim/pet-duel-sim.js");
const _arena_ai_js_1 = require("./_arena-ai.js");
const _profession_mastery_js_1 = require("../_profession-mastery.js");
/*
 * /api/pet/battle-start - POST only
 *
 * Mints a short-lived single-use token for non-ranked Pet Coliseum rewards.
 * Casual pet combat is still client-resolved, but rewardful battle-result calls
 * must now prove a battle was intentionally started by the authenticated player
 * with the same reportKey they later redeem.
 */
const TOKEN_TTL_SECONDS = 15 * 60;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const opponentName = typeof body.opponentName === 'string' ? (0, _utils_js_1.safeName)(body.opponentName) : '';
        const opponentLevel = Math.max(1, Math.min(100, Math.floor(Number(body.opponentLevel ?? 1))));
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        const mode = body.mode === '2v2' ? '2v2' : '1v1';
        const playerPetIds = Array.isArray(body.playerPetIds) ? body.playerPetIds.map((value) => String(value)).slice(0, 2) : [];
        const opponentPetIds = Array.isArray(body.opponentPetIds) ? body.opponentPetIds.map((value) => String(value)).slice(0, 2) : [];
        const seed = Number.isSafeInteger(Number(body.seed)) ? Number(body.seed) : Date.now();
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!reportKey)
            return res.status(400).json({ error: 'Missing or invalid reportKey.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own pet battles.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-battle-start', 30, 60_000, identity.name)))
            return;
        const mySave = await _storage_js_1.kv.get(`save:${playerName}`);
        const myChar = mySave?.character;
        const myPets = Array.isArray(myChar?.pets) ? myChar.pets : [];
        const playerPets = playerPetIds.map((id) => myPets.find((pet) => String(pet?.id ?? '') === id)).filter(Boolean);
        if (!playerPets.length)
            return res.status(409).json({ error: 'A stored player pet is required.' });
        let opponentPets = [];
        let isAiOpponent = false;
        if (opponentName) {
            const oppSave = await _storage_js_1.kv.get(`save:${opponentName}`);
            const oppChar = oppSave?.character;
            const stored = Array.isArray(oppChar?.pets) ? oppChar.pets : [];
            opponentPets = opponentPetIds.map((id) => stored.find((pet) => String(pet?.id ?? '') === id)).filter(Boolean);
        }
        if (!opponentPets.length) {
            opponentPets = opponentPetIds.map((id) => _arena_ai_js_1.SERVER_ARENA_PETS[id]).filter(Boolean);
            isAiOpponent = opponentPets.length > 0;
        }
        if (!opponentPets.length)
            return res.status(409).json({ error: 'A server-known opponent pet is required.' });
        const rank = Math.max(0, Math.min(10, Number(myChar?.professionRank) || 0));
        const damageMult = isAiOpponent && myChar?.profession === 'petTamer' ? 1 + (5 + rank * 1.5 + (0, _profession_mastery_js_1.masteryBonus)(myChar.profession, myChar.masterySpec, 'petPveDamagePct')) / 100 : 1;
        const hpMult = isAiOpponent ? 1 + (0, _profession_mastery_js_1.masteryBonus)(myChar?.profession, myChar?.masterySpec, 'petPveHpPct') / 100 : 1;
        const revive = isAiOpponent && (0, _profession_mastery_js_1.masteryHasCapstone)(myChar?.profession, myChar?.masterySpec, 'alpha-bond');
        const result = mode === '2v2'
            ? (0, pet_duel_sim_js_1.runPetPartyDuel)(playerPets[0], playerPets[1] ?? null, opponentPets[0], opponentPets[1] ?? null, seed, damageMult, hpMult, revive, false, false, true).result
            : (0, pet_duel_sim_js_1.runPetDuel)(playerPets[0], opponentPets[0], seed, damageMult, hpMult, revive, false, false, null, true).result;
        const token = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
        await _storage_js_1.kv.set(`pet:battle-token:${playerName}:${token}`, {
            playerName,
            opponentName: opponentName || undefined,
            opponentLevel,
            reportKey,
            mode,
            createdAt: Date.now(),
            playerPetIds,
            authoritativeOutcome: result,
        }, { ex: TOKEN_TTL_SECONDS });
        return res.status(200).json({ ok: true, token, reportKey });
    }
    catch (err) {
        console.error('[pet/battle-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
