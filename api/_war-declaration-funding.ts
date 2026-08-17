import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from './_storage.js';
import { mergePreservingImages } from './_utils.js';
import { syncCurrencyLedger } from './_currency-ledger.js';
import { versionedPlayerRecord } from './save/_mutate-player-save.js';

type FundingStore = Pick<KvLike, 'get' | 'set' | 'compareSet'>;

export const WAR_DECLARATION_FUNDING_FIELD = 'declarationFunding';
export const WAR_DECLARATION_FUNDING_RECEIPTS_FIELD = 'warDeclarationFundingReceipts';
export const WAR_DECLARATION_FUNDING_VERSION = 1;
export const WAR_DECLARATION_ABORT_TTL_SECONDS = 300;

export type WarDeclarationFundingSource =
    | { kind: 'war-resources'; recordKey: string; accountId: string; amount: number }
    | { kind: 'honor-seals'; recordKey: string; accountId: string; amount: number };

export interface WarDeclarationFundingMarker {
    version: 1;
    status: 'funding' | 'active' | 'aborted';
    declarationId: string;
    fingerprint: string;
    source: WarDeclarationFundingSource;
    createdAt: number;
    ownerId: string;
    leaseExpiresAt: number;
    takeoverCount: number;
    fundedAt?: number;
    activatedAt?: number;
    abortedAt?: number;
    abortReason?: WarDeclarationFundingAbortReason;
}

export interface WarDeclarationDebitReceipt {
    version: 2;
    state: 'committed';
    declarationId: string;
    fingerprint: string;
    sourceKind: WarDeclarationFundingSource['kind'];
    accountId: string;
    amount: number;
    ownerId: string;
    reservedAt: number;
    balanceBefore: number;
    balanceAfter: number;
    debitedAt: number;
}

export interface WarDeclarationDebitIntent {
    version: 2;
    state: 'pending' | 'aborted';
    declarationId: string;
    fingerprint: string;
    sourceKind: WarDeclarationFundingSource['kind'];
    accountId: string;
    amount: number;
    ownerId: string;
    reservedAt: number;
    abortedAt?: number;
}

type WarDeclarationSourceEntry = WarDeclarationDebitReceipt | WarDeclarationDebitIntent;

export type WarDeclarationFundingRow<T extends Record<string, unknown>> = T & {
    declarationFunding: WarDeclarationFundingMarker;
};

export interface WarDeclarationFundingPlan<T extends Record<string, unknown>> {
    warKey: string;
    declarationId: string;
    /** SHA-256 returned by warDeclarationFundingFingerprint over server-owned declaration identity. */
    fingerprint: string;
    /** Complete server-owned war row. It must not already contain declarationFunding. */
    war: T;
    /**
     * Exact predecessor permitted at `warKey`. Omit for a first generation.
     * A rematch supplies the complete ended row it read, allowing the funding
     * publication itself to be the exact-CAS successor (never delete/recreate).
     */
    expectedWar?: Record<string, unknown> | null;
    source: WarDeclarationFundingSource;
    ownerId: string;
    now: number;
    leaseMs: number;
}

export type WarDeclarationFundingReservation<T extends Record<string, unknown>> =
    | { status: 'acquired'; row: WarDeclarationFundingRow<T>; replayed: boolean }
    | { status: 'active'; row: WarDeclarationFundingRow<T>; replayed: true }
    | { status: 'busy'; row: Record<string, unknown> }
    | { status: 'conflict'; row: Record<string, unknown> | null };

export type WarDeclarationDebitResult =
    | { status: 'debited'; receipt: WarDeclarationDebitReceipt; row: Record<string, unknown>; replayed: boolean }
    | { status: 'insufficient'; have: number; cost: number }
    | { status: 'source-fenced' }
    | { status: 'stale-lease' };

export type WarDeclarationActivationResult<T extends Record<string, unknown>> =
    | { status: 'active'; row: WarDeclarationFundingRow<T>; replayed: boolean }
    | { status: 'stale-lease'; row: Record<string, unknown> | null }
    | { status: 'conflict'; row: Record<string, unknown> | null };

export type WarDeclarationFundingAbortReason =
    | 'insufficient'
    | 'account-missing'
    | 'account-invalid'
    | 'balance-invalid'
    | 'source-fenced'
    | 'window-expired'
    | 'authority-changed';

export type WarDeclarationFundingAbortResult<T extends Record<string, unknown>> =
    | { status: 'aborted'; row: WarDeclarationFundingRow<T> }
    | { status: 'funded'; receipt: WarDeclarationDebitReceipt; row: Record<string, unknown> }
    | { status: 'stale-lease'; row: Record<string, unknown> | null }
    | { status: 'conflict'; row: Record<string, unknown> | null };

export type WarDeclarationFundingResult<T extends Record<string, unknown>> =
    | { status: 'active'; row: WarDeclarationFundingRow<T>; replayed: boolean; receipt: WarDeclarationDebitReceipt }
    | { status: 'busy'; row: Record<string, unknown> }
    | { status: 'conflict'; row: Record<string, unknown> | null }
    | { status: 'insufficient'; have: number; cost: number }
    | { status: 'stale-lease'; row?: Record<string, unknown> | null };

