"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const _seal_js_1 = require("./_seal.js");
const _encounter_js_1 = require("./_encounter.js");
const _engine_js_1 = require("./_engine.js");
const _sim_js_1 = require("./_sim.js");
const _tower_store_js_1 = require("./_tower-store.js");
/*
 * POST /api/towers/start — begin a Battle Towers run.
 *
 * Server-authoritative: the host + each ally are snapshotted from their AUTHORITATIVE save
 * and sealed combat-safe (sealTowerFighter); the host is the live human, allies are AI. The
 * seed + encounter are server-minted, persisted under tower:<runId>, and the AI is advanced
 * to the host's first turn. Body: { hostName, floor, allies?: string[] }.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const hostName = (0, _utils_js_1.safeName)(String(body.hostName ?? ''));
        if (!hostName)
            return res.status(400).json({ error: 'Invalid host name.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'towers-start', 6, 60_000, hostName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, hostName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== hostName)
            return res.status(403).json({ error: 'Can only start your own runs.' });
        const floor = (0, _floor_catalog_js_1.getFloor)(Math.floor(Number(body.floor)));
        if (!floor)
            return res.status(400).json({ error: 'Unknown floor.' });
        // Borrowed allies (friends/clan/public) → AI snapshots. De-dupe + cap the party.
        const allyNames = Array.isArray(body.allies) ? body.allies.map((a) => (0, _utils_js_1.safeName)(String(a))).filter(Boolean) : [];
        const memberSlugs = [...new Set([hostName, ...allyNames])].slice(0, _floor_catalog_js_1.MAX_PARTY_SIZE);
        if (memberSlugs.length < _floor_catalog_js_1.MIN_PARTY_SIZE && allyNames.length > 0) {
            // host wanted a squad but it collapsed to 1 — still allowed (solo), just note via partySize below
        }
        // Atomic daily mint cap (counts attempts, like raid-start).
        const started = await (0, _tower_store_js_1.bumpDailyStartCount)(hostName);
        if (!identity.admin && started > _tower_store_js_1.MAX_TOWER_STARTS_PER_DAY) {
            return res.status(429).json({ error: 'Daily Battle Towers start limit reached.' });
        }
        const squad = [];
        for (let i = 0; i < memberSlugs.length; i++) {
            const slug = memberSlugs[i];
            const rec = await _storage_js_1.kv.get(`save:${slug}`);
            const char = rec?.character;
            if (!char || typeof char !== 'object') {
                if (slug === hostName)
                    return res.status(400).json({ error: 'Your save was not found.' });
                continue; // skip a missing/invalid ally
            }
            squad.push({
                id: `sq-${i}`,
                name: String(char.name ?? slug),
                ownerSlug: slug,
                ai: slug !== hostName, // host is the live human; allies are AI snapshots
                character: (0, _seal_js_1.sealTowerFighter)(char),
            });
        }
        if (squad.length === 0)
            return res.status(400).json({ error: 'No valid squad members.' });
        const runId = `tower-${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
        const seed = identity.admin ? 12345 : (0, node_crypto_1.randomInt)(1, 0x7fffffff);
        const session = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad, runId, seed, partySize: squad.length, now: Date.now() });
        (0, _engine_js_1.startRound)(session);
        (0, _engine_js_1.runAiUntilHuman)(session, floor, (0, _sim_js_1.makeRng)(seed)); // advance to the host's first turn (or auto-resolve)
        await (0, _tower_store_js_1.writeSession)(session);
        return res.status(200).json({ runId, session });
    }
    catch (err) {
        console.error('[towers/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
