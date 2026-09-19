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
import { withKvLock } from './_lock.js';
import {
    sectorWarKey,
    sectorWarTokenKey,
    normalizeSectorWarSession,
    normalizeSectorWarBattleToken,
    findSectorWarBattleReceipt,
    isSectorWarActive,
    recordSectorWarBattleOutcome,
    clearSectorWarLedgerPending,
    sectorWarLedgerFromReceipts,
    sectorWarLedgerOf,
    sectorWarBattleReceiptKey,
    sectorWarBattleReceiptPrefix,
    sectorWarExternalBattleReceipt,
    parseSectorWarExternalBattleReceipt,
    sameSectorWarExternalBattleReceipt,
    sectorWarBattleReceiptTtlSeconds,
    SECTOR_WAR_BATTLE_RECEIPT_CAP,
    SECTOR_WAR_BATTLE_RECEIPT_PREFIX,
    SECTOR_WAR_TOKEN_TTL_MS,
    type SectorBattleOutcome,
    type SectorWarSession,
    type SectorWarBattleToken,
    type SectorWarBattleReceipt,
    type SectorWarExternalBattleReceipt,
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

// ── Battle receipts: the in-row mirror + external overflow ledger ─────────────
//
// Every scored battle writes ONE receipt. The first SECTOR_WAR_BATTLE_RECEIPT_CAP
// of a contest instance also ride in the row (`appliedBattles`, the shape every
// earlier release reads); every receipt, in-row or not, gets an external copy
// at `sectorWarBattleReceiptKey`, which outlives the row. The row's
// `battleLedger` holds the war-wide aggregates the old code derived by walking
// the whole list, plus the write-ahead `pending` list that makes the tally and
// the receipt one recoverable operation:
//
//   1. under the contest lock, read the row and drain `pending` (copy each out),
//   2. dedupe: row (mirror + pending), then the external receipt if the war has
//      overflowed,
//   3. ONE compare-and-set that adds the points, the aggregates, the mirror
//      entry (while there is room) and the receipt to `pending`,
//   4. write the external copy, then clear it from `pending`.
//
// A crash before 3 changes nothing. A crash after 3 leaves the receipt in the
// row, where dedupe sees it and the next writer (or settlement) finishes 4. So
// a battle is applied at most once and its evidence is never only in memory.

export type SectorWarLedgerStore = Pick<KvLike, 'get' | 'compareSet' | 'keys' | 'mget'>;

/** Concurrency for copying receipts out (a pre-overflow war can hold 200). */
const RECEIPT_WRITE_CONCURRENCY = 8;
/** CAS attempts inside one lock hold before reporting contention. */
const COMMIT_ATTEMPTS = 6;

async function forEachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += limit) {
        await Promise.all(items.slice(i, i + limit).map(fn));
    }
}

/** Write one external receipt, or prove the identical one is already there. */
async function putExternalReceipt(
    session: SectorWarSession,
    receipt: SectorWarBattleReceipt,
    store: SectorWarLedgerStore,
    now: number,
): Promise<void> {
    const key = sectorWarBattleReceiptKey(session, receipt.battleId);
    const value = sectorWarExternalBattleReceipt(session, receipt);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        let written = false;
        try {
            written = await store.compareSet(key, null, value, { ex: sectorWarBattleReceiptTtlSeconds(session, now) });
        } catch (error) {
            const recovered = await store.get<unknown>(key).catch(() => null);
            if (sameSectorWarExternalBattleReceipt(parseSectorWarExternalBattleReceipt(recovered), value)) return;
            throw error;
        }
        if (written) return;
        const current = await store.get<unknown>(key);
        if (current === null) continue; // expired between the two calls — write again
        if (!sameSectorWarExternalBattleReceipt(parseSectorWarExternalBattleReceipt(current), value)) {
            // Same instance, same battle, different facts: never overwrite
            // settlement evidence. Fail closed for an operator to inspect.
            throw new Error('sector-war-battle-receipt-conflict');
        }
        return;
    }
    throw new Error('sector-war-battle-receipt-busy');
}

/** Copy receipts out of the row. Idempotent; returns the confirmed battle ids. */
export async function externalizeSectorWarReceipts(
    session: SectorWarSession,
    receipts: readonly SectorWarBattleReceipt[],
    now: number,
    store: SectorWarLedgerStore = kv,
    skip: ReadonlySet<string> = new Set(),
): Promise<Set<string>> {
    const unique = new Map<string, SectorWarBattleReceipt>();
    for (const r of receipts) if (!skip.has(r.battleId) && !unique.has(r.battleId)) unique.set(r.battleId, r);
    await forEachLimited([...unique.values()], RECEIPT_WRITE_CONCURRENCY, (r) => putExternalReceipt(session, r, store, now));
    return new Set([...skip, ...unique.keys()]);
}

