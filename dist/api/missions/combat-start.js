"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mission_catalog_js_1 = require("./_mission-catalog.js");
const _eligibility_js_1 = require("./_eligibility.js");
const _authoritative_combat_session_js_1 = require("./_authoritative-combat-session.js");
const _authoritative_pve_js_1 = require("../_authoritative-pve.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
/** Start a sealed, server-resolved combat mission. Body: { playerName, missionId, hostLoadout? }. */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const missionId = String(body.missionId ?? '').slice(0, 80);
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'mission-combat-start', 12, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only start your own mission.' });
        const mission = (0, _mission_catalog_js_1.combatMissionByKey)(missionId);
        if (!mission)
            return res.status(404).json({ error: 'Unknown combat mission.' });
        const save = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = save?.character;
        if (!save || !char)
            return res.status(404).json({ error: 'Player save not found.' });
        const eligibility = (0, _eligibility_js_1.canPlayerReceiveMission)(char, mission);
        if (!eligibility.ok)
            return res.status(403).json((0, _eligibility_js_1.missionEligibilityFailureBody)(eligibility));
        const runId = `mission-${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
        const seed = identity.admin ? 12345 : (0, node_crypto_1.randomInt)(1, 0x7fffffff);
        const now = Date.now();
        const floor = (0, _authoritative_pve_js_1.dynamicBossFloor)({
            id: 9_100 + Math.max(0, ['combat-e-drill', 'combat-d-errand', 'combat-c-patrol', 'combat-b-escort', 'combat-a-hunt', 'combat-s-crisis'].indexOf(mission.key)),
            name: mission.key,
            bossAiId: mission.aiProfileId,
            objective: 'defeat-boss',
            roundBudget: 24,
        });
        const session = (0, _authoritative_pve_js_1.buildAuthoritativeSoloEncounter)({
            playerName,
            save,
            floor,
            bossTemplate: (0, _authoritative_pve_js_1.missionEnemyTemplate)(mission),
            runId,
            seed,
            now,
            towerId: 'combat-mission',
            hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout : undefined,
        });
        const binding = (0, _authoritative_combat_session_js_1.createMissionCombatBinding)({ runId, playerName, mission, now, sessionId: runId });
        await (0, _tower_store_js_1.writeSession)(session);
        await _storage_js_1.kv.set((0, _authoritative_combat_session_js_1.missionCombatBindingKey)(runId), binding, { ex: _authoritative_combat_session_js_1.MISSION_COMBAT_SESSION_TTL_SECONDS });
        return res.status(200).json({ ok: true, runId, session });
    }
    catch (err) {
        console.error('[missions/combat-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
