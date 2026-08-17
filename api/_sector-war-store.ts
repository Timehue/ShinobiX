/*
 * Village War Map — sector-war IO glue (Phase 4c).
 *
 * Thin persistence primitives for the two record families the sector-war loop
 * uses, on top of the pure model in `_sector-war.ts`:
 *   - the contest:  `shared:sector-war:<id>`        (the Control-HP siege state)
 *   - the token:    `shared:sector-war-token:<bid>` (single-use battle authorization)
 *
 * All orchestration (locks, WR debit, the territory flip) lives in the endpoint
 * `api/village/sector-war.ts`; this file only reads/writes the records. Its
 * production callers are protected by the default-on Sector Map campaign gate.
 *
 * Note the prefixes don't collide: a `keys('shared:sector-war:*')` scan matches
 * `shared:sector-war:<id>` but NOT `shared:sector-war-token:<bid>` (the char after
 * `shared:sector-war` is `:` for contests, `-` for tokens).
 */

import { isDeepStrictEqual } from 'node:util';
import { kv, type KvLike } from './_storage.js';
import {
    sectorWarKey,
    sectorWarTokenKey,
    normalizeSectorWarSession,
    normalizeSectorWarBattleToken,
    findSectorWarBattleReceipt,
    isSectorWarActive,
    SECTOR_WAR_TOKEN_TTL_MS,
    type SectorWarSession,
    type SectorWarBattleToken,
    type SectorWarBattleReceipt,
} from './_sector-war.js';

const SECTOR_WAR_PREFIX = 'shared:sector-war:';
// Mirror of api/world-state.ts TERRITORY_KEY_PREFIX (module-local there). The
// territory record is the source of truth for `ownerVillage`.
const TERRITORY_KEY_PREFIX = 'world:territory:';
const SECTOR_WAR_RESOLUTION_TTL_SECONDS = 48 * 60 * 60;

export type SectorWarResolutionReceipt = {
    version: 1;
    battleId: string;
    p1Name: string;
    p2Name: string;
    sessionCreatedAt: number;
    sessionEndedAt: number;
    outcome: 'applied' | 'superseded' | 'not-applicable';
    sectorWarId: string | null;
    attackerWon: boolean | null;
    points: number;
    attackerPoints: number | null;
    defenderPoints: number | null;
};

export function sectorWarResolutionReceiptKey(battleId: string): string {
    return `shared:sector-war-resolution:${battleId}`;
}

function parseSectorWarResolutionReceipt(raw: unknown): SectorWarResolutionReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).sort().join('|') !== [
        'attackerPoints', 'attackerWon', 'battleId', 'defenderPoints', 'outcome',
        'p1Name', 'p2Name', 'points', 'sectorWarId', 'sessionCreatedAt',
        'sessionEndedAt', 'version',
    ].sort().join('|')) return null;
    if (value.version !== 1
        || typeof value.battleId !== 'string' || !value.battleId
        || typeof value.p1Name !== 'string' || !value.p1Name
        || typeof value.p2Name !== 'string' || !value.p2Name
        || !Number.isSafeInteger(value.sessionCreatedAt) || Number(value.sessionCreatedAt) <= 0
        || !Number.isSafeInteger(value.sessionEndedAt) || Number(value.sessionEndedAt) < Number(value.sessionCreatedAt)
        || !['applied', 'superseded', 'not-applicable'].includes(String(value.outcome))
        || !(value.sectorWarId === null || (typeof value.sectorWarId === 'string' && value.sectorWarId))
        || !(value.attackerWon === null || typeof value.attackerWon === 'boolean')
        || !Number.isSafeInteger(value.points) || Number(value.points) < 0
        || !(value.attackerPoints === null || (Number.isSafeInteger(value.attackerPoints) && Number(value.attackerPoints) >= 0))
        || !(value.defenderPoints === null || (Number.isSafeInteger(value.defenderPoints) && Number(value.defenderPoints) >= 0))) {
        return null;
    }
    if (value.outcome === 'applied') {
        if (typeof value.sectorWarId !== 'string'
            || typeof value.attackerWon !== 'boolean'
            || value.attackerPoints === null
            || value.defenderPoints === null) return null;
    } else if (value.points !== 0) {
        return null;
    }
    return value as SectorWarResolutionReceipt;
}

