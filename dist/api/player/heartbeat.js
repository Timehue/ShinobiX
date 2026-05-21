import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
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
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, sector, character } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        const challengeKey = `challenges:${name.toLowerCase().trim()}`;
        const presenceKey = `${PRESENCE_KEY_PREFIX}${name}`;
        const resetSignalKey = `reset-signal:${name.toLowerCase().trim()}`;
        // Read this player's own presence (for pendingAttacker), challenges, and reset signal in parallel.
        const [existing, pendingChallenges, resetSignal] = await Promise.all([
            kv.get(presenceKey),
            kv.get(challengeKey),
            kv.get(resetSignalKey),
        ]);
        if (resetSignal) {
            return res.status(200).json({ forceReload: true });
        }
        const pendingAttacker = existing?.pendingAttacker ?? null;
        const entrySector = normalizeSector(sector, normalizeSector(existing?.sector, 40));
        const entry = {
            name,
            sector: entrySector,
            character: character ?? existing?.character ?? null,
            lastSeen: Date.now(),
            pendingAttacker: null,
        };
        // Write only the individual TTL key — one cheap upsert, Postgres handles expiry.
        // No JSONB hash merge means no O(N-players) CPU work per heartbeat.
        await Promise.all([
            kv.set(presenceKey, entry, { ex: PRESENCE_TTL_S }),
            pendingChallenges?.length ? kv.del(challengeKey) : Promise.resolve(),
        ]);
        // Fetch all active presence via keys + mget — 2 indexed queries, no large blob.
        // Expired keys are excluded by the kv.keys() query (expires_at filter in SQL).
        const presenceKeys = await kv.keys(`${PRESENCE_KEY_PREFIX}*`);
        const otherKeys = presenceKeys.filter(k => k !== presenceKey);
        const otherValues = otherKeys.length
            ? await kv.mget(...otherKeys)
            : [];
        const allEntries = otherValues.filter((v) => Boolean(v?.name));
        const toRecord = ({ name: n, sector: s, character: c }) => {
            const ch = c;
            return {
                name: n, sector: s, character: c,
                level: ch?.level ?? 1,
                village: ch?.village ?? '',
                specialty: ch?.specialty ?? 'Ninjutsu',
                currentSector: s,
                lastSeenAt: Date.now(),
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
