import { kv } from './_storage.js';
import { cors } from './_utils.js';
const TERRITORY_CONTROL_MAX = 20000;
const TERRITORY_HP_MAX = 20000;
const VILLAGE_WAR_HP_MAX = 5000;
const VILLAGE_WAR_GROUND_HP_MAX = 1000;
const TERRITORY_KEY_PREFIX = 'world:territory:';
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';
function clampNumber(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, value));
}
function defaultSectorTerritory(sector) {
    return {
        sector,
        controlScore: 0,
        hp: TERRITORY_HP_MAX,
        terrainBuffStat: 'bukijutsuOffense',
        guards: [],
        warSupply: 0,
        updatedAt: Date.now(),
    };
}
function normalizeSectorTerritory(data) {
    const sector = clampNumber(Math.floor(Number(data.sector ?? 1)), 1, 60);
    return {
        ...defaultSectorTerritory(sector),
        ...data,
        sector,
        controlScore: clampNumber(Math.floor(Number(data.controlScore ?? 0)), 0, TERRITORY_CONTROL_MAX),
        hp: clampNumber(Math.floor(Number(data.hp ?? TERRITORY_HP_MAX)), 0, TERRITORY_HP_MAX),
        guards: Array.isArray(data.guards) ? data.guards.filter(Boolean).map(String).slice(0, 20) : [],
        warSupply: Math.max(0, Math.floor(Number(data.warSupply ?? 0))),
        terrainBuffStat: (data.terrainBuffStat ?? 'bukijutsuOffense'),
        updatedAt: data.updatedAt ?? Date.now(),
    };
}
function villageWarId(villageA, villageB) {
    return [villageA, villageB]
        .sort((a, b) => a.localeCompare(b))
        .map(village => village.toLowerCase().replace(/[^a-z0-9]/g, ''))
        .join('-vs-');
}
function normalizeVillageWar(data) {
    if (!Array.isArray(data.villages) || data.villages.length !== 2)
        return null;
    const [first, second] = data.villages.map(String);
    if (!first || !second || first === second)
        return null;
    return {
        id: data.id ?? villageWarId(first, second),
        villages: [first, second],
        hp: {
            [first]: clampNumber(Math.floor(Number(data.hp?.[first] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_MAX),
            [second]: clampNumber(Math.floor(Number(data.hp?.[second] ?? VILLAGE_WAR_HP_MAX)), 0, VILLAGE_WAR_HP_MAX),
        },
        warGroundSector: clampNumber(Math.floor(Number(data.warGroundSector ?? 40)), 1, 60),
        warGroundHp: clampNumber(Math.floor(Number(data.warGroundHp ?? VILLAGE_WAR_GROUND_HP_MAX)), 0, VILLAGE_WAR_GROUND_HP_MAX),
        startedAt: data.startedAt ?? Date.now(),
        updatedAt: data.updatedAt ?? Date.now(),
        capturedBy: data.capturedBy,
        capturedAt: data.capturedAt,
        winnerVillage: data.winnerVillage,
        endedAt: data.endedAt,
    };
}
async function getByPrefix(prefix) {
    try {
        const keys = await kv.keys(`${prefix}*`);
        if (!keys.length)
            return [];
        const values = await Promise.all(keys.map(key => kv.get(key)));
        return values.filter(Boolean);
    }
    catch {
        return [];
    }
}
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        const [territories, wars] = await Promise.all([
            getByPrefix(TERRITORY_KEY_PREFIX),
            getByPrefix(VILLAGE_WAR_KEY_PREFIX),
        ]);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ territories, wars });
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            if (body?.kind === 'territory') {
                const territory = normalizeSectorTerritory({ ...body.territory, updatedAt: Date.now() });
                await kv.set(`${TERRITORY_KEY_PREFIX}${territory.sector}`, territory);
                return res.status(200).json({ territory });
            }
            if (body?.kind === 'war') {
                const war = normalizeVillageWar({ ...body.war, updatedAt: Date.now() });
                if (!war)
                    return res.status(400).json({ error: 'Invalid war.' });
                await kv.set(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`, war);
                return res.status(200).json({ war });
            }
            return res.status(400).json({ error: 'Invalid world state update.' });
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }
    return res.status(405).end();
}