/** Every external receipt of this contest instance (prefix-indexed scan). Only
 *  the rebuild path uses it — never normal scoring. */
export async function listSectorWarInstanceReceipts(
    session: SectorWarSession,
    store: Pick<KvLike, 'keys' | 'mget'> = kv,
): Promise<SectorWarBattleReceipt[]> {
    const prefix = sectorWarBattleReceiptPrefix(session);
    const keys = (await store.keys(`${prefix}*`)).filter((key) => key.startsWith(prefix));
    if (!keys.length) return [];
    const raws = await store.mget<unknown[]>(...keys);
    const out: SectorWarBattleReceipt[] = [];
    raws.forEach((raw, index) => {
        if (raw === null) return; // expired between the two reads
        const parsed = parseSectorWarExternalBattleReceipt(raw);
        if (!parsed
            || parsed.contestId !== session.id
            || parsed.startedAt !== Math.max(0, Math.floor(Number(session.startedAt) || 0))
            || `${prefix}${parsed.receipt.battleId}` !== keys[index]) {
            throw new Error('sector-war-battle-receipt-invalid');
        }
        out.push(parsed.receipt);
    });
    return out;
}

async function loadSectorWarExternalReceiptRecord(
    session: SectorWarSession,
    battleId: string,
    store: Pick<KvLike, 'get'>,
): Promise<SectorWarExternalBattleReceipt | null> {
    const raw = await store.get<unknown>(sectorWarBattleReceiptKey(session, battleId));
    if (raw === null) return null;
    const parsed = parseSectorWarExternalBattleReceipt(raw);
    if (!parsed
        || parsed.contestId !== session.id
        || parsed.startedAt !== Math.max(0, Math.floor(Number(session.startedAt) || 0))
        || parsed.receipt.battleId !== battleId) {
        throw new Error('sector-war-battle-receipt-invalid');
    }
    return parsed;
}

/** The external receipt of `battleId` in THIS contest instance, if any. */
export async function loadSectorWarExternalReceipt(
    session: SectorWarSession,
    battleId: string,
    store: Pick<KvLike, 'get'> = kv,
): Promise<SectorWarBattleReceipt | null> {
    return (await loadSectorWarExternalReceiptRecord(session, battleId, store))?.receipt ?? null;
}

/** An applied battle found by `locateSectorWarAppliedBattle`. `session` is the
 *  live row when it is still the battle's own contest instance; otherwise null
 *  and `tally` is the score recorded with the receipt. */
export type SectorWarLocatedBattle = {
    contestId: string;
    receipt: SectorWarBattleReceipt;
    session: SectorWarSession | null;
    tally: { attackerPoints: number; defenderPoints: number };
};

/**
 * Make sure the session carries a ledger that describes every receipt.
 *
 * Rows written before the ledger existed have none, and a writer from before
 * it (during a rolling deploy or after a rollback) drops the field when it
 * rewrites the row, since it rebuilds the row from the fields it knows. Below
 * the cap the mirror is then still the complete ledger — the mirror only ever
 * stops growing at the cap — so the aggregates come from it alone. At the cap
 * some receipts may live only externally, and those are read back with one
 * prefix-indexed scan of this instance. This is also the whole migration of a
 * legacy row: a pure recomputation, committed by the caller's next CAS; points
 * already in the tally are never added again.
 */
export async function prepareSectorWarLedger(
    session: SectorWarSession,
    store: Pick<KvLike, 'keys' | 'mget'> = kv,
): Promise<SectorWarSession> {
    const mirror = session.appliedBattles ?? [];
    const ledger = session.battleLedger;
    if (ledger && ledger.mirrorCount === mirror.length) return session;
    const mayHaveOverflow = mirror.length >= SECTOR_WAR_BATTLE_RECEIPT_CAP || !!ledger;
    const external = mayHaveOverflow ? await listSectorWarInstanceReceipts(session, store) : [];
    const inMirror = new Set(mirror.map((r) => r.battleId));
    const overflow = external
        .filter((r) => !inMirror.has(r.battleId))
        .sort((a, b) => b.at - a.at);
    return {
        ...session,
        battleLedger: sectorWarLedgerFromReceipts(
            [...overflow, ...mirror],
            mirror.length,
            ledger?.pending ?? [],
            mirror.length === 0,
        ),
    };
}

/**
 * Copy out everything the row still holds that has no confirmed external copy:
 * the `pending` receipts, and — for a row first written by an older release —
 * the whole in-row mirror. Idempotent; used before a war goes terminal and as
 * a best-effort pre-pass outside the lock.
 */
