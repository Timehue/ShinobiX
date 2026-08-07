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
    isSectorWarActive,
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

export async function saveSectorWar(session: SectorWarSession, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
        await kv.set(sectorWarKey(session.id), session, { ex: Math.ceil(ttlSeconds) } as never);
    } else {
        await kv.set(sectorWarKey(session.id), session);
    }
}

export async function deleteSectorWar(id: string): Promise<void> {
    await kv.del(sectorWarKey(id));
}

/** Every war still LIVE on the board — not settled, not conceded, and inside its
 *  72h window (small scan; mirrors the territory scan in claim-map-control.ts).
 *
 *  The endsAt filter matters: a war whose window closed but whose verdict is not
 *  yet stamped must already read as OVER — it can't block the one-war-per-sector
 *  rule, count toward the attack-siege cap, or keep its village "at war" in the
 *  daily pass. This is a pure read — settlement (api/_sector-war-settle.ts)
 *  stamps the verdicts. */
export async function listActiveSectorWars(now: number = Date.now()): Promise<SectorWarSession[]> {
    const keys = await kv.keys(`${SECTOR_WAR_PREFIX}*`);
    if (!keys.length) return [];
    const raws = await kv.mget<Partial<SectorWarSession>[]>(...keys);
    const out: SectorWarSession[] = [];
    for (const raw of raws) {
        const s = raw ? normalizeSectorWarSession(raw) : null;
        if (s && isSectorWarActive(s, now)) out.push(s);
    }
    return out;
}

/** The active contest on a given sector, if any (a sector hosts at most one). */
export async function activeContestOnSector(sector: number, now: number = Date.now()): Promise<SectorWarSession | null> {
    const all = await listActiveSectorWars(now);
    return all.find((s) => s.sector === sector) ?? null;
}

/** Every contest a village is currently attacking or defending. Used to enforce
 *  the village-war ↔ sector-war mutual exclusion in BOTH directions. */
export async function activeSectorWarsForVillage(village: string, now: number = Date.now()): Promise<SectorWarSession[]> {
    const name = String(village ?? '').trim();
    if (!name) return [];
    const all = await listActiveSectorWars(now);
    return all.filter((s) => s.attackerVillage === name || s.defenderVillage === name);
}

/** Every war whose 72 hours have elapsed but whose verdict is not yet stamped.
 *  A dumb read — SETTLEMENT (locks, the territory flip, telemetry) lives in
 *  api/_sector-war-settle.ts, which cannot be here: world-state.ts imports this
 *  store, so importing captureSectorForVillage back would be a cycle. */
export async function listUnsettledDueSectorWars(now: number = Date.now()): Promise<SectorWarSession[]> {
    const keys = await kv.keys(`${SECTOR_WAR_PREFIX}*`);
    if (!keys.length) return [];
    const raws = await kv.mget<Partial<SectorWarSession>[]>(...keys);
    const out: SectorWarSession[] = [];
    for (const raw of raws) {
        const s = raw ? normalizeSectorWarSession(raw) : null;
        if (s && !s.flipped && !s.expiredAt && now >= s.endsAt) out.push(s);
    }
    return out;
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
