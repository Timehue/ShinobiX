import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from './_storage.js';
import {
    WAR_DECLARATION_FUNDING_FIELD,
    warDeclarationFundingMarkerFromRow,
    warDeclarationFundingSourceProofState,
    type WarDeclarationFundingSource,
} from './_war-declaration-funding.js';

type ReservationStore = Pick<KvLike, 'get' | 'compareSet'>;

export const VILLAGE_WAR_RESERVATION_VERSION = 1;
export const VILLAGE_WAR_GENERATION_VERSION = 1;
export const VILLAGE_WAR_RESERVATION_PREFIX = 'world:village-war-reservation:';
export const VILLAGE_WAR_GENERATION_PREFIX = 'world:village-war-generation:';

export type VillageWarReservationState = 'claiming' | 'reserved' | 'released';
export type VillageWarReservationReleaseReason =
    | 'claim-conflict'
    | 'funding-aborted'
    | 'funding-conflict'
    | 'sector-published'
    | 'war-ended';

export interface VillageWarReservationRow {
    version: 1;
    state: VillageWarReservationState;
    village: string;
    pairId: string;
    warKey: string;
    generation: number;
    declarationId: string;
    fingerprint: string;
    source: WarDeclarationFundingSource;
    ownerId: string;
    claimedAt: number;
    leaseExpiresAt: number;
    reservedAt?: number;
    releasedAt?: number;
    releaseReason?: VillageWarReservationReleaseReason;
}

export interface VillageWarReservationPlan {
    pairId: string;
    warKey: string;
    villages: [string, string];
    generation: number;
    declarationId: string;
    fingerprint: string;
    source: WarDeclarationFundingSource;
    ownerId: string;
    now: number;
    leaseMs: number;
}

export interface VillageWarGenerationRow {
    version: 1;
    pairId: string;
    generation: number;
    declarationId: string;
    allocatedAt: number;
}

export type VillageWarReservationClaimResult =
    | { status: 'acquired'; rows: [VillageWarReservationRow, VillageWarReservationRow] }
    | { status: 'busy' | 'blocked'; village: string; row: VillageWarReservationRow | Record<string, unknown> };

export type VillageWarReservationPromotionResult =
    | { status: 'reserved'; rows: [VillageWarReservationRow, VillageWarReservationRow]; replayed: boolean }
    | { status: 'conflict'; rows: VillageWarReservationRow[] };

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

export function normalizedWarVillage(village: string): string {
    return String(village ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function villageWarReservationKey(village: string): string {
    const normalized = normalizedWarVillage(village);
    if (!normalized) throw new TypeError('Village reservation key requires a village.');
    return `${VILLAGE_WAR_RESERVATION_PREFIX}${normalized}`;
}

export function villageWarGenerationKey(pairId: string): string {
    const normalized = String(pairId ?? '').trim();
    if (!/^[a-z0-9]+-vs-[a-z0-9]+$/.test(normalized)) {
        throw new TypeError('Village-war generation key requires a canonical pair id.');
    }
    return `${VILLAGE_WAR_GENERATION_PREFIX}${normalized}`;
}

function cleanSource(value: unknown): WarDeclarationFundingSource | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Partial<WarDeclarationFundingSource>;
    const amount = nonnegativeSafeInteger(source.amount);
    const recordKey = String(source.recordKey ?? '').trim();
    const accountId = String(source.accountId ?? '').trim();
    if ((source.kind !== 'war-resources' && source.kind !== 'honor-seals')
        || amount === null || !recordKey || !accountId) return null;
    return { kind: source.kind, recordKey, accountId, amount };
}

function cleanReservation(value: unknown): VillageWarReservationRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Partial<VillageWarReservationRow>;
    const source = cleanSource(row.source);
    const village = String(row.village ?? '').trim();
    const pairId = String(row.pairId ?? '').trim();
    const warKey = String(row.warKey ?? '').trim();
    const declarationId = String(row.declarationId ?? '').trim();
    const fingerprint = String(row.fingerprint ?? '').trim();
    const ownerId = String(row.ownerId ?? '').trim();
    const generation = positiveSafeInteger(row.generation);
    const claimedAt = positiveSafeInteger(row.claimedAt);
    const leaseExpiresAt = positiveSafeInteger(row.leaseExpiresAt);
    const reservedAt = row.reservedAt === undefined ? undefined : positiveSafeInteger(row.reservedAt);
    const releasedAt = row.releasedAt === undefined ? undefined : positiveSafeInteger(row.releasedAt);
    if (row.version !== VILLAGE_WAR_RESERVATION_VERSION
        || (row.state !== 'claiming' && row.state !== 'reserved' && row.state !== 'released')
        || !village || !pairId || !warKey || generation === null || !declarationId
        || !/^[a-f0-9]{64}$/.test(fingerprint) || !source || !ownerId
        || claimedAt === null || leaseExpiresAt === null) return null;
    if ((row.reservedAt !== undefined && reservedAt === null)
        || (row.releasedAt !== undefined && releasedAt === null)) return null;
    if (row.state === 'claiming' && (reservedAt !== undefined || releasedAt !== undefined || row.releaseReason !== undefined)) return null;
    if (row.state === 'reserved' && (reservedAt === undefined || releasedAt !== undefined || row.releaseReason !== undefined)) return null;
    if (row.state === 'released'
        && (releasedAt === undefined
            || (row.releaseReason !== 'claim-conflict'
                && row.releaseReason !== 'funding-aborted'
                && row.releaseReason !== 'funding-conflict'
                && row.releaseReason !== 'sector-published'
                && row.releaseReason !== 'war-ended'))) return null;
    return {
        version: 1,
        state: row.state,
        village,
        pairId,
        warKey,
        generation,
        declarationId,
        fingerprint,
        source,
        ownerId,
        claimedAt,
        leaseExpiresAt,
        ...(reservedAt === undefined || reservedAt === null ? {} : { reservedAt }),
        ...(releasedAt === undefined || releasedAt === null ? {} : { releasedAt }),
        ...(row.releaseReason === undefined ? {} : { releaseReason: row.releaseReason }),
    };
}

