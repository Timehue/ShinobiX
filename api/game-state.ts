import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from './_utils.js';

const LEADERSHIP_IMAGES_KEY = 'game:village-leadership-images';
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const ARENA_TOURNAMENT_KEY = 'game:arena:tournament';
const ARENA_ACTIVE_FIGHTS_KEY = 'game:arena:active-fights';
const CLAN_PET_BATTLE_PREFIX = 'game:clan-pet-battle:';

function clanPetBattleKey(clanName: string) {
    return `${CLAN_PET_BATTLE_PREFIX}${clanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            const [villageStateKeys, leadershipImages, arenaTournament, arenaActiveFights, clanPetBattleKeys] = await Promise.all([
                kv.keys(`${VILLAGE_STATE_PREFIX}*`),
                kv.get<Record<string, unknown>>(LEADERSHIP_IMAGES_KEY),
                kv.get<unknown>(ARENA_TOURNAMENT_KEY),
                kv.get<unknown[]>(ARENA_ACTIVE_FIGHTS_KEY),
                kv.keys(`${CLAN_PET_BATTLE_PREFIX}*`),
            ]);

            const villageStates: Record<string, unknown> = {};
            if (villageStateKeys.length > 0) {
                const stateValues = await Promise.all(villageStateKeys.map(k => kv.get<unknown>(k)));
                villageStateKeys.forEach((k, i) => {
                    const name = k.slice(VILLAGE_STATE_PREFIX.length);
                    villageStates[name] = stateValues[i];
                });
            }

            const clanPetBattles: Record<string, unknown> = {};
            if (clanPetBattleKeys.length > 0) {
                const battleValues = await Promise.all(clanPetBattleKeys.map(k => kv.get<unknown>(k)));
                clanPetBattleKeys.forEach((k, i) => {
                    const name = k.slice(CLAN_PET_BATTLE_PREFIX.length);
                    clanPetBattles[name] = battleValues[i];
                });
            }

            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                villageStates,
                villageLeadershipImages: leadershipImages ?? null,
                arenaTournament: arenaTournament ?? null,
                arenaActiveFights: Array.isArray(arenaActiveFights) ? arenaActiveFights : [],
                clanPetBattles,
            });
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind } = body as { kind?: string };

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

            return res.status(400).json({ error: 'Unknown kind.' });
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}