export type WarDeclarationFundingSourceProofState =
    | 'source-missing'
    | 'receipt-missing'
    | WarDeclarationSourceEntry['state'];

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** Stable declaration fingerprint. Callers must include every immutable identity field, but no retry-time clock. */
export function warDeclarationFundingFingerprint(identity: unknown): string {
    return createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

/** A lease owner is per execution, never a stable request/declaration id. */
export function newWarDeclarationFundingOwnerId(): string {
    return randomUUID();
}

function jsonClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function positiveSafeInteger(value: unknown): number | null {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonnegativeSafeInteger(value: unknown): number | null {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function cleanSource(value: unknown): WarDeclarationFundingSource | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Partial<WarDeclarationFundingSource>;
    const kind = source.kind;
    const recordKey = String(source.recordKey ?? '').trim();
    const accountId = String(source.accountId ?? '').trim();
    // A village with no held sectors intentionally receives the comeback
    // discount all the way down to zero WR. Zero-cost declarations still run
    // the complete source-intent/receipt fence: they simply co-write an exact
    // committed receipt whose before/after balances are equal.
    const amount = nonnegativeSafeInteger(source.amount);
    if ((kind !== 'war-resources' && kind !== 'honor-seals') || !recordKey || !accountId || amount === null) return null;
    return { kind, recordKey, accountId, amount };
}

function sameSource(left: WarDeclarationFundingSource, right: WarDeclarationFundingSource): boolean {
    return left.kind === right.kind
        && left.recordKey === right.recordKey
        && left.accountId === right.accountId
        && left.amount === right.amount;
}

function cleanMarker(value: unknown): WarDeclarationFundingMarker | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const marker = value as Partial<WarDeclarationFundingMarker>;
    const source = cleanSource(marker.source);
    const declarationId = String(marker.declarationId ?? '').trim();
    const fingerprint = String(marker.fingerprint ?? '').trim();
    const createdAt = positiveSafeInteger(marker.createdAt);
    const ownerId = String(marker.ownerId ?? '').trim();
    const leaseExpiresAt = positiveSafeInteger(marker.leaseExpiresAt);
    const fundedAt = marker.fundedAt === undefined ? undefined : positiveSafeInteger(marker.fundedAt);
    const activatedAt = marker.activatedAt === undefined ? undefined : positiveSafeInteger(marker.activatedAt);
    const abortedAt = marker.abortedAt === undefined ? undefined : positiveSafeInteger(marker.abortedAt);
    const abortReason = marker.abortReason;
    const takeoverCount = nonnegativeSafeInteger(marker.takeoverCount ?? 0);
    if (marker.version !== WAR_DECLARATION_FUNDING_VERSION
        || (marker.status !== 'funding' && marker.status !== 'active' && marker.status !== 'aborted')
        || !declarationId || !/^[a-f0-9]{64}$/.test(fingerprint)
        || !source || createdAt === null || !ownerId || leaseExpiresAt === null
        || takeoverCount === null || fundedAt === null || activatedAt === null || abortedAt === null) return null;
    if (marker.status === 'active' && (fundedAt === undefined || activatedAt === undefined)) return null;
    if (marker.status === 'aborted'
        && (abortedAt === undefined
            || (abortReason !== 'insufficient'
                && abortReason !== 'account-missing'
                && abortReason !== 'account-invalid'
                && abortReason !== 'balance-invalid'
                && abortReason !== 'source-fenced'
                && abortReason !== 'window-expired'
                && abortReason !== 'authority-changed'))) return null;
    return {
        version: 1,
        status: marker.status,
        declarationId,
        fingerprint,
        source,
        createdAt,
        ownerId,
        leaseExpiresAt,
        takeoverCount,
        ...(fundedAt === undefined ? {} : { fundedAt }),
        ...(activatedAt === undefined ? {} : { activatedAt }),
        ...(abortedAt === undefined ? {} : { abortedAt }),
        ...(abortReason === undefined ? {} : { abortReason }),
    };
}

function markerFromRow(row: unknown): WarDeclarationFundingMarker | null {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    return cleanMarker((row as Record<string, unknown>)[WAR_DECLARATION_FUNDING_FIELD]);
}

/** Fail-closed reader for server-owned declaration state used by every war lane. */
export function warDeclarationFundingMarkerFromRow(row: unknown): WarDeclarationFundingMarker | null {
    return markerFromRow(row);
}

function validatePlan<T extends Record<string, unknown>>(plan: WarDeclarationFundingPlan<T>): WarDeclarationFundingSource {
    if (!plan.warKey.trim() || !plan.declarationId.trim() || !plan.ownerId.trim()) {
        throw new TypeError('War key, declaration id, and funding owner are required.');
    }
    if (!/^[a-f0-9]{64}$/.test(plan.fingerprint)) throw new TypeError('Funding fingerprint must be a SHA-256 hex digest.');
    if (positiveSafeInteger(plan.now) === null || positiveSafeInteger(plan.leaseMs) === null) {
        throw new TypeError('Funding clock and lease duration must be positive safe integers.');
    }
    if (!Number.isSafeInteger(plan.now + plan.leaseMs)) {
        throw new TypeError('Funding lease deadline exceeds the safe integer range.');
    }
    const source = cleanSource(plan.source);
    if (!source) throw new TypeError('Funding source is invalid.');
    if (!plan.war || typeof plan.war !== 'object' || Array.isArray(plan.war)
        || Object.prototype.hasOwnProperty.call(plan.war, WAR_DECLARATION_FUNDING_FIELD)) {
        throw new TypeError('Initial war row must be an object without declaration funding state.');
    }
    if (plan.expectedWar !== undefined && plan.expectedWar !== null
        && (typeof plan.expectedWar !== 'object' || Array.isArray(plan.expectedWar))) {
        throw new TypeError('Expected predecessor war row must be an object or null.');
    }
    return source;
}

function matchesPlan(marker: WarDeclarationFundingMarker, plan: WarDeclarationFundingPlan<Record<string, unknown>>, source: WarDeclarationFundingSource): boolean {
    return marker.declarationId === plan.declarationId.trim()
        && marker.fingerprint === plan.fingerprint
        && sameSource(marker.source, source);
}

async function exactCompareSet<T>(
    store: FundingStore,
    key: string,
    expected: T | null,
    desired: T,
    options?: { ex?: number },
): Promise<{ committed: true; row: T } | { committed: false; row: T | null }> {
    const intended = jsonClone(desired);
    try {
        if (await store.compareSet(key, expected, intended, options)) return { committed: true, row: intended };
    } catch (error) {
        const recovered = await store.get<T>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, intended)) return { committed: true, row: intended };
        throw error;
    }
    const current = await store.get<T>(key);
    if (isDeepStrictEqual(current, intended)) return { committed: true, row: intended };
    return { committed: false, row: current };
}

