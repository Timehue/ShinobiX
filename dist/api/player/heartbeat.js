"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const REGISTRY_KEY = 'player:registry';
// Individual TTL keys (presence:<name>) with 60s expiry.
// Postgres expires them automatically — no JSONB hash merges, no CPU spike.
// Reads use kv.keys('presence:*') + kv.mget() = 2 indexed queries.
const PRESENCE_KEY_PREFIX = 'presence:';
const PRESENCE_TTL_S = 60;
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
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, sector, character, travelingUntil, inBattle } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        const challengeKey = `challenges:${name.toLowerCase().trim()}`;
        const presenceKey = `${PRESENCE_KEY_PREFIX}${name}`;
        const resetSignalKey = `reset-signal:${name.toLowerCase().trim()}`;
        // Read this player's own presence (for pendingAttacker), challenges, and reset signal in parallel.
        const [existing, pendingChallenges, resetSignal] = await Promise.all([
            _storage_js_1.kv.get(presenceKey),
            _storage_js_1.kv.get(challengeKey),
            _storage_js_1.kv.get(resetSignalKey),
        ]);
        if (resetSignal) {
            return res.status(200).json({ forceReload: true });
        }
        const pendingAttacker = existing?.pendingAttacker ?? null;
        const entrySector = normalizeSector(sector, normalizeSector(existing?.sector, 40));
        const now = Date.now();
        const entry = {
            name,
            sector: entrySector,
            character: character ?? existing?.character ?? null,
            lastSeen: now,
            pendingAttacker: null,
            // Persist travel window so attack.ts / challenge.ts can reject mid-travel requests.
            travelingUntil: (travelingUntil && travelingUntil > now) ? travelingUntil : undefined,
            // Persist battle flag so attack.ts can reject double-battle requests.
            inBattle: inBattle === true ? true : undefined,
        };
        // Write only the individual TTL key — one cheap upsert, Postgres handles expiry.
        // No JSONB hash merge means no O(N-players) CPU work per heartbeat.
        await Promise.all([
            _storage_js_1.kv.set(presenceKey, entry, { ex: PRESENCE_TTL_S }),
            pendingChallenges?.length ? _storage_js_1.kv.del(challengeKey) : Promise.resolve(),
        ]);
        // Fetch all active presence via keys + mget — 2 indexed queries, no large blob.
        // Expired keys are excluded by the kv.keys() query (expires_at filter in SQL).
        const presenceKeys = await _storage_js_1.kv.keys(`${PRESENCE_KEY_PREFIX}*`);
        const otherKeys = presenceKeys.filter(k => k !== presenceKey);
        const otherValues = otherKeys.length
            ? await _storage_js_1.kv.mget(...otherKeys)
            : [];
        const allEntries = otherValues.filter((v) => Boolean(v?.name));
        const toRecord = ({ name: n, sector: s, character: c, travelingUntil: tu, inBattle: ib }) => {
            const ch = c;
            return {
                name: n, sector: s, character: c,
                level: ch?.level ?? 1,
                village: ch?.village ?? '',
                specialty: ch?.specialty ?? 'Ninjutsu',
                currentSector: s,
                lastSeenAt: Date.now(),
                travelingUntil: tu ?? 0,
                inBattle: ib ?? false,
            };
        };
        const sectorMates = allEntries
            .filter(p => normalizeSector(p.sector) === entry.sector)
            .map(toRecord);
        const allPlayers = allEntries.map(toRecord);
        return res.status(200).json({
            sectorMates,
            allPlayers,
            pendingAttacker,
            pendingChallenges: pendingChallenges ?? [],
        });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