function sameDeclaration(row: VillageWarReservationRow, plan: VillageWarReservationPlan): boolean {
    return row.pairId === plan.pairId
        && row.warKey === plan.warKey
        && row.generation === plan.generation
        && row.declarationId === plan.declarationId
        && row.fingerprint === plan.fingerprint
        && row.source.kind === plan.source.kind
        && row.source.recordKey === plan.source.recordKey
        && row.source.accountId === plan.source.accountId
        && row.source.amount === plan.source.amount;
}

function validatePlan(plan: VillageWarReservationPlan): void {
    const normalizedVillages = plan.villages.map(normalizedWarVillage);
    if (normalizedVillages.some(village => !village) || normalizedVillages[0] === normalizedVillages[1]) {
        throw new TypeError('Two distinct villages are required.');
    }
    if (!/^[a-z0-9]+-vs-[a-z0-9]+$/.test(plan.pairId)
        || !plan.warKey.trim() || !plan.declarationId.trim() || !plan.ownerId.trim()
        || !/^[a-f0-9]{64}$/.test(plan.fingerprint)
        || positiveSafeInteger(plan.generation) === null
        || positiveSafeInteger(plan.now) === null
        || positiveSafeInteger(plan.leaseMs) === null
        || !cleanSource(plan.source)) {
        throw new TypeError('Village-war reservation plan is invalid.');
    }
    if (!Number.isSafeInteger(plan.now + plan.leaseMs)) {
        throw new TypeError('Village-war reservation lease deadline exceeds the safe integer range.');
    }
}

function claimingRow(plan: VillageWarReservationPlan, village: string): VillageWarReservationRow {
    return {
        version: 1,
        state: 'claiming',
        village,
        pairId: plan.pairId,
        warKey: plan.warKey,
        generation: plan.generation,
        declarationId: plan.declarationId,
        fingerprint: plan.fingerprint,
        source: jsonClone(plan.source),
        ownerId: plan.ownerId,
        claimedAt: plan.now,
        leaseExpiresAt: plan.now + plan.leaseMs,
    };
}