/** Publish or take over the durable row-first funding reservation. */
export async function reserveWarDeclarationFunding<T extends Record<string, unknown>>(
    store: FundingStore,
    plan: WarDeclarationFundingPlan<T>,
): Promise<WarDeclarationFundingReservation<T>> {
    const source = validatePlan(plan);
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await store.get<Record<string, unknown>>(plan.warKey);
        const expected = plan.expectedWar === undefined ? null : plan.expectedWar;
        if (isDeepStrictEqual(current, expected)) {
            const marker: WarDeclarationFundingMarker = {
                version: 1,
                status: 'funding',
                declarationId: plan.declarationId.trim(),
                fingerprint: plan.fingerprint,
                source,
                createdAt: plan.now,
                ownerId: plan.ownerId.trim(),
                leaseExpiresAt: plan.now + plan.leaseMs,
                takeoverCount: 0,
            };
            const desired = {
                ...jsonClone(plan.war),
                [WAR_DECLARATION_FUNDING_FIELD]: marker,
            } as WarDeclarationFundingRow<T>;
            const placed = await exactCompareSet<WarDeclarationFundingRow<T>>(
                store,
                plan.warKey,
                expected as WarDeclarationFundingRow<T> | null,
                desired,
            );
            if (placed.committed) return { status: 'acquired', row: placed.row, replayed: false };
            continue;
        }

        if (current === null) return { status: 'conflict', row: null };

        const marker = markerFromRow(current);
        if (!marker || !matchesPlan(marker, plan as WarDeclarationFundingPlan<Record<string, unknown>>, source)) {
            return { status: 'conflict', row: current };
        }
        if (marker.status === 'active') {
            return { status: 'active', row: current as WarDeclarationFundingRow<T>, replayed: true };
        }
        if (marker.status === 'aborted') {
            // A debit can race the conservative abort only if a same-owner call
            // was already past its war-row check. The tombstone remains a
            // recoverable intent for the same fingerprint: receipt means fund
            // and activate; no receipt means wait for its bounded TTL.
            const sourceRow = await store.get<Record<string, unknown>>(marker.source.recordKey);
            const receipt = sourceRow ? exactReceiptFromRow(sourceRow, marker) : null;
            if (!receipt) return { status: 'conflict', row: current };
            const desired = {
                ...current,
                [WAR_DECLARATION_FUNDING_FIELD]: {
                    ...marker,
                    status: 'funding',
                    ownerId: plan.ownerId.trim(),
                    leaseExpiresAt: plan.now + plan.leaseMs,
                    takeoverCount: marker.takeoverCount + 1,
                    abortedAt: undefined,
                    abortReason: undefined,
                },
            } as WarDeclarationFundingRow<T>;
            delete (desired[WAR_DECLARATION_FUNDING_FIELD] as Partial<WarDeclarationFundingMarker>).abortedAt;
            delete (desired[WAR_DECLARATION_FUNDING_FIELD] as Partial<WarDeclarationFundingMarker>).abortReason;
            const recovered = await exactCompareSet<WarDeclarationFundingRow<T>>(
                store,
                plan.warKey,
                current as WarDeclarationFundingRow<T>,
                desired,
            );
            if (recovered.committed) return { status: 'acquired', row: recovered.row, replayed: true };
            continue;
        }
        if (marker.ownerId === plan.ownerId.trim() && marker.leaseExpiresAt > plan.now) {
            return { status: 'acquired', row: current as WarDeclarationFundingRow<T>, replayed: true };
        }
        if (marker.leaseExpiresAt > plan.now) return { status: 'busy', row: current };

        const desired = {
            ...current,
            [WAR_DECLARATION_FUNDING_FIELD]: {
                ...marker,
                ownerId: plan.ownerId.trim(),
                leaseExpiresAt: plan.now + plan.leaseMs,
                takeoverCount: marker.takeoverCount + 1,
            },
        } as WarDeclarationFundingRow<T>;
        const takeover = await exactCompareSet<WarDeclarationFundingRow<T>>(
            store,
            plan.warKey,
            current as WarDeclarationFundingRow<T>,
            desired,
        );
        if (takeover.committed) return { status: 'acquired', row: takeover.row, replayed: true };
    }
    const current = await store.get<Record<string, unknown>>(plan.warKey);
    return current ? { status: 'busy', row: current } : { status: 'conflict', row: null };
}

