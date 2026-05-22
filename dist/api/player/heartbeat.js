"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
// Individual TTL keys (presence:<name>) with 60s expiry.
// Postgres expires them automatically — no JSONB hash merges, no CPU spike.
// Reads use kv.keys('presence:*') + kv.mget() = 2 indexed queries.
const PRESENCE_KEY_PREFIX = 'presence:';
const PRESENCE_TTL_S = 60;
let _presenceListCache = null;
const PRESENCE_LIST_CACHE_TTL_MS = 5_000;
// Max time the client can claim to be traveling (10 min). Caps an exploited
// travelingUntil that would make a player permanently unreachable.
const MAX_TRAVEL_WINDOW_MS = 10 * 60_000;
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
    // 1 heartbeat per 2 s per player (30/min). Authenticated name wins over IP for
    // the rate-limit key so shared IPs (NAT) don't bleed into each other's quota.
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.name === 'string' ? bodyPeek.name : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'heartbeat', 30, 60_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, sector, character, travelingUntil, inBattle } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        // Require that the heartbeat is from the named player (or admin).
        // Stops attackers from spoofing presence: setting inBattle=true to be
        // untouchable, faking travelingUntil, teleporting others, etc.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
            return res.status(403).json({ error: 'Cannot heartbeat as another player.' });
        }
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
        // Cap client-supplied travelingUntil so an exploit can't make a player
        // permanently untouchable (e.g. client sends year 9999 epoch).
        const safeTravelUntil = travelingUntil
            ? Math.min(travelingUntil, now + MAX_TRAVEL_WINDOW_MS)
            : undefined;
        const entry = {
            name,
            sector: entrySector,
            character: character ?? existing?.character ?? null,
            lastSeen: now,
            pendingAttacker: null,
            // Persist travel window so attack.ts / challenge.ts can reject mid-travel requests.
            travelingUntil: (safeTravelUntil && safeTravelUntil > now) ? safeTravelUntil : undefined,
            // Persist battle flag so attack.ts can reject double-battle requests.
            inBattle: inBattle === true ? true : undefined,
        };
        // Write only the individual TTL key — one cheap upsert, Postgres handles expiry.
        // No JSONB hash merge means no O(N-players) CPU work per heartbeat.
        await Promise.all([
            _storage_js_1.kv.set(presenceKey, entry, { ex: PRESENCE_TTL_S }),
            pendingChallenges?.length ? _storage_js_1.kv.del(challengeKey) : Promise.resolve(),
        ]);
        // Build the full presence list using an in-process cache (refreshed every 5 s).
        // Between refreshes, each call patches its own updated entry into the cached list —
        // so the caller always sees fresh data for themselves without an O(N) KV round-trip
        // on every single heartbeat (which would be O(N²) total across all players).
        let allEntries;
        const cacheAge = _presenceListCache ? now - _presenceListCache.at : Infinity;
        if (cacheAge < PRESENCE_LIST_CACHE_TTL_MS) {
            // Splice caller's freshly-written entry into the cached list.
            allEntries = _presenceListCache.entries
                .filter(e => e.name.toLowerCase() !== name.toLowerCase())
                .concat([entry]);
        }
        else {
            // Cache stale — do the full O(N) refresh from KV.
            const presenceKeys = await _storage_js_1.kv.keys(`${PRESENCE_KEY_PREFIX}*`);
            const otherKeys = presenceKeys.filter(k => k !== presenceKey);
            const otherValues = otherKeys.length
                ? await _storage_js_1.kv.mget(...otherKeys)
                : [];
            const otherEntries = otherValues.filter((v) => Boolean(v?.name));
            allEntries = [...otherEntries, entry];
            _presenceListCache = { entries: allEntries, at: now };
        }
        const toRecord = ({ name: n, sector: s, character: c, travelingUntil: tu, inBattle: ib }) => {
            const ch = c;
            return {
                name: n, sector: s,
                // Only include the avatar — full stats/jutsu/inventory are fetched fresh via
                // fetchPlayerCombatSave() at attack/challenge time, so the full blob is wasteful here.
                character: { avatarImage: ch?.avatarImage ?? '' },
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
        console.error('[heartbeat]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