async function exactCompareSet<T extends object>(
    store: ReservationStore,
    key: string,
    expected: unknown | null,
    desired: T,
): Promise<{ committed: true; row: T } | { committed: false; row: Record<string, unknown> | null }> {
    const intended = jsonClone(desired);
    try {
        if (await store.compareSet(key, expected, intended)) return { committed: true, row: intended };
    } catch (error) {
        const recovered = await store.get<Record<string, unknown>>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, intended)) return { committed: true, row: intended };
        throw error;
    }
    const current = await store.get<Record<string, unknown>>(key);
    if (isDeepStrictEqual(current, intended)) return { committed: true, row: intended };
    return { committed: false, row: current };
}

async function reservationBlocksRow(
    store: ReservationStore,
    row: VillageWarReservationRow,
    now: number,
): Promise<boolean> {
    if (row.state === 'released') return false;
    const war = await store.get<Record<string, unknown>>(row.warKey);
    if (war) {
        if (row.declarationId.startsWith('sector:')) {
            const marker = warDeclarationFundingMarkerFromRow(war);
            if (marker
                && marker.declarationId === row.declarationId
                && marker.fingerprint === row.fingerprint) {
                // While funding, the durable village rows bridge the cross-key
                // admission window. Activation atomically makes the sector row
                // visible to authoritative sector scans, so the temporary rows
                // may stop blocking and a different sector front may proceed.
                if (marker.status === 'funding') return true;
                if (marker.status === 'aborted') return false;
                const endsAt = positiveSafeInteger(war.endsAt);
                const terminal = war.flipped === true || positiveSafeInteger(war.expiredAt) !== null;
                // At the deadline an active row leaves the live scan before due
                // settlement stamps it. Keep the durable pointer blocking only
                // across that hand-off gap.
                return !terminal && endsAt !== null && now >= endsAt;
            }
            if (Object.prototype.hasOwnProperty.call(war, WAR_DECLARATION_FUNDING_FIELD)) return true;
            const endsAt = positiveSafeInteger(war.endsAt);
            const expiredAt = war.expiredAt === undefined ? null : positiveSafeInteger(war.expiredAt);
            return war.flipped !== true && expiredAt === null && endsAt !== null && now < endsAt;
        }
        const endedAt = positiveSafeInteger(war.endedAt);
        const marker = warDeclarationFundingMarkerFromRow(war);
        if (marker
            && marker.declarationId === row.declarationId
            && marker.fingerprint === row.fingerprint) {
            if (marker.status === 'aborted' || endedAt !== null) return false;
            return marker.status === 'funding' || marker.status === 'active';
        }
        // A different live successor at the pair key is still an occupation of
        // this village. An ended row is safe for a new generation to replace.
        return endedAt === null;
    }
    if (row.state === 'claiming') return row.leaseExpiresAt > now;
    const proof = await warDeclarationFundingSourceProofState(store, row);
    return proof !== 'aborted';
}

/** Fail-closed occupation predicate used by sector-war/village-war exclusion. */
export async function villageWarReservationBlocks(
    store: ReservationStore,
    village: string,
    now: number = Date.now(),
    ignore?: Pick<VillageWarReservationRow, 'declarationId' | 'fingerprint'>,
): Promise<boolean> {
    if (positiveSafeInteger(now) === null) throw new TypeError('Reservation clock must be a positive safe integer.');
    const raw = await store.get<Record<string, unknown>>(villageWarReservationKey(village));
    if (!raw) return false;
    const row = cleanReservation(raw);
    if (!row) return true;
    if (ignore && row.declarationId === ignore.declarationId && row.fingerprint === ignore.fingerprint) return false;
    return reservationBlocksRow(store, row, now);
}

/**
 * Claim both village authorities in canonical key order. Every claim is exact
 * CAS. A partial fresh claim is converted to a durable released row on conflict;
 * a pre-existing reservation is never rolled back by this helper.
 */