/**
 * Release an intent after a terminal pre-debit failure. The source entry is
 * fenced FIRST, by exact CAS, so an owner that passed its war-row check before
 * this abort cannot land a debit after the bounded war tombstone expires.
 * Debit and abort race on the same source row: committed wins and must activate;
 * aborted wins and permanently blocks this fingerprint from spending.
 */
export async function abortWarDeclarationFunding<T extends Record<string, unknown>>(
    store: FundingStore,
    warKey: string,
    fundingRow: WarDeclarationFundingRow<T>,
    reason: WarDeclarationFundingAbortReason,
    abortedAt: number,
    ttlSeconds = WAR_DECLARATION_ABORT_TTL_SECONDS,
): Promise<WarDeclarationFundingAbortResult<T>> {
    const marker = markerFromRow(fundingRow);
    if (!marker || marker.status !== 'funding' || positiveSafeInteger(abortedAt) === null
        || positiveSafeInteger(ttlSeconds) === null) {
        throw new TypeError('An exact funding row, abort reason, clock, and TTL are required.');
    }
    const currentWar = await store.get<Record<string, unknown>>(warKey);
    if (!isDeepStrictEqual(currentWar, fundingRow)) {
        const currentMarker = markerFromRow(currentWar);
        if (currentMarker
            && currentMarker.declarationId === marker.declarationId
            && currentMarker.fingerprint === marker.fingerprint
            && sameSource(currentMarker.source, marker.source)) {
            return { status: 'stale-lease', row: currentWar };
        }
        return { status: 'conflict', row: currentWar };
    }
    let sourceFenced = false;
    let durableSourceFence = false;
    for (let attempt = 0; attempt < 8 && !sourceFenced; attempt += 1) {
        const sourceRow = await store.get<Record<string, unknown>>(marker.source.recordKey);
        if (!sourceRow) {
            // No debit worker can progress from a missing row: intent creation
            // requires an existing exact source object.
            sourceFenced = true;
            break;
        }
        let entry: WarDeclarationSourceEntry | null;
        try {
            entry = exactSourceEntryFromRow(sourceRow, marker);
        } catch (error) {
            if ((reason === 'account-invalid' || reason === 'window-expired' || reason === 'authority-changed')
                && error instanceof Error
                && error.message === 'war-declaration-funding-account-invalid') {
                // A malformed/missing character holder cannot accept an Honor
                // intent or debit, so there is no source CAS to fence.
                sourceFenced = true;
                break;
            }
            throw error;
        }
        if (entry?.state === 'committed') return { status: 'funded', receipt: entry, row: sourceRow };
        if (entry?.state === 'aborted') {
            sourceFenced = true;
            durableSourceFence = true;
            break;
        }
        if (entry?.state === 'pending' && entry.ownerId !== marker.ownerId) {
            return { status: 'stale-lease', row: await store.get<Record<string, unknown>>(warKey) };
        }
        const abortedIntent = sourceEntryFor(
            marker,
            'aborted',
            abortedAt,
            entry?.state === 'pending' ? entry.reservedAt : abortedAt,
        );
        const fencedRow = projectSourceEntry(sourceRow, marker.source, abortedIntent);
        try {
            if (await store.compareSet(marker.source.recordKey, sourceRow, fencedRow)) {
                sourceFenced = true;
                durableSourceFence = true;
                break;
            }
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(marker.source.recordKey).catch(() => null);
            if (recovered) {
                const recoveredEntry = exactSourceEntryFromRow(recovered, marker);
                if (recoveredEntry?.state === 'committed') {
                    return { status: 'funded', receipt: recoveredEntry, row: recovered };
                }
                if (recoveredEntry?.state === 'aborted') {
                    sourceFenced = true;
                    durableSourceFence = true;
                    break;
                }
            }
            throw error;
        }
    }
    if (!sourceFenced) throw new Error('war-declaration-funding-abort-busy');

    const desired = {
        ...fundingRow,
        [WAR_DECLARATION_FUNDING_FIELD]: {
            ...marker,
            status: 'aborted',
            abortedAt,
            abortReason: reason,
        },
    } as WarDeclarationFundingRow<T>;
    const publication = await exactCompareSet<WarDeclarationFundingRow<T>>(
        store,
        warKey,
        fundingRow,
        desired,
        // Missing/structurally invalid source rows cannot carry the durable
        // source-side fence. Keep the tiny aborted war authority permanently in
        // that case: a bounded tombstone would re-open a value-CAS ABA window if
        // the source were later recreated byte-for-byte. When the exact source
        // abort entry exists, the war tombstone may remain bounded.
        durableSourceFence ? { ex: Math.floor(ttlSeconds) } : undefined,
    );
    if (publication.committed) return { status: 'aborted', row: publication.row };
    const currentMarker = markerFromRow(publication.row);
    if (currentMarker
        && currentMarker.declarationId === marker.declarationId
        && currentMarker.fingerprint === marker.fingerprint
        && sameSource(currentMarker.source, marker.source)) {
        return { status: 'stale-lease', row: publication.row };
    }
    return { status: 'conflict', row: publication.row };
}