export async function loadSectorWarResolutionReceipt(
    battleId: string,
    store: Pick<KvLike, 'get'> = kv,
): Promise<SectorWarResolutionReceipt | null> {
    const raw = await store.get<unknown>(sectorWarResolutionReceiptKey(battleId));
    if (raw === null) return null;
    const parsed = parseSectorWarResolutionReceipt(raw);
    if (!parsed) throw new Error('sector-war-resolution-receipt-invalid');
    return parsed;
}

export async function commitSectorWarResolutionReceipt(
    receipt: SectorWarResolutionReceipt,
    store: Pick<KvLike, 'get' | 'compareSet'> = kv,
): Promise<SectorWarResolutionReceipt> {
    if (!parseSectorWarResolutionReceipt(receipt)) throw new Error('sector-war-resolution-receipt-invalid');
    const key = sectorWarResolutionReceiptKey(receipt.battleId);
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const currentRaw = await store.get<unknown>(key);
        if (currentRaw !== null) {
            const current = parseSectorWarResolutionReceipt(currentRaw);
            if (!current) throw new Error('sector-war-resolution-receipt-invalid');
            if (!isDeepStrictEqual(current, receipt)) throw new Error('sector-war-resolution-receipt-conflict');
            return current;
        }
        try {
            if (await store.compareSet(key, null, receipt, { ex: SECTOR_WAR_RESOLUTION_TTL_SECONDS })) {
                return receipt;
            }
        } catch (error) {
            const recovered = await store.get<unknown>(key).catch(() => null);
            if (isDeepStrictEqual(recovered, receipt)) return receipt;
            throw error;
        }
    }
    throw new Error('sector-war-resolution-receipt-busy');
}

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

/** Hidden row-first declarations for recovery/abort. These never appear in the
 * active scan, so the declare route must discover them independently when the
 * territory owner embedded in the contest id changed while a process was down. */
export async function listFundingSectorWars(
    store: Pick<KvLike, 'keys' | 'mget'> = kv,
): Promise<SectorWarSession[]> {
    const keys = await store.keys(`${SECTOR_WAR_PREFIX}*`);
    if (!keys.length) return [];
    const raws = await store.mget<Partial<SectorWarSession>[]>(...keys);
    const out: SectorWarSession[] = [];
    for (const raw of raws) {
        const session = raw ? normalizeSectorWarSession(raw) : null;
        if (session?.declarationFunding?.status === 'funding') out.push(session);
    }
    return out;
}

/**
 * Recover an embedded PvP score without its shorter-lived registration token.
 * The external per-battle receipt is normally written immediately after the
 * contest CAS, but a process can stop in that gap. The contest ledger is the
 * atomic side-effect proof and therefore must be discoverable independently.
 */