export async function claimVillageWarReservations(
    store: ReservationStore,
    plan: VillageWarReservationPlan,
): Promise<VillageWarReservationClaimResult> {
    validatePlan(plan);
    const ordered = [...plan.villages]
        .map(village => ({ village, key: villageWarReservationKey(village) }))
        .sort((left, right) => left.key.localeCompare(right.key));
    const acquired: VillageWarReservationRow[] = [];
    const newlyClaimed: VillageWarReservationRow[] = [];

    for (const target of ordered) {
        let completed = false;
        for (let attempt = 0; attempt < 8 && !completed; attempt += 1) {
            const raw = await store.get<Record<string, unknown>>(target.key);
            const current = cleanReservation(raw);
            if (raw && !current) {
                await releaseVillageWarReservations(store, plan, 'claim-conflict', plan.now, newlyClaimed);
                return { status: 'blocked', village: target.village, row: raw };
            }
            if (current && sameDeclaration(current, plan)) {
                if (current.state === 'reserved'
                    || (current.state === 'claiming' && current.ownerId === plan.ownerId && current.leaseExpiresAt > plan.now)) {
                    acquired.push(current);
                    completed = true;
                    break;
                }
                if (current.state === 'claiming' && current.leaseExpiresAt > plan.now) {
                    await releaseVillageWarReservations(store, plan, 'claim-conflict', plan.now, newlyClaimed);
                    return { status: 'busy', village: target.village, row: current };
                }
                // Same generation after a crash: an expired claim/released row
                // may be adopted by the new execution. A durable reserved row was
                // handled above and never changes owner merely due to wall time.
            } else if (current && await reservationBlocksRow(store, current, plan.now)) {
                await releaseVillageWarReservations(store, plan, 'claim-conflict', plan.now, newlyClaimed);
                return { status: 'blocked', village: target.village, row: current };
            }

            const desired = claimingRow(plan, target.village);
            const publication = await exactCompareSet(store, target.key, raw, desired);
            if (publication.committed) {
                acquired.push(publication.row);
                newlyClaimed.push(publication.row);
                completed = true;
            }
        }
        if (!completed) {
            await releaseVillageWarReservations(store, plan, 'claim-conflict', plan.now, newlyClaimed);
            const raw = await store.get<Record<string, unknown>>(target.key);
            return { status: 'busy', village: target.village, row: cleanReservation(raw) ?? raw ?? {} };
        }
    }
    return { status: 'acquired', rows: acquired as [VillageWarReservationRow, VillageWarReservationRow] };
}

/** Bind both claimed village rows permanently to the published funding row. */
export async function reserveClaimedVillageWarReservations(
    store: ReservationStore,
    plan: VillageWarReservationPlan,
): Promise<VillageWarReservationPromotionResult> {
    validatePlan(plan);
    const war = await store.get<Record<string, unknown>>(plan.warKey);
    const marker = warDeclarationFundingMarkerFromRow(war);
    if (!war || !marker
        || (marker.status !== 'funding' && marker.status !== 'active')
        || marker.declarationId !== plan.declarationId
        || marker.fingerprint !== plan.fingerprint) {
        return { status: 'conflict', rows: [] };
    }
    const rows: VillageWarReservationRow[] = [];
    let replayed = true;
    const ordered = [...plan.villages]
        .map(village => ({ village, key: villageWarReservationKey(village) }))
        .sort((left, right) => left.key.localeCompare(right.key));
    for (const target of ordered) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const raw = await store.get<Record<string, unknown>>(target.key);
            const current = cleanReservation(raw);
            if (!current || !sameDeclaration(current, plan)) return { status: 'conflict', rows };
            if (current.state === 'reserved') {
                rows.push(current);
                break;
            }
            if (current.state !== 'claiming' || current.ownerId !== plan.ownerId) {
                return { status: 'conflict', rows };
            }
            const desired: VillageWarReservationRow = {
                ...current,
                state: 'reserved',
                reservedAt: plan.now,
            };
            const publication = await exactCompareSet(store, target.key, raw, desired);
            if (publication.committed) {
                rows.push(publication.row);
                replayed = false;
                break;
            }
            if (attempt === 7) return { status: 'conflict', rows };
        }
    }
    return { status: 'reserved', rows: rows as [VillageWarReservationRow, VillageWarReservationRow], replayed };
}

async function releaseIsSafe(store: ReservationStore, row: VillageWarReservationRow, now: number): Promise<boolean> {
    const war = await store.get<Record<string, unknown>>(row.warKey);
    if (!war) {
        if (row.state === 'claiming') return true;
        return (await warDeclarationFundingSourceProofState(store, row)) === 'aborted';
    }
    const marker = warDeclarationFundingMarkerFromRow(war);
    if (marker && marker.declarationId === row.declarationId && marker.fingerprint === row.fingerprint) {
        if (row.declarationId.startsWith('sector:')) {
            // `active` is the exact visibility hand-off: sector scans now own
            // exclusion. `aborted` proves there is no playable contest.
            if (marker.status === 'aborted') return true;
            if (marker.status !== 'active') return false;
            const endsAt = positiveSafeInteger(war.endsAt);
            const terminal = war.flipped === true || positiveSafeInteger(war.expiredAt) !== null;
            return terminal || (endsAt !== null && now < endsAt);
        }
        return marker.status === 'aborted' || positiveSafeInteger(war.endedAt) !== null;
    }
    // A claiming row whose declaration never became the pair authority has no
    // source intent: exact publication always precedes promotion/debit.
    if (row.state === 'claiming') return true;
    return positiveSafeInteger(war.endedAt) !== null;
}