function receiptKey(fingerprint: string): string {
    return fingerprint;
}

function receiptMapAt(row: Record<string, unknown>, source: WarDeclarationFundingSource): Record<string, unknown> {
    const holder = source.kind === 'honor-seals'
        ? row.character as Record<string, unknown> | null | undefined
        : row;
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) {
        throw new Error('war-declaration-funding-account-invalid');
    }
    const raw = holder[WAR_DECLARATION_FUNDING_RECEIPTS_FIELD];
    if (raw === undefined) return {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('war-declaration-funding-receipts-invalid');
    }
    return raw as Record<string, unknown>;
}

function cleanSourceEntry(value: unknown): WarDeclarationSourceEntry | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Partial<WarDeclarationSourceEntry>;
    const declarationId = String(entry.declarationId ?? '').trim();
    const fingerprint = String(entry.fingerprint ?? '').trim();
    const accountId = String(entry.accountId ?? '').trim();
    const ownerId = String(entry.ownerId ?? '').trim();
    const amount = nonnegativeSafeInteger(entry.amount);
    const reservedAt = positiveSafeInteger(entry.reservedAt);
    if (entry.version !== 2 || !declarationId || !/^[a-f0-9]{64}$/.test(fingerprint)
        || (entry.sourceKind !== 'war-resources' && entry.sourceKind !== 'honor-seals')
        || !accountId || !ownerId || amount === null || reservedAt === null) return null;
    if (entry.state === 'pending') {
        return {
            version: 2,
            state: 'pending',
            declarationId,
            fingerprint,
            sourceKind: entry.sourceKind,
            accountId,
            amount,
            ownerId,
            reservedAt,
        };
    }
    if (entry.state === 'aborted') {
        const abortedAt = positiveSafeInteger(entry.abortedAt);
        if (abortedAt === null) return null;
        return {
            version: 2,
            state: 'aborted',
            declarationId,
            fingerprint,
            sourceKind: entry.sourceKind,
            accountId,
            amount,
            ownerId,
            reservedAt,
            abortedAt,
        };
    }
    if (entry.state !== 'committed') return null;
    const balanceBefore = nonnegativeSafeInteger(entry.balanceBefore);
    const balanceAfter = nonnegativeSafeInteger(entry.balanceAfter);
    const debitedAt = positiveSafeInteger(entry.debitedAt);
    if (balanceBefore === null || balanceAfter === null || debitedAt === null
        || balanceBefore - amount !== balanceAfter) return null;
    return {
        version: 2,
        state: 'committed',
        declarationId,
        fingerprint,
        sourceKind: entry.sourceKind,
        accountId,
        amount,
        ownerId,
        reservedAt,
        balanceBefore,
        balanceAfter,
        debitedAt,
    };
}

function exactSourceEntryFromRow(
    row: Record<string, unknown>,
    marker: WarDeclarationFundingMarker,
): WarDeclarationSourceEntry | null {
    const receipts = receiptMapAt(row, marker.source);
    const raw = receipts[receiptKey(marker.fingerprint)];
    if (raw === undefined) return null;
    const entry = cleanSourceEntry(raw);
    if (!entry
        || entry.declarationId !== marker.declarationId
        || entry.fingerprint !== marker.fingerprint
        || entry.sourceKind !== marker.source.kind
        || entry.accountId !== marker.source.accountId
        || entry.amount !== marker.source.amount) {
        throw new Error('war-declaration-funding-receipt-conflict');
    }
    return entry;
}

function exactReceiptFromRow(
    row: Record<string, unknown>,
    marker: WarDeclarationFundingMarker,
): WarDeclarationDebitReceipt | null {
    const entry = exactSourceEntryFromRow(row, marker);
    return entry?.state === 'committed' ? entry : null;
}

/**
 * Read the permanent source-side fence for a declaration whose pair-row
 * tombstone may already have expired. Reservation recovery uses this proof to
 * distinguish a safely aborted declaration from an orphaned committed debit.
 */
export async function warDeclarationFundingSourceProofState(
    store: Pick<KvLike, 'get'>,
    identity: Pick<WarDeclarationFundingMarker, 'declarationId' | 'fingerprint' | 'source'>,
): Promise<WarDeclarationFundingSourceProofState> {
    const source = cleanSource(identity.source);
    const declarationId = String(identity.declarationId ?? '').trim();
    const fingerprint = String(identity.fingerprint ?? '').trim();
    if (!source || !declarationId || !/^[a-f0-9]{64}$/.test(fingerprint)) {
        throw new TypeError('Exact declaration funding identity is required.');
    }
    const row = await store.get<Record<string, unknown>>(source.recordKey);
    if (!row) return 'source-missing';
    const marker: WarDeclarationFundingMarker = {
        version: 1,
        status: 'funding',
        declarationId,
        fingerprint,
        source,
        createdAt: 1,
        ownerId: 'proof-reader',
        leaseExpiresAt: 1,
        takeoverCount: 0,
    };
    const entry = exactSourceEntryFromRow(row, marker);
    return entry?.state ?? 'receipt-missing';
}

