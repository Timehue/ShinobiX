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
// Anti-cheat: cap how much HP a single raid request can drain so a malicious
// client can't drop a sector from full → 0 in one POST. Matches the 500/raid
// hit the legitimate Village War client UI deals.
const TERRITORY_HP_MAX_DELTA_PER_REQUEST = 1000;
// Same idea for raising HP via rebuild — bound the per-request gain.
const TERRITORY_HP_MAX_REPAIR_PER_REQUEST = 1000;
const VILLAGE_STATE_KEY_PREFIX = 'game:village-state:';

function normalizeVillageKey(village: string): string {
    return village.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function isSeatedKageOf(playerName: string, village: string): Promise<boolean> {
    if (!village) return false;
    try {
        const vs = await kv.get<Record<string, unknown>>(`${VILLAGE_STATE_KEY_PREFIX}${normalizeVillageKey(village)}`);
        const seated = String(vs?.seatedKage ?? '').trim().toLowerCase();
        return seated === playerName.trim().toLowerCase();
    } catch {
        return false;
    }
}

async function hasActiveWarBetween(actorVillage: string, defenderVillage: string): Promise<boolean> {
    if (!actorVillage || !defenderVillage) return false;
    try {
        const id = villageWarId(actorVillage, defenderVillage);
        const war = await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${id}`);
        if (!war || war.endedAt) return false;
        return war.villages.includes(actorVillage) && war.villages.includes(defenderVillage);
    } catch {
        return false;
    }
}

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

                // Participation gate. Three valid writer cases:
                //   1. Actor matches the claiming clan/village (defender / claimant)
                //   2. Actor matches the PREVIOUS owner (rebuilding own sector)
                //   3. Actor's village has an active war with the current owner village
                //      (raider during an active village war)
                // After identity is confirmed we also enforce a per-request HP delta
                // cap so a malicious client can't drop a sector to 0 in one POST.
                let prev: SectorTerritory | null = null;
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

                        prev = await kv.get<SectorTerritory>(`${TERRITORY_KEY_PREFIX}${incomingTerritory.sector}`);
                        const prevClan = String(prev?.ownerClan ?? '').trim();
                        const prevVillage = String(prev?.ownerVillage ?? '').trim();
                        const actorOwnsPrev =
                            (prevClan && actorClan === prevClan) ||
                            (prevVillage && actorVillage === prevVillage);

                        // Raider case: actor's village is currently AT WAR with the owner village.
                        let raiderDuringWar = false;
                        if (!matchesClan && !matchesVillage && !actorOwnsPrev && prevVillage && actorVillage && actorVillage !== prevVillage) {
                            raiderDuringWar = await hasActiveWarBetween(actorVillage, prevVillage);
                        }

                        const actorInvolved = matchesClan || matchesVillage || actorOwnsPrev || raiderDuringWar;
                        if (!actorInvolved) {
                            return res.status(403).json({ error: 'You are not a participant in this sector (no active war with the owner village).' });
                        }

                        // Per-request HP delta cap — applies to all non-admin writers.
                        const prevHp = Number(prev?.hp ?? TERRITORY_HP_MAX);
                        const newHp = incomingTerritory.hp;
                        if (newHp < prevHp - TERRITORY_HP_MAX_DELTA_PER_REQUEST) {
                            return res.status(400).json({ error: `HP can only drop by ${TERRITORY_HP_MAX_DELTA_PER_REQUEST} per request.` });
                        }
                        if (newHp > prevHp + TERRITORY_HP_MAX_REPAIR_PER_REQUEST) {
                            return res.status(400).json({ error: `HP can only rise by ${TERRITORY_HP_MAX_REPAIR_PER_REQUEST} per request.` });
                        }
                        // Raiders may not increase HP (only defenders / owners may rebuild).
                        if (raiderDuringWar && newHp > prevHp) {
                            return res.status(400).json({ error: 'Raiders may not rebuild the enemy sector.' });
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

                // Non-admin rules:
                //   • Creating or ENDING a war (winner / endedAt / capturedBy)
                //     requires the actor to be the seated Kage of one of the
                //     warring villages.
                //   • Routine mid-war updates (HP changes from raids, etc.) are
                //     allowed for any member of either warring village.
                if (!identity.admin) {
                    try {
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const actorVillage = String(actorChar?.village ?? '').trim();
                        if (!actorVillage || !war.villages.includes(actorVillage)) {
                            return res.status(403).json({ error: 'Only members of the warring villages can update this war.' });
                        }

                        const existing = await kv.get<VillageWar>(`${VILLAGE_WAR_KEY_PREFIX}${war.id}`);
                        const isCreating = !existing;
                        const isEnding = !existing?.endedAt && !!war.endedAt;
                        const isClaimingWin = !existing?.winnerVillage && !!war.winnerVillage;
                        const isClaimingCapture = !existing?.capturedBy && !!war.capturedBy;

                        if (isCreating) {
                            // Only Kage of a warring village may declare war.
                            const kage = await isSeatedKageOf(identity.name, actorVillage);
                            if (!kage) {
                                return res.status(403).json({ error: 'Only the seated Kage of a warring village can declare a war.' });
                            }
                        } else if (isEnding || isClaimingWin || isClaimingCapture) {
                            // Allow ending if the actor is Kage OR if the legitimate
                            // win condition is satisfied — the war-ground sector's HP
                            // is 0 in the persisted territory record. This lets the
                            // final-blow raider claim victory without needing Kage
                            // status, while still rejecting fake "I won" claims.
                            const kage = await isSeatedKageOf(identity.name, actorVillage);
                            if (!kage) {
                                const groundSector = existing?.warGroundSector ?? war.warGroundSector;
                                const groundTerritory = await kv.get<SectorTerritory>(`${TERRITORY_KEY_PREFIX}${groundSector}`);
                                const groundHp = Number(groundTerritory?.hp ?? TERRITORY_HP_MAX);
                                const winnerVillage = war.winnerVillage ?? war.capturedBy;
                                const legitimateWin = groundHp <= 0 && winnerVillage === actorVillage;
                                if (!legitimateWin) {
                                    return res.status(403).json({ error: 'War can only be ended by the Kage or when the war ground is actually captured.' });
                                }
                            }
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