export async function externalizeSectorWarLedger(
    session: SectorWarSession,
    now: number,
    store: SectorWarLedgerStore = kv,
    skip: ReadonlySet<string> = new Set(),
): Promise<Set<string>> {
    const ledger = sectorWarLedgerOf(session);
    const receipts = [...ledger.pending, ...(ledger.mirrorExternalized ? [] : (session.appliedBattles ?? []))];
    return externalizeSectorWarReceipts(session, receipts, now, store, skip);
}

/**
 * The session with every receipt's external copy confirmed and `pending`
 * empty — what a row must look like before it can become terminal and start
 * its expiry clock. The caller persists the result. Throws (leaving the war
 * as it was) if a copy cannot be confirmed.
 */
export async function drainSectorWarLedger(
    session: SectorWarSession,
    now: number,
    store: SectorWarLedgerStore = kv,
    alreadyConfirmed: ReadonlySet<string> = new Set(),
): Promise<SectorWarSession> {
    const prepared = await prepareSectorWarLedger(session, store);
    const confirmed = await externalizeSectorWarLedger(prepared, now, store, alreadyConfirmed);
    return clearSectorWarLedgerPending(prepared, confirmed, true);
}

/** Why a battle was not applied. Every reason writes nothing. */
export type SectorWarBattleSkip =
    /** The battle belongs to an earlier war on this sector, or ended too late. */
    | 'superseded'
    /** The war is settled or conceded; its row is no longer written. */
    | 'terminal'
    /** Nothing scores (a draw). */
    | 'draw';

export type SectorWarBattleDecision =
    | { kind: 'skip'; reason: SectorWarBattleSkip }
    | {
        kind: 'score';
        outcome: SectorBattleOutcome;
        attackerWon: boolean;
        by: string;
        garrison?: boolean;
        at: number;
    };

export type SectorWarBattleCommit =
    | { status: 'missing' }
    | { status: 'skipped'; reason: SectorWarBattleSkip; contest: SectorWarSession }
    | { status: 'applied'; replayed: boolean; receipt: SectorWarBattleReceipt; session: SectorWarSession };

/**
 * Apply ONE verified battle to its contest exactly once. The only writer of
 * battle receipts; see the protocol note above.
 *
 * `decide` runs inside the contest lock against the fresh row and returns the
 * scored outcome (computed from THAT row, e.g. by applySectorWarBattle) or a
 * skip. It may run more than once if a concurrent write forces a retry, so it
 * must only read. `verifyPrior` sees an already-recorded receipt for this
 * battle and throws to fail closed if it contradicts the caller's evidence.
 */
export async function commitSectorWarBattle(args: {
    contestId: string;
    battleId: string;
    decide: (contest: SectorWarSession) => SectorWarBattleDecision | Promise<SectorWarBattleDecision>;
    verifyPrior?: (receipt: SectorWarBattleReceipt, contest: SectorWarSession) => void;
    store?: SectorWarLedgerStore;
    lock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
    now?: () => number;
}): Promise<SectorWarBattleCommit> {
    const store = args.store ?? kv;
    const clock = args.now ?? Date.now;
    const lock = args.lock ?? (<T>(key: string, fn: () => Promise<T>) => withKvLock(key, fn, { failClosed: true }));
    const battleId = String(args.battleId ?? '').trim();
    if (!battleId) throw new Error('sector-war-battle-id-invalid');
    const key = sectorWarKey(args.contestId);

    return lock(key, async (): Promise<SectorWarBattleCommit> => {
        for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
            const raw = await store.get<Record<string, unknown>>(key);
            if (!raw) return { status: 'missing' };
            const normalized = normalizeSectorWarSession(raw as Parameters<typeof normalizeSectorWarSession>[0]);
            if (!normalized) return { status: 'missing' };
            const contest = await prepareSectorWarLedger(normalized, store);

            // The external copy is consulted whenever the row does not hold the
            // receipt — one keyed read. Legitimately it only matters past the
            // mirror, but it also keeps a row that an older writer overwrote with
            // a stale copy from ever scoring a battle whose receipt exists.
            const prior = findSectorWarBattleReceipt(contest, battleId)
                ?? await loadSectorWarExternalReceipt(contest, battleId, store);
            if (prior) {
                args.verifyPrior?.(prior, contest);
                return { status: 'applied', replayed: true, receipt: prior, session: contest };
            }

            const decision = await args.decide(contest);
            if (decision.kind === 'skip') return { status: 'skipped', reason: decision.reason, contest };
            if (decision.outcome.session.id !== contest.id) throw new Error('sector-war-battle-decision-invalid');

            // Finish any earlier writer's step 4 first, so this CAS can also
            // retire those entries and `pending` never accumulates.
            const now = clock();
            const earlier = contest.battleLedger?.pending ?? [];
            const confirmed = earlier.length
                ? await externalizeSectorWarReceipts(contest, earlier, now, store)
                : new Set<string>();
            const recorded = recordSectorWarBattleOutcome(
                { ...decision.outcome, session: clearSectorWarLedgerPending(decision.outcome.session, confirmed) },
                { battleId, attackerWon: decision.attackerWon, by: decision.by, garrison: decision.garrison, at: decision.at },
            );

            let committed = false;
            try {
                committed = await store.compareSet(key, raw, recorded.session);
            } catch (error) {
                // A lost response: the write may have landed. Only the exact
                // intended row proves it did.
                const recovered = await store.get<unknown>(key).catch(() => null);
                if (!isDeepStrictEqual(recovered, JSON.parse(JSON.stringify(recorded.session)))) throw error;
                committed = true;
            }
            if (!committed) continue; // the row moved underneath us — re-read and redo

            // Step 4. The receipt is already durable in the row, so a failure
            // here only delays the copy until the next writer drains it.
            let session = recorded.session;
            try {
                await putExternalReceipt(recorded.session, recorded.receipt, store, clock());
                const cleared = clearSectorWarLedgerPending(recorded.session, new Set([battleId]));
                if (await store.compareSet(key, recorded.session, cleared)) session = cleared;
            } catch (error) {
                console.warn('[sector-war] battle receipt copy deferred:', (error as Error)?.message ?? error);
            }
            return { status: 'applied', replayed: false, receipt: recorded.receipt, session };
        }
        throw new Error('sector-war-contest-version-conflict');
    });
}