function sourceEntryFor(marker: WarDeclarationFundingMarker, state: 'pending', at: number): WarDeclarationDebitIntent;
function sourceEntryFor(marker: WarDeclarationFundingMarker, state: 'aborted', at: number, reservedAt: number): WarDeclarationDebitIntent;
function sourceEntryFor(
    marker: WarDeclarationFundingMarker,
    state: 'pending' | 'aborted',
    at: number,
    reservedAt = at,
): WarDeclarationDebitIntent {
    return {
        version: 2,
        state,
        declarationId: marker.declarationId,
        fingerprint: marker.fingerprint,
        sourceKind: marker.source.kind,
        accountId: marker.source.accountId,
        amount: marker.source.amount,
        ownerId: marker.ownerId,
        reservedAt,
        ...(state === 'aborted' ? { abortedAt: at } : {}),
    };
}

function projectSourceEntry(
    current: Record<string, unknown>,
    source: WarDeclarationFundingSource,
    entry: WarDeclarationSourceEntry,
): Record<string, unknown> {
    const holder = source.kind === 'honor-seals'
        ? current.character as Record<string, unknown> | null | undefined
        : current;
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) {
        throw new Error('war-declaration-funding-account-invalid');
    }
    const receipts = receiptMapAt(current, source);
    const nextHolder = {
        ...holder,
        [WAR_DECLARATION_FUNDING_RECEIPTS_FIELD]: {
            ...receipts,
            [receiptKey(entry.fingerprint)]: entry,
        },
    };
    if (source.kind === 'war-resources') return nextHolder;
    return mergePreservingImages(versionedPlayerRecord(current, nextHolder).record, current) as Record<string, unknown>;
}

function projectDebit(
    current: Record<string, unknown>,
    marker: WarDeclarationFundingMarker,
    debitedAt: number,
): { next: Record<string, unknown>; receipt: WarDeclarationDebitReceipt } | { insufficient: number } {
    const source = marker.source;
    const holder = source.kind === 'honor-seals'
        ? current.character as Record<string, unknown> | null | undefined
        : current;
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) {
        throw new Error('war-declaration-funding-account-invalid');
    }
    const balanceField = source.kind === 'honor-seals' ? 'honorSeals' : 'warResources';
    const balance = nonnegativeSafeInteger(holder[balanceField]);
    if (balance === null) throw new Error('war-declaration-funding-balance-invalid');
    if (balance < source.amount) return { insufficient: balance };
    const intent = exactSourceEntryFromRow(current, marker);
    if (!intent || intent.state !== 'pending' || intent.ownerId !== marker.ownerId) {
        throw new Error('war-declaration-funding-source-fenced');
    }
    const receipt: WarDeclarationDebitReceipt = {
        version: 2,
        state: 'committed',
        declarationId: marker.declarationId,
        fingerprint: marker.fingerprint,
        sourceKind: source.kind,
        accountId: source.accountId,
        amount: source.amount,
        ownerId: marker.ownerId,
        reservedAt: intent.reservedAt,
        balanceBefore: balance,
        balanceAfter: balance - source.amount,
        debitedAt,
    };
    const receipts = receiptMapAt(current, source);
    const nextHolder = {
        ...holder,
        [balanceField]: receipt.balanceAfter,
        [WAR_DECLARATION_FUNDING_RECEIPTS_FIELD]: {
            ...receipts,
            [receiptKey(marker.fingerprint)]: receipt,
        },
    };
    if (source.kind === 'war-resources') return { next: nextHolder, receipt };

    const versioned = versionedPlayerRecord(current, nextHolder);
    return {
        next: mergePreservingImages(versioned.record, current) as Record<string, unknown>,
        receipt,
    };
}

type SourceIntentResult =
    | { status: 'ready'; row: Record<string, unknown> }
    | { status: 'debited'; receipt: WarDeclarationDebitReceipt; row: Record<string, unknown> }
    | { status: 'fenced' }
    | { status: 'stale-lease' };

