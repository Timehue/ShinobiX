"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const REGISTRY_KEY = 'player:registry';
const PRESENCE_KEY_PREFIX = 'presence:';
const PRESENCE_TTL_MS = 65_000; // kept for belt-and-suspenders staleness check
function normalizeSector(value, fallback = 40) {
    const sector = Number(value);
    if (!Number.isFinite(sector))
        return fallback;
    return Math.max(0, Math.floor(sector));
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        // Read individual presence:<name> TTL keys written by heartbeat.ts.
        // kv.keys() only returns non-expired keys, so no manual TTL filter needed.
        const presenceKeys = await _storage_js_1.kv.keys(`${PRESENCE_KEY_PREFIX}*`);
        const presenceValues = presenceKeys.length > 0
            ? await _storage_js_1.kv.mget(...presenceKeys)
            : [];
        const now = Date.now();
        const presenceEntries = presenceValues.filter((v) => Boolean(v?.name) && now - (v.lastSeen ?? 0) <= PRESENCE_TTL_MS);
        const livePresenceByName = new Map(presenceEntries.map(entry => [entry.name.toLowerCase(), entry]));
        const onlineNames = new Set(livePresenceByName.keys());
        // Primary: persistent registry (every player who ever connected)
        const rawRegistry = await _storage_js_1.kv.hgetall(REGISTRY_KEY) ?? {};
        const registryKeys = Object.keys(rawRegistry);
        // Batch-fetch all saves in one command instead of N sequential kv.get() calls.
        const saveKeys = registryKeys.map(k => `save:${k}`);
        const saves = saveKeys.length > 0
            ? await _storage_js_1.kv.mget(...saveKeys)
            : [];
        const players = [];
        for (let i = 0; i < registryKeys.length; i++) {
            const key = registryKeys[i];
            const value = rawRegistry[key];
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                const save = saves[i] ?? null;
                const livePresence = livePresenceByName.get((entry.name ?? '').toLowerCase());
                const character = livePresence?.character ?? save?.character;
                players.push({
                    name: entry.name ?? '',
                    level: entry.level ?? 1,
                    village: entry.village ?? '',
                    specialty: entry.specialty ?? '',
                    online: onlineNames.has((entry.name ?? '').toLowerCase()),
                    character,
                    currentSector: normalizeSector(livePresence?.sector, normalizeSector(save?.currentSector, 40)),
                    lastSeenAt: livePresence?.lastSeen ?? entry.lastSeen ?? 0,
                });
            }
            catch { /* skip malformed */ }
        }
        // Supplement: any saves not yet in the registry — no extra get() calls needed,
        // just list their names so they show up; character data will arrive on next heartbeat.
        const saveKeysFull = await _storage_js_1.kv.keys('save:*');
        for (const key of saveKeysFull) {
            const name = key.replace('save:', '');
            if (players.some(p => p.name.toLowerCase() === name.toLowerCase()))
                continue;
            const livePresence = livePresenceByName.get(name.toLowerCase());
            // Only include if they have live presence (character data available without a save read).
            if (!livePresence?.character)
                continue;
            const character = livePresence.character;
            players.push({
                name: character.name ?? name,
                level: character.level ?? 1,
                village: character.village ?? '',
                specialty: character.specialty ?? '',
                online: true,
                character,
                currentSector: normalizeSector(livePresence.sector, 40),
                lastSeenAt: livePresence.lastSeen ?? 0,
            });
        }
        players.sort((a, b) => {
            if (a.online !== b.online)
                return a.online ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        // 60s CDN cache — the client only polls every 5 min anyway, and online status
        // is supplemented by the heartbeat, so 60s staleness here is invisible.
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=10');
        return res.status(200).json({ players });
    }
    catch (err) {
        console.error('[roster]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
