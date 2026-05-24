import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';

const TERRITORY_CONTROL_MAX = 20000;
const TERRITORY_HP_MAX = 20000;
const VILLAGE_WAR_HP_MAX = 5000;
const VILLAGE_WAR_GROUND_HP_MAX = 1000;
const TERRITORY_KEY_PREFIX = 'world:territory:';
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';

type TerritoryBuffStat = 'bukijutsuOffense' | 'taijutsuOffense' | 'ninjutsuOffense' | 'genjutsuOffense';
type WeatherType = 'clear' | 'rain' | 'thunderstorm' | 'ashfall' | 'tornado' | 'desertHaze';

const VALID_TERRAIN_BUFF_STATS: ReadonlySet<TerritoryBuffStat> = new Set<TerritoryBuffStat>([
    'bukijutsuOffense', 'taijutsuOffense', 'ninjutsuOffense', 'genjutsuOffense',
]);

function normalizeTerrainBuffStat(value: unknown): TerritoryBuffStat {
    if (typeof value === 'string' && VALID_TERRAIN_BUFF_STATS.has(value as TerritoryBuffStat)) {
        return value as TerritoryBuffStat;
    }
    return 'bukijutsuOffense';
}

type SectorTerritory = {
    sector: number;
    ownerClan?: string;
    ownerVillage?: string;
    backgroundImage?: string;
    controlScore: number;
    hp: number;
    weather?: WeatherType;
    terrainBuffStat: TerritoryBuffStat;
    guards: string[];
    warSupply: number;
    lastSupplyAt?: number;
    rebuiltAt?: number;
    updatedAt: number;
};

type VillageWar = {
    id: string;
    villages: [string, string];
    hp: Record<string, number>;
    warGroundSector: number;
    warGroundHp: number;
    startedAt: number;
    updatedAt: number;
    capturedBy?: string;
    capturedAt?: number;
    winnerVillage?: string;
    endedAt?: number;
};

function clampNumber(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function defaultSectorTerritory(sector: number): SectorTerritory {
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

function normalizeSectorTerritory(data: Partial<SectorTerritory>): SectorTerritory {
    const sector = clampNumber(Math.floor(Number(data.sector ?? 1)), 1, 60);
    return {
        ...defaultSectorTerritory(sector),
        ...data,
        sector,
        controlScore: clampNumber(Math.floor(Number(data.controlScore ?? 0)), 0, TERRITORY_CONTROL_MAX),
        hp: clampNumber(Math.floor(Number(data.hp ?? TERRITORY_HP_MAX)), 0, TERRITORY_HP_MAX),
        guards: Array.isArray(data.guards) ? data.guards.filter(Boolean).map(String).slice(0, 20) : [],
        warSupply: Math.max(0, Math.floor(Number(data.warSupply ?? 0))),
        terrainBuffStat: normalizeTerrainBuffStat(data.terrainBuffStat),
        updatedAt: data.updatedAt ?? Date.now(),
    };
}

function villageWarId(villageA: string, villageB: string) {
    return [villageA, villageB]
        .sort((a, b) => a.localeCompare(b))
        .map(village => village.toLowerCase().replace(/[^a-z0-9]/g, ''))
        .join('-vs-');
}

function normalizeVillageWar(data: Partial<VillageWar> & { villages?: [string, string] }): VillageWar | null {
    if (!Array.isArray(data.villages) || data.villages.length !== 2) return null;
    const [first, second] = data.villages.map(String) as [string, string];
    if (!first || !second || first === second) return null;
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

async function getByPrefix<T>(prefix: string) {
    try {
        const keys = await kv.keys(`${prefix}*`);
        if (!keys.length) return [];
        // Use mget to fetch all values in one round-trip instead of N individual gets.
        const values = await kv.mget<T[]>(...keys);
        return values.filter(Boolean) as T[];
    } catch {
        return [];
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const [territories, wars] = await Promise.all([
            getByPrefix<SectorTerritory>(TERRITORY_KEY_PREFIX),
            getByPrefix<VillageWar>(VILLAGE_WAR_KEY_PREFIX),
        ]);
        // CDN caches this for 15 s so all players polling every 15 s share
        // one Supabase round-trip per window instead of one per player.
        // stale-while-revalidate=10 keeps the response instant while revalidating.
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=10');
        return res.status(200).json({ territories, wars });
    }

    if (req.method === 'POST') {
        // Require a logged-in player at minimum. We also gate territory and
        // war writes to participants (or admin) — see per-kind checks below.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            if (body?.kind === 'territory') {
                const incomingTerritory = normalizeSectorTerritory({ ...body.territory, updatedAt: Date.now() });

                // Participation gate: non-admin writers must (a) match the
                // claiming clan or village of the territory they're updating,
                // AND (b) hp / controlScore changes must move monotonically
                // toward zero (damage) OR away from zero only if the writer
                // already owned the sector (rebuild). We accept either
                // direction as long as the actor is the relevant participant.
                if (!identity.admin) {
                    try {
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const actorClan = String(actorChar?.clan ?? '').trim();
                        const actorVillage = String(actorChar?.village ?? '').trim();
                        const claimingClan = String(incomingTerritory.ownerClan ?? '').trim();
                        const claimingVillage = String(incomingTerritory.ownerVillage ?? '').trim();
                        const matchesClan = !!claimingClan && actorClan === claimingClan;
                        const matchesVillage = !!claimingVillage && actorVillage === claimingVillage;

                        // Read the previous territory record so we can compare
                        // HP / controlScore deltas — only actors involved in
                        // the relevant village/clan may write.
                        const prev = await kv.get<SectorTerritory>(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`);
                        const prevClan = String(prev?.ownerClan ?? '').trim();
                        const prevVillage = String(prev?.ownerVillage ?? '').trim();
                        const actorInvolved =
                            matchesClan || matchesVillage ||
                            (prevClan && actorClan === prevClan) ||
                            (prevVillage && actorVillage === prevVillage);
                        if (!actorInvolved) {
                            return res.status(403).json({ error: 'Only clan/village participants can update this territory.' });
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify territory participation.' });
                    }
                }

                await kv.set(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`, incomingTerritory);
                return res.status(200).json({ territory: incomingTerritory });
            }

            if (body?.kind === 'war') {
                const war = normalizeVillageWar({ ...body.war, updatedAt: Date.now() });
                if (!war) return res.status(400).json({ error: 'Invalid war.' });

                // Non-admin: actor must belong to one of the two participating villages.
                if (!identity.admin) {
                    try {
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const actorVillage = String(actorChar?.village ?? '').trim();
                        if (!actorVillage || !war.villages.includes(actorVillage)) {
                            return res.status(403).json({ error: 'Only members of the warring villages can update this war.' });
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify war participation.' });
                    }
                }

                await kv.set(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`, war);
                return res.status(200).json({ war });
            }

            return res.status(400).json({ error: 'Invalid world state update.' });
        } catch (err) {
            console.error('[world-state]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