async function ensureSourceIntent<T extends Record<string, unknown>>(
    store: FundingStore,
    warKey: string,
    fundingRow: WarDeclarationFundingRow<T>,
    marker: WarDeclarationFundingMarker,
    reservedAt: number,
): Promise<SourceIntentResult> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!isDeepStrictEqual(await store.get<Record<string, unknown>>(warKey), fundingRow)) {
            return { status: 'stale-lease' };
        }
        const current = await store.get<Record<string, unknown>>(marker.source.recordKey);
        if (!current) throw new Error('war-declaration-funding-account-missing');
        const entry = exactSourceEntryFromRow(current, marker);
        if (entry?.state === 'committed') return { status: 'debited', receipt: entry, row: current };
        // An aborted source intent is a permanent fence for this exact
        // declaration fingerprint, regardless of which lease owner wrote it.
        // Abort publishes the source fence before the bounded war tombstone; a
        // process can die between those two CASes and a later owner may take the
        // still-`funding` war row over. Letting that owner replace the older
        // aborted entry would resurrect a declaration that was already proven
        // safe to abandon and could debit it after the aborting process resumes.
        if (entry?.state === 'aborted') return { status: 'fenced' };
        if (entry?.state === 'pending' && entry.ownerId === marker.ownerId) {
            return { status: 'ready', row: current };
        }

        // No intent, or an expired lease owner's pending intent. This exact
        // source CAS is the fencing boundary: once the new owner replaces it,
        // an old debit derived from the prior source row cannot commit.
        const pending = sourceEntryFor(marker, 'pending', reservedAt);
        const desired = projectSourceEntry(current, marker.source, pending);
        try {
            if (await store.compareSet(marker.source.recordKey, current, desired)) {
                return { status: 'ready', row: desired };
            }
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(marker.source.recordKey).catch(() => null);
            if (recovered) {
                const recoveredEntry = exactSourceEntryFromRow(recovered, marker);
                if (recoveredEntry?.state === 'pending' && recoveredEntry.ownerId === marker.ownerId) {
                    return { status: 'ready', row: recovered };
                }
                if (recoveredEntry?.state === 'committed') {
                    return { status: 'debited', receipt: recoveredEntry, row: recovered };
                }
            }
            throw error;
        }
    }
    throw new Error('war-declaration-funding-intent-busy');
}

async function syncHonorLedger(
    store: FundingStore,
    marker: WarDeclarationFundingMarker,
    row: Record<string, unknown>,
): Promise<void> {
    if (marker.source.kind !== 'honor-seals') return;
    await syncCurrencyLedger(marker.source.accountId, row, { kv: store });
}

/** Exact-CAS the currency debit and its non-evicting receipt in one source-row write. */
export async function debitWarDeclarationFunding<T extends Record<string, unknown>>(
    store: FundingStore,
    warKey: string,
    fundingRow: WarDeclarationFundingRow<T>,
    debitedAt: number,
): Promise<WarDeclarationDebitResult> {
    const marker = markerFromRow(fundingRow);
    if (!marker || marker.status !== 'funding' || positiveSafeInteger(debitedAt) === null) {
        throw new TypeError('An exact funding row and debit clock are required.');
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const intent = await ensureSourceIntent(store, warKey, fundingRow, marker, debitedAt);
        if (intent.status === 'stale-lease') return { status: 'stale-lease' };
        if (intent.status === 'fenced') return { status: 'source-fenced' };
        if (intent.status === 'debited') {
            // A crash can land the authoritative save blob before its best-effort
            // currency projection. Replays help the projection forward too.
            await syncHonorLedger(store, marker, intent.row);
            return { status: 'debited', receipt: intent.receipt, row: intent.row, replayed: true };
        }
        if (!isDeepStrictEqual(await store.get<Record<string, unknown>>(warKey), fundingRow)) {
            return { status: 'stale-lease' };
        }
        const current = intent.row;
        const projection = projectDebit(current, marker, debitedAt);
        if ('insufficient' in projection) {
            return { status: 'insufficient', have: projection.insufficient, cost: marker.source.amount };
        }
        try {
            if (await store.compareSet(marker.source.recordKey, current, projection.next)) {
                await syncHonorLedger(store, marker, projection.next);
                return { status: 'debited', receipt: projection.receipt, row: projection.next, replayed: false };
            }
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(marker.source.recordKey).catch(() => null);
            if (recovered) {
                const recoveredEntry = exactSourceEntryFromRow(recovered, marker);
                if (recoveredEntry?.state === 'committed') {
                    await syncHonorLedger(store, marker, recovered);
                    return { status: 'debited', receipt: recoveredEntry, row: recovered, replayed: false };
                }
            }
            throw error;
        }
    }
    throw new Error('war-declaration-funding-debit-busy');
}

async function confirmDebitReceipt(
    store: FundingStore,
    marker: WarDeclarationFundingMarker,
): Promise<WarDeclarationDebitReceipt> {
    const sourceRow = await store.get<Record<string, unknown>>(marker.source.recordKey);
    if (!sourceRow) throw new Error('war-declaration-funding-account-missing');
    const receipt = exactReceiptFromRow(sourceRow, marker);
    if (!receipt) throw new Error('war-declaration-funding-receipt-missing');
    return receipt;
}

