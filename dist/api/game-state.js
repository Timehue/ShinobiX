import { kv } from './_storage.js';
import { cors } from './_utils.js';
const LEADERSHIP_IMAGES_KEY = 'game:village-leadership-images';
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const ARENA_TOURNAMENT_KEY = 'game:arena:tournament';
const ARENA_ACTIVE_FIGHTS_KEY = 'game:arena:active-fights';
const CLAN_PET_BATTLE_PREFIX = 'game:clan-pet-battle:';
function clanPetBattleKey(clanName) {
    return `${CLAN_PET_BATTLE_PREFIX}${clanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        try {
            const [villageStateKeys, leadershipImages, arenaTournament, arenaActiveFights, clanPetBattleKeys] = await Promise.all([
                kv.keys(`${VILLAGE_STATE_PREFIX}*`),
                kv.get(LEADERSHIP_IMAGES_KEY),
                kv.get(ARENA_TOURNAMENT_KEY),
                kv.get(ARENA_ACTIVE_FIGHTS_KEY),
                kv.keys(`${CLAN_PET_BATTLE_PREFIX}*`),
            ]);
            const villageStates = {};
            if (villageStateKeys.length > 0) {
                const stateValues = await Promise.all(villageStateKeys.map(k => kv.get(k)));
                villageStateKeys.forEach((k, i) => {
                    const name = k.slice(VILLAGE_STATE_PREFIX.length);
                    villageStates[name] = stateValues[i];
                });
            }
            const clanPetBattles = {};
            if (clanPetBattleKeys.length > 0) {
                const battleValues = await Promise.all(clanPetBattleKeys.map(k => kv.get(k)));
                clanPetBattleKeys.forEach((k, i) => {
                    const name = k.slice(CLAN_PET_BATTLE_PREFIX.length);
                    clanPetBattles[name] = battleValues[i];
                });
            }
            // CDN caches this response for 20s so N players polling every 30s share
            // one KV hit per cache window instead of N individual hits.
            // stale-while-revalidate=10 keeps the response snappy while the next fetch runs.
            res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
            return res.status(200).json({
                villageStates,
                villageLeadershipImages: leadershipImages ?? null,
                arenaTournament: arenaTournament ?? null,
                arenaActiveFights: Array.isArray(arenaActiveFights) ? arenaActiveFights : [],
                clanPetBattles,
            });
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind } = body;
            if (kind === 'villageState') {
                const { village, state } = body;
                if (!village || !state)
                    return res.status(400).json({ error: 'Missing village or state.' });
                const key = `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                await kv.set(key, state);
                return res.status(200).json({ ok: true });
            }
            if (kind === 'villageLeadershipImages') {
                const { images } = body;
                if (!images)
                    return res.status(400).json({ error: 'Missing images.' });
                await kv.set(LEADERSHIP_IMAGES_KEY, images);
                return res.status(200).json({ ok: true });
            }
            if (kind === 'arenaTournament') {
                const { tournament } = body;
                if (tournament == null) {
                    await kv.del(ARENA_TOURNAMENT_KEY);
                }
                else {
                    await kv.set(ARENA_TOURNAMENT_KEY, tournament);
                }
                return res.status(200).json({ ok: true });
            }
            if (kind === 'arenaActiveFights') {
                const { fights } = body;
                if (!Array.isArray(fights))
                    return res.status(400).json({ error: 'Missing fights array.' });
                await kv.set(ARENA_ACTIVE_FIGHTS_KEY, fights.slice(0, 20));
                return res.status(200).json({ ok: true });
            }
            if (kind === 'pendingClanPetBattle') {
                const { clanName, battle } = body;
                if (!clanName)
                    return res.status(400).json({ error: 'Missing clanName.' });
                const key = clanPetBattleKey(clanName);
                if (battle == null) {
                    await kv.del(key);
                }
                else {
                    await kv.set(key, battle, { ex: 24 * 60 * 60 }); // 24-hour TTL
                }
                return res.status(200).json({ ok: true });
            }
            return res.status(400).json({ error: 'Unknown kind.' });
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }
    return res.status(405).end();
}
