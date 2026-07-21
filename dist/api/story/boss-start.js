"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _authoritative_pve_js_1 = require("../_authoritative-pve.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
const _authoritative_story_combat_js_1 = require("./_authoritative-story-combat.js");
/**
 * Start a sealed, server-resolved story-boss fight for the player's CURRENT
 * milestone. Body: { playerName, hostLoadout?, bossName? } — bossName is
 * display-only flavor from the authored storyline; the milestone, opponent,
 * stats, and reward row are all derived server-side from the save.
 * Mirrors api/missions/combat-start.ts.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'story-boss-start', 12, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only start your own story battle.' });
        const save = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = save?.character;
        if (!save || !char)
            return res.status(404).json({ error: 'Player save not found.' });
        const eligibility = (0, _authoritative_story_combat_js_1.storyBossEligibility)(char);
        if (!eligibility.ok)
            return res.status(eligibility.status).json({ error: eligibility.error });
        const runId = (0, _authoritative_story_combat_js_1.storyBossRunId)();
        const seed = identity.admin ? 12345 : (0, node_crypto_1.randomInt)(1, 0x7fffffff);
        const now = Date.now();
        const bossTemplate = (0, _authoritative_story_combat_js_1.storyBossEnemyTemplate)({
            village: eligibility.village,
            progressIndex: eligibility.progressIndex,
            displayName: typeof body.bossName === 'string' ? body.bossName : undefined,
        });
        const floor = (0, _authoritative_pve_js_1.dynamicBossFloor)({
            id: 9_200 + eligibility.progressIndex,
            name: `story-${eligibility.village.toLowerCase().replace(/\W+/g, '-')}-${eligibility.progressIndex}`,
            bossAiId: bossTemplate.visual ?? 'story-boss',
            objective: 'defeat-boss',
            roundBudget: 24,
            biome: _authoritative_story_combat_js_1.STORY_VILLAGE_BIOMES[eligibility.village] ?? 'central',
        });
        const session = (0, _authoritative_pve_js_1.buildAuthoritativeSoloEncounter)({
            playerName,
            save,
            floor,
            bossTemplate,
            runId,
            seed,
            now,
            towerId: 'story-boss',
            hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout : undefined,
        });
        const binding = (0, _authoritative_story_combat_js_1.createStoryCombatBinding)({
            runId,
            playerName,
            village: eligibility.village,
            progressIndex: eligibility.progressIndex,
            now,
        });
        await (0, _tower_store_js_1.writeSession)(session);
        await _storage_js_1.kv.set((0, _authoritative_story_combat_js_1.storyCombatBindingKey)(runId), binding, { ex: _authoritative_story_combat_js_1.STORY_COMBAT_SESSION_TTL_SECONDS });
        return res.status(200).json({ ok: true, runId, session });
    }
    catch (err) {
        console.error('[story/boss-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