/** Activate only the exact funding row whose debit receipt is durably present. */
export async function activateWarDeclarationFunding<T extends Record<string, unknown>>(
    store: FundingStore,
    warKey: string,
    fundingRow: WarDeclarationFundingRow<T>,
    activatedAt: number,
): Promise<WarDeclarationActivationResult<T>> {
    const marker = markerFromRow(fundingRow);
    if (!marker || marker.status !== 'funding' || positiveSafeInteger(activatedAt) === null) {
        throw new TypeError('An exact funding row and activation clock are required.');
    }
    const receipt = await confirmDebitReceipt(store, marker);
    const desired = {
        ...fundingRow,
        [WAR_DECLARATION_FUNDING_FIELD]: {
            ...marker,
            status: 'active',
            fundedAt: receipt.debitedAt,
            activatedAt,
        },
    } as WarDeclarationFundingRow<T>;
    const publication = await exactCompareSet(store, warKey, fundingRow, desired);
    if (publication.committed) return { status: 'active', row: publication.row, replayed: false };
    const current = publication.row as Record<string, unknown> | null;
    const currentMarker = markerFromRow(current);
    if (currentMarker
        && currentMarker.status === 'active'
        && currentMarker.declarationId === marker.declarationId
        && currentMarker.fingerprint === marker.fingerprint
        && sameSource(currentMarker.source, marker.source)) {
        await confirmDebitReceipt(store, currentMarker);
        return { status: 'active', row: current as WarDeclarationFundingRow<T>, replayed: true };
    }
    if (currentMarker
        && currentMarker.status === 'funding'
        && currentMarker.declarationId === marker.declarationId
        && currentMarker.fingerprint === marker.fingerprint
        && sameSource(currentMarker.source, marker.source)) {
        return { status: 'stale-lease', row: current };
    }
    return { status: 'conflict', row: current };
}

/**
 * Finish an already published funding reservation. Kept separate from reserve
 * so callers can durably bind any cross-key exclusion fences before the first
 * source intent/debit is allowed to exist.
 */
export async function settleReservedWarDeclarationFunding<T extends Record<string, unknown>>(
    store: FundingStore,
    plan: WarDeclarationFundingPlan<T>,
    reservation: Extract<WarDeclarationFundingReservation<T>, { status: 'acquired' | 'active' }>,
): Promise<WarDeclarationFundingResult<T>> {
    if (reservation.status === 'active') {
        const marker = markerFromRow(reservation.row);
        if (!marker) return { status: 'conflict', row: reservation.row };
        const receipt = await confirmDebitReceipt(store, marker);
        return { status: 'active', row: reservation.row, replayed: true, receipt };
    }
    let debit: WarDeclarationDebitResult;
    try {
        debit = await debitWarDeclarationFunding(store, plan.warKey, reservation.row, plan.now);
    } catch (error) {
        const reason: WarDeclarationFundingAbortReason | null = error instanceof Error
            ? error.message === 'war-declaration-funding-account-missing'
                ? 'account-missing'
                : error.message === 'war-declaration-funding-account-invalid'
                    ? 'account-invalid'
                    : error.message === 'war-declaration-funding-balance-invalid'
                        ? 'balance-invalid'
                        : null
            : null;
        if (reason) {
            const aborted = await abortWarDeclarationFunding(
                store,
                plan.warKey,
                reservation.row,
                reason,
                plan.now,
            );
            if (aborted.status === 'funded') {
                const activation = await activateWarDeclarationFunding(store, plan.warKey, reservation.row, plan.now);
                if (activation.status === 'active') {
                    return {
                        status: 'active',
                        row: activation.row,
                        replayed: true,
                        receipt: aborted.receipt,
                    };
                }
            }
        }
        throw error;
    }
    if (debit.status === 'insufficient') {
        const aborted = await abortWarDeclarationFunding(
            store,
            plan.warKey,
            reservation.row,
            'insufficient',
            plan.now,
        );
        if (aborted.status === 'funded') {
            const activation = await activateWarDeclarationFunding(store, plan.warKey, reservation.row, plan.now);
            if (activation.status !== 'active') return activation;
            return {
                status: 'active',
                row: activation.row,
                replayed: true,
                receipt: aborted.receipt,
            };
        }
        if (aborted.status === 'stale-lease') return aborted;
        if (aborted.status === 'conflict') return aborted;
        return debit;
    }
    if (debit.status === 'source-fenced') {
        const aborted = await abortWarDeclarationFunding(
            store,
            plan.warKey,
            reservation.row,
            'source-fenced',
            plan.now,
        );
        if (aborted.status === 'funded') {
            const activation = await activateWarDeclarationFunding(store, plan.warKey, reservation.row, plan.now);
            if (activation.status !== 'active') return activation;
            return { status: 'active', row: activation.row, replayed: true, receipt: aborted.receipt };
        }
        if (aborted.status === 'conflict' || aborted.status === 'stale-lease') return aborted;
        return { status: 'stale-lease', row: aborted.row };
    }
    if (debit.status === 'stale-lease') return debit;
    const activation = await activateWarDeclarationFunding(store, plan.warKey, reservation.row, plan.now);
    if (activation.status !== 'active') return activation;
    return {
        status: 'active',
        row: activation.row,
        replayed: reservation.replayed || debit.replayed || activation.replayed,
        receipt: debit.receipt,
    };
}

/** Full row-first saga. Stage exports above exist for deterministic crash recovery tests and handlers. */
export async function fundAndActivateWarDeclaration<T extends Record<string, unknown>>(
    store: FundingStore,
    plan: WarDeclarationFundingPlan<T>,
): Promise<WarDeclarationFundingResult<T>> {
    const reservation = await reserveWarDeclarationFunding(store, plan);
    if (reservation.status === 'busy' || reservation.status === 'conflict') return reservation;
    return settleReservedWarDeclarationFunding(store, plan, reservation);
}