export async function findSectorWarAppliedBattle(
    battleId: string,
    store: Pick<KvLike, 'keys' | 'mget'> = kv,
): Promise<{ session: SectorWarSession; receipt: SectorWarBattleReceipt } | null> {
    const exactBattleId = String(battleId ?? '').trim();
    if (!exactBattleId) throw new Error('sector-war-battle-receipt-invalid');
    const keys = await store.keys(`${SECTOR_WAR_PREFIX}*`);
    if (!keys.length) return null;
    const raws = await store.mget<Partial<SectorWarSession>[]>(...keys);
    let found: { session: SectorWarSession; receipt: SectorWarBattleReceipt } | null = null;
    for (const raw of raws) {
        if (!raw || !Array.isArray(raw.appliedBattles)) continue;
        const exactRows = raw.appliedBattles.filter((entry) => (
            !!entry
            && typeof entry === 'object'
            && !Array.isArray(entry)
            && (entry as { battleId?: unknown }).battleId === exactBattleId
        ));
        if (!exactRows.length) continue;
        if (exactRows.length !== 1) throw new Error('sector-war-battle-receipt-conflict');
        const exact = exactRows[0] as unknown as Record<string, unknown>;
        const allowed = new Set(['battleId', 'attackerWon', 'points', 'by', 'garrison', 'at']);
        if (Object.keys(exact).some((key) => !allowed.has(key))
            || typeof exact.attackerWon !== 'boolean'
            || !Number.isSafeInteger(exact.points) || Number(exact.points) < 0
            || typeof exact.by !== 'string'
            || !Number.isSafeInteger(exact.at) || Number(exact.at) <= 0
            || (exact.garrison !== undefined && exact.garrison !== true)) {
            throw new Error('sector-war-battle-receipt-invalid');
        }
        const session = normalizeSectorWarSession(raw);
        const receipt = session ? findSectorWarBattleReceipt(session, exactBattleId) : null;
        if (!session || !receipt) throw new Error('sector-war-battle-receipt-invalid');
        if (found) throw new Error('sector-war-battle-receipt-conflict');
        found = { session, receipt };
    }
    return found;
}

/** Every war whose 72 hours have elapsed but whose verdict is not yet stamped.
 *  A dumb read — SETTLEMENT (locks, the territory flip, telemetry) lives in
 *  api/_sector-war-settle.ts, which cannot be here: world-state.ts imports this
 *  store, so importing captureSectorForVillage back would be a cycle. */
export async function listUnsettledDueSectorWars(
    now: number = Date.now(),
    store: Pick<KvLike, 'keys' | 'mget'> = kv,
): Promise<SectorWarSession[]> {
    const keys = await store.keys(`${SECTOR_WAR_PREFIX}*`);
    if (!keys.length) return [];
    const raws = await store.mget<Partial<SectorWarSession>[]>(...keys);
    const out: SectorWarSession[] = [];
    for (const raw of raws) {
        const s = raw ? normalizeSectorWarSession(raw) : null;
        // Hidden row-first declarations are not contests yet. Settling a
        // `funding` row would stamp it defended before its exact source saga can
        // decide whether to abort or activate, and a later takeover could then
        // debit an already-terminal row. Legacy rows have no marker; new rows
        // become eligible only after receipt-backed activation.
        const fundedForPlay = !s?.declarationFunding || s.declarationFunding.status === 'active';
        if (s && fundedForPlay && !s.flipped && !s.expiredAt && now >= s.endsAt) out.push(s);
    }
    return out;
}



// ── Single-use battle token ──

export async function mintSectorWarToken(token: SectorWarBattleToken): Promise<void> {
    const key = sectorWarTokenKey(token.battleId);
    const current = await kv.get<unknown>(key);
    if (current !== null) {
        if (!isDeepStrictEqual(current, token)) throw new Error('sector-war-token-conflict');
        return;
    }
    try {
        if (await kv.compareSet(key, null, token, { ex: Math.ceil(SECTOR_WAR_TOKEN_TTL_MS / 1000) })) return;
    } catch (error) {
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, token)) return;
        throw error;
    }
    const recovered = await kv.get<unknown>(key);
    if (isDeepStrictEqual(recovered, token)) return;
    throw new Error('sector-war-token-conflict');
}

export async function loadSectorWarToken(battleId: string): Promise<SectorWarBattleToken | null> {
    const raw = await kv.get<unknown>(sectorWarTokenKey(battleId));
    if (raw === null) return null;
    const token = normalizeSectorWarBattleToken(raw as Partial<SectorWarBattleToken>);
    if (!token || token.battleId !== battleId) throw new Error('sector-war-token-invalid');
    return token;
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