/**
 * Find an already-applied battle given only the contest ids it could belong
 * to — the PvP continuation's recovery path, where the registration token may
 * have expired. O(1) per candidate: the row (mirror + pending), then the
 * external receipt of the instance the battle's own start time falls in.
 *
 * When a candidate's row is gone or has been replaced by a later war, the
 * battle's instance tag is unknown. For ids in `scanContestIds` (ones the
 * battle is provably bound to, e.g. by its token) it then falls back to a
 * prefix-indexed search of that ONE contest id's receipts; other candidates
 * are skipped. It never walks every war.
 */
export async function locateSectorWarAppliedBattle(
    args: { contestIds: readonly string[]; battleId: string; battleCreatedAt: number; scanContestIds?: readonly string[] },
    store: Pick<KvLike, 'get' | 'keys' | 'mget'> = kv,
): Promise<SectorWarLocatedBattle | null> {
    const scannable = new Set(args.scanContestIds ?? []);
    const battleId = String(args.battleId ?? '').trim();
    if (!battleId) throw new Error('sector-war-battle-receipt-invalid');
    let found: SectorWarLocatedBattle | null = null;
    for (const contestId of [...new Set(args.contestIds.filter(Boolean))]) {
        const raw = await store.get<Partial<SectorWarSession>>(sectorWarKey(contestId));
        const session = raw ? normalizeSectorWarSession(raw) : null;
        const sameInstance = !!session && args.battleCreatedAt >= session.startedAt;
        let receipt: SectorWarBattleReceipt | null = null;
        let tally: { attackerPoints: number; defenderPoints: number } | null = null;
        if (session && sameInstance) {
            receipt = findSectorWarBattleReceipt(session, battleId);
            if (!receipt) {
                const external = await loadSectorWarExternalReceiptRecord(session, battleId, store);
                receipt = external?.receipt ?? null;
            }
            tally = { attackerPoints: session.attackerPoints, defenderPoints: session.defenderPoints };
        } else if (scannable.has(contestId)) {
            // No row, or the row is a later war: the battle's instance tag is
            // unknown, so search this contest id's receipts for the battle.
            const prefix = `${SECTOR_WAR_BATTLE_RECEIPT_PREFIX}${contestId}:`;
            const suffix = `:${battleId}`;
            const keys = (await store.keys(`${prefix}*${suffix}`))
                .filter((key) => key.startsWith(prefix) && key.endsWith(suffix)
                    && !key.slice(prefix.length, -suffix.length).includes(':'));
            if (keys.length > 1) throw new Error('sector-war-battle-receipt-conflict');
            if (keys.length === 1) {
                const parsed = parseSectorWarExternalBattleReceipt(await store.get<unknown>(keys[0]!));
                if (!parsed || parsed.contestId !== contestId || parsed.receipt.battleId !== battleId) {
                    throw new Error('sector-war-battle-receipt-invalid');
                }
                receipt = parsed.receipt;
                tally = { ...parsed.tally };
            }
        }
        if (!receipt || !tally) continue;
        if (found) throw new Error('sector-war-battle-receipt-conflict');
        found = { contestId, receipt, session: sameInstance ? session : null, tally };
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