/** Release only exact rows whose pair/source authority proves no live debit saga. */
export async function releaseVillageWarReservations(
    store: ReservationStore,
    plan: VillageWarReservationPlan,
    reason: VillageWarReservationReleaseReason,
    releasedAt: number,
    candidates?: VillageWarReservationRow[],
): Promise<number> {
    validatePlan(plan);
    if (positiveSafeInteger(releasedAt) === null) throw new TypeError('Reservation release clock is invalid.');
    const villages = candidates?.map(row => row.village) ?? [...plan.villages];
    let released = 0;
    for (const village of villages) {
        const key = villageWarReservationKey(village);
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const raw = await store.get<Record<string, unknown>>(key);
            const current = cleanReservation(raw);
            if (!current || !sameDeclaration(current, plan) || current.state === 'released') break;
            if (!(await releaseIsSafe(store, current, releasedAt))) break;
            const desired: VillageWarReservationRow = {
                ...current,
                state: 'released',
                releasedAt,
                releaseReason: reason,
            };
            delete desired.reservedAt;
            const publication = await exactCompareSet(store, key, raw, desired);
            if (publication.committed) {
                released += 1;
                break;
            }
        }
    }
    return released;
}

/** Allocate a permanent, monotonic generation for one pair (gaps are harmless). */
export async function allocateVillageWarDeclarationGeneration(
    store: ReservationStore,
    pairId: string,
    minimumGeneration: number,
    now: number,
): Promise<VillageWarGenerationRow> {
    const key = villageWarGenerationKey(pairId);
    const minimum = positiveSafeInteger(minimumGeneration);
    if (minimum === null || positiveSafeInteger(now) === null) {
        throw new TypeError('Village-war generation floor and clock must be positive safe integers.');
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const raw = await store.get<Record<string, unknown>>(key);
        let prior = 0;
        if (raw) {
            const version = raw.version;
            const storedPair = String(raw.pairId ?? '').trim();
            const storedGeneration = positiveSafeInteger(raw.generation);
            const storedDeclaration = String(raw.declarationId ?? '').trim();
            const allocatedAt = positiveSafeInteger(raw.allocatedAt);
            if (version !== VILLAGE_WAR_GENERATION_VERSION || storedPair !== pairId
                || storedGeneration === null || !storedDeclaration || allocatedAt === null) {
                throw new Error('village-war-generation-row-invalid');
            }
            prior = storedGeneration;
        }
        const generation = Math.max(minimum, prior + 1);
        if (!Number.isSafeInteger(generation)) throw new Error('village-war-generation-overflow');
        const desired: VillageWarGenerationRow = {
            version: 1,
            pairId,
            generation,
            declarationId: `v2:${pairId}:g${generation}`,
            allocatedAt: now,
        };
        const publication = await exactCompareSet(store, key, raw, desired);
        if (publication.committed) return publication.row;
    }
    throw new Error('village-war-generation-busy');
}

/** Narrow parser for diagnostics/tests; malformed rows intentionally return null. */
export function villageWarReservationFromRow(value: unknown): VillageWarReservationRow | null {
    return cleanReservation(value);
}

/** Whether an exact reservation belongs to a specific declaration plan. */
export function villageWarReservationMatchesPlan(
    value: unknown,
    plan: VillageWarReservationPlan,
): value is VillageWarReservationRow {
    const row = cleanReservation(value);
    return !!row && sameDeclaration(row, plan);
}

/** Funding-field presence helper retained here so callers can fail closed on malformed rows. */
export function villageWarRowHasFundingAuthority(value: unknown): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, WAR_DECLARATION_FUNDING_FIELD);
}
