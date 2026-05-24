import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';

const LEADERSHIP_IMAGES_KEY = 'game:village-leadership-images';
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const ARENA_TOURNAMENT_KEY = 'game:arena:tournament';
const ARENA_ACTIVE_FIGHTS_KEY = 'game:arena:active-fights';
const CLAN_PET_BATTLE_PREFIX = 'game:clan-pet-battle:';
const WEEKLY_BOSS_OVERRIDE_KEY = 'game:weekly-boss-override';

function clanPetBattleKey(clanName: string) {
    return `${CLAN_PET_BATTLE_PREFIX}${clanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            const [villageStateKeys, leadershipImages, arenaTournament, arenaActiveFights, clanPetBattleKeys, weeklyBossAiId] = await Promise.all([
                kv.keys(`${VILLAGE_STATE_PREFIX}*`),
                kv.get<Record<string, unknown>>(LEADERSHIP_IMAGES_KEY),
                kv.get<unknown>(ARENA_TOURNAMENT_KEY),
                kv.get<unknown[]>(ARENA_ACTIVE_FIGHTS_KEY),
                kv.keys(`${CLAN_PET_BATTLE_PREFIX}*`),
                kv.get<string>(WEEKLY_BOSS_OVERRIDE_KEY),
            ]);

            const villageStates: Record<string, unknown> = {};
            if (villageStateKeys.length > 0) {
                // mget fetches all values in one round-trip instead of N individual gets.
                const stateValues = await kv.mget<unknown[]>(...villageStateKeys);
                villageStateKeys.forEach((k, i) => {
                    if (stateValues[i] != null) {
                        const name = k.slice(VILLAGE_STATE_PREFIX.length);
                        villageStates[name] = stateValues[i];
                    }
                });
            }

            const clanPetBattles: Record<string, unknown> = {};
            if (clanPetBattleKeys.length > 0) {
                // mget fetches all values in one round-trip instead of N individual gets.
                const battleValues = await kv.mget<unknown[]>(...clanPetBattleKeys);
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
            res.setHeader('Cache-Control', 's-maxage=8, stale-while-revalidate=5');
            return res.status(200).json({
                villageStates,
                villageLeadershipImages: leadershipImages ?? null,
                arenaTournament: arenaTournament ?? null,
                arenaActiveFights: Array.isArray(arenaActiveFights) ? arenaActiveFights : [],
                clanPetBattles,
                weeklyBossAiId: weeklyBossAiId ?? null,
            });
        } catch (err) {
            console.error('[game-state]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind } = body as { kind?: string };

            // Non-sensitive kinds that any client can write (no auth needed)
            const openKinds = new Set(['arenaActiveFights', 'villageState', 'pendingClanPetBattle']);

            // Everything else needs auth
            let identity: { admin?: boolean; name?: string } | null = null;
            if (!openKinds.has(String(kind))) {
                identity = await authedPlayerOrAdmin(req);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });

                // Admin-only kinds — wholesale state writes
                const adminOnlyKinds = new Set(['villageLeadershipImages', 'arenaTournament', 'weeklyBossOverride']);
                if (adminOnlyKinds.has(String(kind)) && !identity.admin) {
                    return res.status(403).json({ error: 'Admin only.' });
                }
            }

            if (kind === 'villageState') {
                const { village, state } = body as { village?: string; state?: unknown };
                if (!village || !state) return res.status(400).json({ error: 'Missing village or state.' });
                const key = `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                await kv.set(key, state);
                return res.status(200).json({ ok: true });
            }

            if (kind === 'villageLeadershipImages') {
                const { images } = body as { images?: unknown };
                if (!images) return res.status(400).json({ error: 'Missing images.' });
                await kv.set(LEADERSHIP_IMAGES_KEY, images);
                return res.status(200).json({ ok: true });
            }

            if (kind === 'arenaTournament') {
                const { tournament } = body as { tournament?: unknown };
                if (tournament == null) {
                    await kv.del(ARENA_TOURNAMENT_KEY);
                } else {
                    await kv.set(ARENA_TOURNAMENT_KEY, tournament);
                }
                return res.status(200).json({ ok: true });
            }

            if (kind === 'arenaActiveFights') {
                const { fights } = body as { fights?: unknown[] };
                if (!Array.isArray(fights)) return res.status(400).json({ error: 'Missing fights array.' });
                await kv.set(ARENA_ACTIVE_FIGHTS_KEY, fights.slice(0, 20));
                return res.status(200).json({ ok: true });
            }

            if (kind === 'pendingClanPetBattle') {
                const { clanName, battle } = body as { clanName?: string; battle?: unknown };
                if (!clanName) return res.status(400).json({ error: 'Missing clanName.' });
                const key = clanPetBattleKey(clanName);
                if (battle == null) {
                    await kv.del(key);
                } else {
                    await kv.set(key, battle, { ex: 24 * 60 * 60 }); // 24-hour TTL
                }
                return res.status(200).json({ ok: true });
            }

            if (kind === 'weeklyBossOverride') {
                if (!identity?.admin) return res.status(403).json({ error: 'Admin only.' });
                const { aiId } = body as { aiId?: string | null };
                if (aiId) {
                    await kv.set(WEEKLY_BOSS_OVERRIDE_KEY, aiId);
                } else {
                    await kv.del(WEEKLY_BOSS_OVERRIDE_KEY);
                }
                return res.status(200).json({ ok: true });
            }

            return res.status(400).json({ error: 'Unknown kind.' });
        } catch (err) {
            console.error('[game-state]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
