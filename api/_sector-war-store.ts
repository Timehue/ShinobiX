/*
 * Village War Map — sector-war IO glue (Phase 4c).
 *
 * Thin persistence primitives for the two record families the sector-war loop
 * uses, on top of the pure model in `_sector-war.ts`:
 *   - the contest:  `shared:sector-war:<id>`        (the Control-HP siege state)
 *   - the token:    `shared:sector-war-token:<bid>` (single-use battle authorization)
 *
 * All orchestration (locks, WR debit, the territory flip) lives in the endpoint
 * `api/village/sector-war.ts`; this file only reads/writes the records. Behind
 * ENABLE_VILLAGE_WAR via its only caller — nothing imports it on the prod path.
 *
 * Note the prefixes don't collide: a `keys('shared:sector-war:*')` scan matches
 * `shared:sector-war:<id>` but NOT `shared:sector-war-token:<bid>` (the char after
 * `shared:sector-war` is `:` for contests, `-` for tokens).
 */

import { kv } from './_storage.js';
import {
    sectorWarKey,
    sectorWarTokenKey,
    normalizeSectorWarSession,
    normalizeSectorWarBattleToken,
    SECTOR_WAR_TOKEN_TTL_MS,
    type SectorWarSession,
    type SectorWarBattleToken,
} from './_sector-war.js';

const SECTOR_WAR_PREFIX = 'shared:sector-war:';
// Mirror of api/world-state.ts TERRITORY_KEY_PREFIX (module-local there). The
// territory record is the source of truth for `ownerVillage`.
const TERRITORY_KEY_PREFIX = 'world:territory:';

// ── Contest (the Control-HP siege record) ──

export async function loadSectorWar(id: string): Promise<SectorWarSession | null> {
    const raw = await kv.get<Partial<SectorWarSession>>(sectorWarKey(id));
    return raw ? normalizeSectorWarSession(raw) : null;
}

export async function saveSectorWar(session: SectorWarSession): Promise<void> {
    await kv.set(sectorWarKey(session.id), session);
}

export async function deleteSectorWar(id: string): Promise<void> {
    await kv.del(sectorWarKey(id));
}

/** Every non-flipped contest currently on the board (small scan; mirrors the
 *  territory scan in api/village/claim-map-control.ts). */
export async function listActiveSectorWars(): Promise<SectorWarSession[]> {
    const keys = await kv.keys(`${SECTOR_WAR_PREFIX}*`);
    if (!keys.length) return [];
    const raws = await kv.mget<Partial<SectorWarSession>[]>(...keys);
    const out: SectorWarSession[] = [];
    for (const raw of raws) {
        const s = raw ? normalizeSectorWarSession(raw) : null;
        if (s && !s.flipped) out.push(s);
    }
    return out;
}

/** The active contest on a given sector, if any (a sector hosts at most one). */
export async function activeContestOnSector(sector: number): Promise<SectorWarSession | null> {
    const all = await listActiveSectorWars();
    return all.find((s) => s.sector === sector) ?? null;
}

// ── Single-use battle token ──

export async function mintSectorWarToken(token: SectorWarBattleToken): Promise<void> {
    await kv.set(sectorWarTokenKey(token.battleId), token, { ex: Math.ceil(SECTOR_WAR_TOKEN_TTL_MS / 1000) });
}

export async function loadSectorWarToken(battleId: string): Promise<SectorWarBattleToken | null> {
    const raw = await kv.get<Partial<SectorWarBattleToken>>(sectorWarTokenKey(battleId));
    return raw ? normalizeSectorWarBattleToken(raw) : null;
}

/** Single-use consumption — delete the token so a battle counts exactly once. */
export async function consumeSectorWarToken(battleId: string): Promise<void> {
    await kv.del(sectorWarTokenKey(battleId));
}

// ── Territory ownership read (source of truth for the declare target) ──

/** The village that currently owns a sector (`''` if unowned/unseeded). */
export async function getSectorOwnerVillage(sector: number): Promise<string> {
    const t = await kv.get<{ ownerVillage?: string }>(`${TERRITORY_KEY_PREFIX}${Math.floor(Number(sector) || 0)}`);
    return String(t?.ownerVillage ?? '').trim();
}
