"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
const LEADERSHIP_IMAGES_KEY = 'game:village-leadership-images';
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const ARENA_TOURNAMENT_KEY = 'game:arena:tournament';
const ARENA_ACTIVE_FIGHTS_KEY = 'game:arena:active-fights';
const CLAN_PET_BATTLE_PREFIX = 'game:clan-pet-battle:';
function clanPetBattleKey(clanName) {
    return `${CLAN_PET_BATTLE_PREFIX}${clanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        try {
            const [villageStateKeys, leadershipImages, arenaTournament, arenaActiveFights, clanPetBattleKeys] = await Promise.all([
                _storage_js_1.kv.keys(`${VILLAGE_STATE_PREFIX}*`),
                _storage_js_1.kv.get(LEADERSHIP_IMAGES_KEY),
                _storage_js_1.kv.get(ARENA_TOURNAMENT_KEY),
                _storage_js_1.kv.get(ARENA_ACTIVE_FIGHTS_KEY),
                _storage_js_1.kv.keys(`${CLAN_PET_BATTLE_PREFIX}*`),
            ]);
            const villageStates = {};
            if (villageStateKeys.length > 0) {
                // mget fetches all values in one round-trip instead of N individual gets.
                const stateValues = await _storage_js_1.kv.mget(...villageStateKeys);
                villageStateKeys.forEach((k, i) => {
                    if (stateValues[i] != null) {
                        const name = k.slice(VILLAGE_STATE_PREFIX.length);
                        villageStates[name] = stateValues[i];
                    }
                });
            }
            const clanPetBattles = {};
            if (clanPetBattleKeys.length > 0) {
                // mget fetches all values in one round-trip instead of N individual gets.
                const battleValues = await _storage_js_1.kv.mget(...clanPetBattleKeys);
                clanPetBattleKeys.forEach((k, i) => {
                    if (battleValues[i] != null) {
                        const name = k.slice(CLAN_PET_BATTLE_PREFIX.length);
                        clanPetBattles[name] = battleValues[i];
                    }
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
        // Mutations need at least a logged-in player. Admin-only kinds further
        // gated below (villageLeadershipImages, arenaTournament).
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind } = body;
            // Admin-only kinds — wholesale state writes that no individual
            // player should drive (treasury wipes, tournament resets, etc.).
            const adminOnlyKinds = new Set(['villageLeadershipImages', 'arenaTournament']);
            if (adminOnlyKinds.has(String(kind)) && !identity.admin) {
                return res.status(403).json({ error: 'Admin only.' });
            }
            if (kind === 'villageState') {
                const { village, state } = body;
                if (!village || !state)
                    return res.status(400).json({ error: 'Missing village or state.' });
                const key = `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                await _storage_js_1.kv.set(key, state);
                return res.status(200).json({ ok: true });
            }
            if (kind === 'villageLeadershipImages') {
                const { images } = body;
                if (!images)
                    return res.status(400).json({ error: 'Missing images.' });
                await _storage_js_1.kv.set(LEADERSHIP_IMAGES_KEY, images);
                return res.status(200).json({ ok: true });
            }
            if (kind === 'arenaTournament') {
                const { tournament } = body;
                if (tournament == null) {
                    await _storage_js_1.kv.del(ARENA_TOURNAMENT_KEY);
                }
                else {
                    await _storage_js_1.kv.set(ARENA_TOURNAMENT_KEY, tournament);
                }
                return res.status(200).json({ ok: true });
            }
            if (kind === 'arenaActiveFights') {
                const { fights } = body;
                if (!Array.isArray(fights))
                    return res.status(400).json({ error: 'Missing fights array.' });
                await _storage_js_1.kv.set(ARENA_ACTIVE_FIGHTS_KEY, fights.slice(0, 20));
                return res.status(200).json({ ok: true });
            }
            if (kind === 'pendingClanPetBattle') {
                const { clanName, battle } = body;
                if (!clanName)
                    return res.status(400).json({ error: 'Missing clanName.' });
                const key = clanPetBattleKey(clanName);
                if (battle == null) {
                    await _storage_js_1.kv.del(key);
                }
                else {
                    await _storage_js_1.kv.set(key, battle, { ex: 24 * 60 * 60 }); // 24-hour TTL
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
