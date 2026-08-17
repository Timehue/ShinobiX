import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from './_storage.js';
import { syncCurrencyLedger } from './_currency-ledger.js';
import { mergePreservingImages } from './_utils.js';
import { versionedPlayerRecord } from './save/_mutate-player-save.js';

type MercenaryHireStore = Pick<KvLike, 'get' | 'set' | 'compareSet'>;

export const WAR_MERCENARY_FUNDING_FIELD = 'mercenaryFunding';
export const WAR_MERCENARY_RECEIPTS_FIELD = 'mercenaryHireReceipts';
export const PLAYER_WAR_MERCENARY_RECEIPTS_FIELD = 'warMercenaryHireReceipts';
export const MAX_WAR_MERCENARY_RECEIPTS = 4_096;
export const MAX_PLAYER_WAR_MERCENARY_RECEIPTS = 4_096;
const VILLAGE_WAR_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1_000;

export interface WarMercenaryHireIdentity {
    hireId: string;
    warId: string;
    warToken: string;
    generation: number;
    warEndsAt: number;
    player: string;
    displayName: string;
    village: string;
    enemy: string;
    tierId: string;
    costSeals: number;
    warDamage: number;
    sourceKey: string;
}

export interface WarMercenaryFundingMarker extends WarMercenaryHireIdentity {
    version: 1;
    status: 'funding';
    fingerprint: string;
    ownerId: string;
    createdAt: number;
}

export interface WarMercenaryDebitIntent extends WarMercenaryHireIdentity {
    version: 1;
    state: 'pending' | 'aborted';
    fingerprint: string;
    ownerId: string;
    reservedAt: number;
    abortedAt?: number;
}

export interface WarMercenaryDebitReceipt extends WarMercenaryHireIdentity {
    version: 1;
    state: 'committed';
    fingerprint: string;
    ownerId: string;
    reservedAt: number;
    balanceBefore: number;
    balanceAfter: number;
    debitedAt: number;
}

export interface WarMercenaryAppliedReceipt extends WarMercenaryHireIdentity {
    version: 1;
    state: 'applied';
    fingerprint: string;
    ownerId: string;
    balanceAfter: number;
    dealt: number;
    enemyHp: number;
    appliedAt: number;
}

type WarMercenarySourceEntry = WarMercenaryDebitIntent | WarMercenaryDebitReceipt;

export interface WarMercenaryHirePlan extends WarMercenaryHireIdentity {
    warKey: string;
    fingerprint: string;
    ownerId: string;
    now: number;
    expectedWar: Record<string, unknown>;
}

export type WarMercenaryHireResult =
    | {
        status: 'active';
        row: Record<string, unknown>;
        receipt: WarMercenaryAppliedReceipt;
        sourceRow: Record<string, unknown>;
        replayed: boolean;
    }
    | { status: 'insufficient'; have: number; cost: number }
    | { status: 'expired'; row: Record<string, unknown> }
    | { status: 'busy'; row: Record<string, unknown> }
    | { status: 'conflict'; row: Record<string, unknown> | null }
    | { status: 'blocked'; reason: string; row: Record<string, unknown> | null };

function jsonClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function warMercenaryHireFingerprint(identity: WarMercenaryHireIdentity): string {
    return createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

export function newWarMercenaryFundingOwnerId(): string {
    return randomUUID();
}

function positiveSafeInteger(value: unknown): number | null {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonnegativeSafeInteger(value: unknown): number | null {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function cleanIdentity(value: unknown): WarMercenaryHireIdentity | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Partial<WarMercenaryHireIdentity>;
    const hireId = String(raw.hireId ?? '').trim();
    const warId = String(raw.warId ?? '').trim();
    const warToken = String(raw.warToken ?? '').trim();
    const generation = positiveSafeInteger(raw.generation);
    const warEndsAt = positiveSafeInteger(raw.warEndsAt);
    const player = String(raw.player ?? '').trim();
    const displayName = String(raw.displayName ?? '').trim();
    const village = String(raw.village ?? '').trim();
    const enemy = String(raw.enemy ?? '').trim();
    const tierId = String(raw.tierId ?? '').trim();
    const costSeals = nonnegativeSafeInteger(raw.costSeals);
    const warDamage = positiveSafeInteger(raw.warDamage);
    const sourceKey = String(raw.sourceKey ?? '').trim();
    if (!hireId || !warId || !warToken || generation === null || warEndsAt === null || !player || !displayName
        || !village || !enemy || village === enemy || !tierId
        || costSeals === null || warDamage === null || !sourceKey) return null;
    return {
        hireId,
        warId,
        warToken,
        generation,
        warEndsAt,
        player,
        displayName,
        village,
        enemy,
        tierId,
        costSeals,
        warDamage,
        sourceKey,
    };
}

function sameIdentity(left: WarMercenaryHireIdentity, right: WarMercenaryHireIdentity): boolean {
    return isDeepStrictEqual(cleanIdentity(left), cleanIdentity(right));
}

function cleanMarker(value: unknown): WarMercenaryFundingMarker | null {
    const identity = cleanIdentity(value);
    if (!identity || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Partial<WarMercenaryFundingMarker>;
    const fingerprint = String(raw.fingerprint ?? '').trim();
    const ownerId = String(raw.ownerId ?? '').trim();
    const createdAt = positiveSafeInteger(raw.createdAt);
    if (raw.version !== 1 || raw.status !== 'funding' || !/^[a-f0-9]{64}$/.test(fingerprint)
        || fingerprint !== warMercenaryHireFingerprint(identity) || !ownerId || createdAt === null
        || createdAt >= identity.warEndsAt) return null;
    return { version: 1, status: 'funding', ...identity, fingerprint, ownerId, createdAt };
}

export function warMercenaryFundingMarkerFromRow(row: unknown): WarMercenaryFundingMarker | null {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    return cleanMarker((row as Record<string, unknown>)[WAR_MERCENARY_FUNDING_FIELD]);
}

export function warHasMercenaryFundingField(row: unknown): boolean {
    return !!row && typeof row === 'object' && !Array.isArray(row)
        && Object.prototype.hasOwnProperty.call(row, WAR_MERCENARY_FUNDING_FIELD);
}

function cleanSourceEntry(value: unknown): WarMercenarySourceEntry | null {
    const identity = cleanIdentity(value);
    if (!identity || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Partial<WarMercenarySourceEntry>;
    const fingerprint = String(raw.fingerprint ?? '').trim();
    const ownerId = String(raw.ownerId ?? '').trim();
    const reservedAt = positiveSafeInteger(raw.reservedAt);
    if (raw.version !== 1 || (raw.state !== 'pending' && raw.state !== 'aborted' && raw.state !== 'committed')
        || !/^[a-f0-9]{64}$/.test(fingerprint) || fingerprint !== warMercenaryHireFingerprint(identity)
        || !ownerId || reservedAt === null) return null;
    if (raw.state === 'committed') {
        const balanceBefore = nonnegativeSafeInteger(raw.balanceBefore);
        const balanceAfter = nonnegativeSafeInteger(raw.balanceAfter);
        const debitedAt = positiveSafeInteger(raw.debitedAt);
        if (balanceBefore === null || balanceAfter === null || debitedAt === null
            || balanceBefore - identity.costSeals !== balanceAfter) return null;
        return {
            version: 1,
            state: 'committed',
            ...identity,
            fingerprint,
            ownerId,
            reservedAt,
            balanceBefore,
            balanceAfter,
            debitedAt,
        };
    }
    const abortedAt = raw.state === 'aborted' ? positiveSafeInteger(raw.abortedAt) : undefined;
    if (raw.state === 'aborted' && abortedAt === null) return null;
    return {
        version: 1,
        state: raw.state,
        ...identity,
        fingerprint,
        ownerId,
        reservedAt,
        ...(typeof abortedAt === 'number' ? { abortedAt } : {}),
    };
}

function cleanAppliedReceipt(value: unknown): WarMercenaryAppliedReceipt | null {
    const identity = cleanIdentity(value);
    if (!identity || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Partial<WarMercenaryAppliedReceipt>;
    const fingerprint = String(raw.fingerprint ?? '').trim();
    const ownerId = String(raw.ownerId ?? '').trim();
    const balanceAfter = nonnegativeSafeInteger(raw.balanceAfter);
    const dealt = nonnegativeSafeInteger(raw.dealt);
    const enemyHp = positiveSafeInteger(raw.enemyHp);
    const appliedAt = positiveSafeInteger(raw.appliedAt);
    if (raw.version !== 1 || raw.state !== 'applied' || !/^[a-f0-9]{64}$/.test(fingerprint)
        || fingerprint !== warMercenaryHireFingerprint(identity) || !ownerId
        || balanceAfter === null || dealt === null || enemyHp === null || appliedAt === null) return null;
    return {
        version: 1,
        state: 'applied',
        ...identity,
        fingerprint,
        ownerId,
        balanceAfter,
        dealt,
        enemyHp,
        appliedAt,
    };
}

function recordMap(row: Record<string, unknown>, field: string): Record<string, unknown> {
    const value = row[field];
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function recordMapIsMalformed(row: Record<string, unknown>, field: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(row, field)) return false;
    const value = row[field];
    return !value || typeof value !== 'object' || Array.isArray(value);
}

export function warMercenaryAppliedReceiptFromRow(
    row: unknown,
    hireId: string,
): WarMercenaryAppliedReceipt | null {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const raw = recordMap(row as Record<string, unknown>, WAR_MERCENARY_RECEIPTS_FIELD)[hireId];
    return cleanAppliedReceipt(raw);
}

function sourceEntryFromRow(row: Record<string, unknown>, marker: WarMercenaryFundingMarker): WarMercenarySourceEntry | null {
    const character = row.character;
    if (!character || typeof character !== 'object' || Array.isArray(character)) return null;
    const entry = cleanSourceEntry(recordMap(character as Record<string, unknown>, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD)[marker.fingerprint]);
    if (!entry || entry.fingerprint !== marker.fingerprint || !sameIdentity(entry, marker)) return null;
    return entry;
}

function sourceHasEntry(row: Record<string, unknown>, marker: WarMercenaryFundingMarker): boolean {
    const character = row.character;
    return !!character && typeof character === 'object' && !Array.isArray(character)
        && Object.prototype.hasOwnProperty.call(
            recordMap(character as Record<string, unknown>, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD),
            marker.fingerprint,
        );
}

function warHasReceiptEntry(row: Record<string, unknown>, hireId: string): boolean {
    return Object.prototype.hasOwnProperty.call(recordMap(row, WAR_MERCENARY_RECEIPTS_FIELD), hireId);
}

function projectSourceEntry(
    current: Record<string, unknown>,
    marker: WarMercenaryFundingMarker,
    entry: WarMercenarySourceEntry,
    balance?: number,
): Record<string, unknown> {
    const character = current.character;
    if (!character || typeof character !== 'object' || Array.isArray(character)) {
        throw new Error('war-mercenary-account-invalid');
    }
    const holder = character as Record<string, unknown>;
    if (recordMapIsMalformed(holder, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD)) {
        throw new Error('war-mercenary-source-receipts-invalid');
    }
    const priorWarMercs = holder.warMercs;
    const warMercs = priorWarMercs && typeof priorWarMercs === 'object' && !Array.isArray(priorWarMercs)
        && String((priorWarMercs as Record<string, unknown>).warId ?? '') === marker.warToken
        ? {
            warId: marker.warToken,
            tiers: Array.isArray((priorWarMercs as Record<string, unknown>).tiers)
                ? [...(priorWarMercs as Record<string, unknown>).tiers as unknown[]].map(String)
                : [] as string[],
        }
        : { warId: marker.warToken, tiers: [] as string[] };
    if (entry.state === 'committed' && !warMercs.tiers.includes(marker.tierId)) warMercs.tiers.push(marker.tierId);
    const nextCharacter = {
        ...holder,
        ...(balance === undefined ? {} : { honorSeals: balance }),
        ...(entry.state === 'committed' ? { warMercs } : {}),
        [PLAYER_WAR_MERCENARY_RECEIPTS_FIELD]: {
            ...recordMap(holder, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD),
            [marker.fingerprint]: entry,
        },
    };
    const versioned = versionedPlayerRecord(current, nextCharacter);
    return mergePreservingImages(versioned.record, current) as Record<string, unknown>;
}

function validatePlan(plan: WarMercenaryHirePlan): WarMercenaryHireIdentity {
    const identity = cleanIdentity(plan);
    if (!identity || !plan.warKey.trim() || !plan.ownerId.trim() || positiveSafeInteger(plan.now) === null
        || !/^[a-f0-9]{64}$/.test(plan.fingerprint)
        || plan.fingerprint !== warMercenaryHireFingerprint(identity)
        || !plan.expectedWar || typeof plan.expectedWar !== 'object' || Array.isArray(plan.expectedWar)) {
        throw new TypeError('Invalid war mercenary funding plan.');
    }
    const rowId = String(plan.expectedWar.id ?? '').trim();
    const generation = positiveSafeInteger(plan.expectedWar.declarationGeneration ?? 1);
    const startedAt = positiveSafeInteger(plan.expectedWar.startedAt);
    const pendingUntil = plan.expectedWar.pendingUntil === undefined
        ? undefined
        : positiveSafeInteger(plan.expectedWar.pendingUntil);
    const effectiveStart = pendingUntil ?? startedAt;
    const boundedEnd = effectiveStart === null || effectiveStart === undefined
        ? null
        : effectiveStart + VILLAGE_WAR_MAX_DURATION_MS;
    const villages = Array.isArray(plan.expectedWar.villages) ? plan.expectedWar.villages.map(String) : [];
    const hp = plan.expectedWar.hp;
    const enemyHp = hp && typeof hp === 'object' && !Array.isArray(hp)
        ? positiveSafeInteger((hp as Record<string, unknown>)[identity.enemy])
        : null;
    if (rowId !== identity.warId || generation !== identity.generation
        || startedAt === null || pendingUntil === null || boundedEnd === null
        || !Number.isSafeInteger(boundedEnd) || identity.warEndsAt !== boundedEnd
        || plan.now >= boundedEnd
        || villages.length !== 2 || !villages.includes(identity.village) || !villages.includes(identity.enemy)
        || plan.expectedWar.endedAt !== undefined || enemyHp === null) {
        throw new TypeError('War mercenary target is not an active exact generation.');
    }
    return identity;
}

function markerMatches(marker: WarMercenaryFundingMarker, fingerprint: string): boolean {
    return marker.fingerprint === fingerprint;
}

async function reserveWarMercenaryFunding(
    store: MercenaryHireStore,
    plan: WarMercenaryHirePlan,
): Promise<{ status: 'acquired'; row: Record<string, unknown>; replayed: boolean }
    | { status: 'active'; row: Record<string, unknown>; receipt: WarMercenaryAppliedReceipt }
    | { status: 'busy'; row: Record<string, unknown> }
    | { status: 'conflict'; row: Record<string, unknown> | null }
    | { status: 'blocked'; reason: string; row: Record<string, unknown> | null }> {
    const identity = validatePlan(plan);
    const current = await store.get<Record<string, unknown>>(plan.warKey);
    if (current) {
        if (recordMapIsMalformed(current, WAR_MERCENARY_RECEIPTS_FIELD)) {
            return { status: 'busy', row: current };
        }
        const applied = warMercenaryAppliedReceiptFromRow(current, identity.hireId);
        if (applied && sameIdentity(applied, identity)) {
            return { status: 'active', row: current, receipt: applied };
        }
        if (warHasReceiptEntry(current, identity.hireId)) return { status: 'busy', row: current };
        const existingMarker = warMercenaryFundingMarkerFromRow(current);
        if (existingMarker) {
            return markerMatches(existingMarker, plan.fingerprint)
                ? { status: 'acquired', row: current, replayed: true }
                : { status: 'busy', row: current };
        }
        if (warHasMercenaryFundingField(current)) return { status: 'busy', row: current };
        if (Object.keys(recordMap(current, WAR_MERCENARY_RECEIPTS_FIELD)).length >= MAX_WAR_MERCENARY_RECEIPTS) {
            return { status: 'blocked', reason: 'war-receipt-ledger-full', row: current };
        }
    }
    if (!isDeepStrictEqual(current, plan.expectedWar)) return { status: 'conflict', row: current };
    // Preflight source authority before publishing a marker. The route holds the
    // source lock around this helper; the exact post-marker source CAS remains
    // the stale-lease correctness boundary.
    const source = await store.get<Record<string, unknown>>(identity.sourceKey);
    const sourceCharacter = source?.character;
    if (!source || !sourceCharacter || typeof sourceCharacter !== 'object' || Array.isArray(sourceCharacter)) {
        return { status: 'blocked', reason: 'account-invalid', row: current };
    }
    const sourceHolder = sourceCharacter as Record<string, unknown>;
    if (String(sourceHolder.village ?? '').trim() !== identity.village) {
        return { status: 'blocked', reason: 'account-village-changed', row: current };
    }
    if (recordMapIsMalformed(sourceHolder, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD)) {
        return { status: 'blocked', reason: 'source-receipts-invalid', row: current };
    }
    const sourceReceipts = recordMap(sourceHolder, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD);
    if (!Object.prototype.hasOwnProperty.call(sourceReceipts, plan.fingerprint)
        && Object.keys(sourceReceipts).length >= MAX_PLAYER_WAR_MERCENARY_RECEIPTS) {
        return { status: 'blocked', reason: 'source-receipt-ledger-full', row: current };
    }
    const marker: WarMercenaryFundingMarker = {
        version: 1,
        status: 'funding',
        ...identity,
        fingerprint: plan.fingerprint,
        ownerId: plan.ownerId,
        createdAt: plan.now,
    };
    const desired = jsonClone({ ...plan.expectedWar, [WAR_MERCENARY_FUNDING_FIELD]: marker });
    try {
        if (await store.compareSet(plan.warKey, plan.expectedWar, desired)) {
            return { status: 'acquired', row: desired, replayed: false };
        }
    } catch (error) {
        const recovered = await store.get<Record<string, unknown>>(plan.warKey).catch(() => null);
        if (recovered && markerMatches(warMercenaryFundingMarkerFromRow(recovered) ?? marker, plan.fingerprint)
            && isDeepStrictEqual(recovered, desired)) {
            return { status: 'acquired', row: recovered, replayed: false };
        }
        throw error;
    }
    const raced = await store.get<Record<string, unknown>>(plan.warKey);
    const racedApplied = raced ? warMercenaryAppliedReceiptFromRow(raced, identity.hireId) : null;
    if (raced && racedApplied && sameIdentity(racedApplied, identity)) {
        return { status: 'active', row: raced, receipt: racedApplied };
    }
    const racedMarker = warMercenaryFundingMarkerFromRow(raced);
    if (raced && racedMarker && markerMatches(racedMarker, plan.fingerprint)) {
        return { status: 'acquired', row: raced, replayed: true };
    }
    return raced && warHasMercenaryFundingField(raced)
        ? { status: 'busy', row: raced }
        : { status: 'conflict', row: raced };
}

type SourceIntentResult =
    | { status: 'ready'; row: Record<string, unknown> }
    | { status: 'committed'; row: Record<string, unknown>; receipt: WarMercenaryDebitReceipt }
    | { status: 'blocked'; reason: string };

async function ensureSourceIntent(
    store: MercenaryHireStore,
    warKey: string,
    fundingRow: Record<string, unknown>,
    marker: WarMercenaryFundingMarker,
    now: number,
): Promise<SourceIntentResult> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!isDeepStrictEqual(await store.get<Record<string, unknown>>(warKey), fundingRow)) {
            return { status: 'blocked', reason: 'war-funding-row-changed' };
        }
        const current = await store.get<Record<string, unknown>>(marker.sourceKey);
        if (!current) return { status: 'blocked', reason: 'account-missing' };
        const character = current.character;
        if (!character || typeof character !== 'object' || Array.isArray(character)) {
            return { status: 'blocked', reason: 'account-invalid' };
        }
        if (recordMapIsMalformed(character as Record<string, unknown>, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD)) {
            return { status: 'blocked', reason: 'source-receipts-invalid' };
        }
        const entry = sourceEntryFromRow(current, marker);
        if (!entry && sourceHasEntry(current, marker)) {
            return { status: 'blocked', reason: 'source-receipt-invalid' };
        }
        if (entry?.state === 'committed') {
            return entry.ownerId === marker.ownerId
                ? { status: 'committed', row: current, receipt: entry }
                : { status: 'blocked', reason: 'source-owned-by-another-attempt' };
        }
        if (String((character as Record<string, unknown>).village ?? '').trim() !== marker.village) {
            return { status: 'blocked', reason: 'account-village-changed' };
        }
        const receipts = recordMap(character as Record<string, unknown>, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD);
        if (!Object.prototype.hasOwnProperty.call(receipts, marker.fingerprint)
            && Object.keys(receipts).length >= MAX_PLAYER_WAR_MERCENARY_RECEIPTS) {
            return { status: 'blocked', reason: 'source-receipt-ledger-full' };
        }
        if (entry?.state === 'pending' && entry.ownerId === marker.ownerId) {
            return { status: 'ready', row: current };
        }
        const pending: WarMercenaryDebitIntent = {
            version: 1,
            state: 'pending',
            ...cleanIdentity(marker)!,
            fingerprint: marker.fingerprint,
            ownerId: marker.ownerId,
            reservedAt: now,
        };
        const desired = projectSourceEntry(current, marker, pending);
        try {
            if (await store.compareSet(marker.sourceKey, current, desired)) return { status: 'ready', row: desired };
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(marker.sourceKey).catch(() => null);
            const recoveredEntry = recovered ? sourceEntryFromRow(recovered, marker) : null;
            if (recovered && recoveredEntry?.state === 'pending' && recoveredEntry.ownerId === marker.ownerId) {
                return { status: 'ready', row: recovered };
            }
            if (recovered && recoveredEntry?.state === 'committed' && recoveredEntry.ownerId === marker.ownerId) {
                return { status: 'committed', row: recovered, receipt: recoveredEntry };
            }
            throw error;
        }
    }
    return { status: 'blocked', reason: 'source-intent-busy' };
}

async function debitSource(
    store: MercenaryHireStore,
    warKey: string,
    fundingRow: Record<string, unknown>,
    marker: WarMercenaryFundingMarker,
    now: number,
): Promise<{ status: 'committed'; row: Record<string, unknown>; receipt: WarMercenaryDebitReceipt; replayed: boolean }
    | { status: 'insufficient'; have: number }
    | { status: 'blocked'; reason: string }> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const intent = await ensureSourceIntent(store, warKey, fundingRow, marker, now);
        if (intent.status === 'blocked') return intent;
        if (intent.status === 'committed') {
            await syncCurrencyLedger(marker.player, intent.row, { kv: store });
            return { ...intent, replayed: true };
        }
        if (!isDeepStrictEqual(await store.get<Record<string, unknown>>(warKey), fundingRow)) {
            return { status: 'blocked', reason: 'war-funding-row-changed' };
        }
        const character = intent.row.character as Record<string, unknown>;
        const balance = nonnegativeSafeInteger(character.honorSeals);
        if (balance === null) return { status: 'blocked', reason: 'balance-invalid' };
        if (balance < marker.costSeals) return { status: 'insufficient', have: balance };
        const sourceIntent = sourceEntryFromRow(intent.row, marker);
        if (!sourceIntent || sourceIntent.state !== 'pending' || sourceIntent.ownerId !== marker.ownerId) {
            return { status: 'blocked', reason: 'source-intent-fenced' };
        }
        const receipt: WarMercenaryDebitReceipt = {
            version: 1,
            state: 'committed',
            ...cleanIdentity(marker)!,
            fingerprint: marker.fingerprint,
            ownerId: marker.ownerId,
            reservedAt: sourceIntent.reservedAt,
            balanceBefore: balance,
            balanceAfter: balance - marker.costSeals,
            debitedAt: now,
        };
        const desired = projectSourceEntry(intent.row, marker, receipt, receipt.balanceAfter);
        try {
            if (await store.compareSet(marker.sourceKey, intent.row, desired)) {
                await syncCurrencyLedger(marker.player, desired, { kv: store });
                return { status: 'committed', row: desired, receipt, replayed: false };
            }
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(marker.sourceKey).catch(() => null);
            const recoveredReceipt = recovered ? sourceEntryFromRow(recovered, marker) : null;
            if (recovered && recoveredReceipt?.state === 'committed' && recoveredReceipt.ownerId === marker.ownerId) {
                await syncCurrencyLedger(marker.player, recovered, { kv: store });
                return { status: 'committed', row: recovered, receipt: recoveredReceipt, replayed: false };
            }
            throw error;
        }
    }
    return { status: 'blocked', reason: 'source-debit-busy' };
}

async function abortFunding(
    store: MercenaryHireStore,
    warKey: string,
    fundingRow: Record<string, unknown>,
    marker: WarMercenaryFundingMarker,
    now: number,
): Promise<'aborted' | 'funded' | 'blocked'> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!isDeepStrictEqual(await store.get<Record<string, unknown>>(warKey), fundingRow)) return 'blocked';
        const source = await store.get<Record<string, unknown>>(marker.sourceKey);
        if (!source || !source.character || typeof source.character !== 'object' || Array.isArray(source.character)) {
            // Do not unhide the target without a durable source fence: a paused
            // worker may still own an exact pending source snapshot.
            return 'blocked';
        }
        if (recordMapIsMalformed(source.character as Record<string, unknown>, PLAYER_WAR_MERCENARY_RECEIPTS_FIELD)) {
            return 'blocked';
        }
        const entry = sourceEntryFromRow(source, marker);
        if (!entry && sourceHasEntry(source, marker)) return 'blocked';
        if (entry?.state === 'committed') return entry.ownerId === marker.ownerId ? 'funded' : 'blocked';
        if (!(entry?.state === 'aborted' && entry.ownerId === marker.ownerId)) {
            const aborted: WarMercenaryDebitIntent = {
                version: 1,
                state: 'aborted',
                ...cleanIdentity(marker)!,
                fingerprint: marker.fingerprint,
                ownerId: marker.ownerId,
                reservedAt: entry?.reservedAt ?? now,
                abortedAt: now,
            };
            const desiredSource = projectSourceEntry(source, marker, aborted);
            try {
                if (!(await store.compareSet(marker.sourceKey, source, desiredSource))) continue;
            } catch (error) {
                const recovered = await store.get<Record<string, unknown>>(marker.sourceKey).catch(() => null);
                const recoveredEntry = recovered ? sourceEntryFromRow(recovered, marker) : null;
                if (!(recoveredEntry?.state === 'aborted' && recoveredEntry.ownerId === marker.ownerId)) throw error;
            }
        }
        const desiredWar = jsonClone(fundingRow);
        delete desiredWar[WAR_MERCENARY_FUNDING_FIELD];
        try {
            if (await store.compareSet(warKey, fundingRow, desiredWar)) return 'aborted';
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(warKey).catch(() => null);
            if (isDeepStrictEqual(recovered, desiredWar)) return 'aborted';
            throw error;
        }
        const recovered = await store.get<Record<string, unknown>>(warKey);
        if (isDeepStrictEqual(recovered, desiredWar)) return 'aborted';
        return 'blocked';
    }
    return 'blocked';
}

async function activateFunding(
    store: MercenaryHireStore,
    warKey: string,
    fundingRow: Record<string, unknown>,
    marker: WarMercenaryFundingMarker,
    sourceRow: Record<string, unknown>,
    sourceReceipt: WarMercenaryDebitReceipt,
    now: number,
): Promise<WarMercenaryHireResult> {
    const current = await store.get<Record<string, unknown>>(warKey);
    if (current && recordMapIsMalformed(current, WAR_MERCENARY_RECEIPTS_FIELD)) {
        return { status: 'blocked', reason: 'war-receipts-invalid', row: current };
    }
    const existing = current ? warMercenaryAppliedReceiptFromRow(current, marker.hireId) : null;
    if (current && existing && sameIdentity(existing, marker)) {
        return { status: 'active', row: current, receipt: existing, sourceRow, replayed: true };
    }
    if (current && warHasReceiptEntry(current, marker.hireId)) {
        return { status: 'blocked', reason: 'war-receipt-invalid', row: current };
    }
    if (!current || !isDeepStrictEqual(current, fundingRow)
        || !markerMatches(warMercenaryFundingMarkerFromRow(current) ?? marker, marker.fingerprint)) {
        return { status: 'conflict', row: current };
    }
    const hp = current.hp;
    if (!hp || typeof hp !== 'object' || Array.isArray(hp)) {
        return { status: 'blocked', reason: 'war-hp-invalid', row: current };
    }
    const before = positiveSafeInteger((hp as Record<string, unknown>)[marker.enemy]);
    if (before === null) return { status: 'blocked', reason: 'war-hp-invalid', row: current };
    const enemyHp = Math.max(1, before - marker.warDamage);
    const dealt = before - enemyHp;
    const contributions = recordMap(current, 'contributions') as Record<string, Record<string, unknown>>;
    const prior = contributions[marker.player];
    const stablePrior = prior && String(prior.side ?? '') === marker.village
        ? prior
        : { damage: 0, raids: 0, pvpKills: 0, side: marker.village, name: marker.displayName };
    const nextContributions = {
        ...contributions,
        [marker.player]: {
            ...stablePrior,
            damage: (nonnegativeSafeInteger(stablePrior.damage) ?? 0) + dealt,
            side: marker.village,
            name: String(stablePrior.name ?? marker.displayName),
        },
    };
    const receipt: WarMercenaryAppliedReceipt = {
        version: 1,
        state: 'applied',
        ...cleanIdentity(marker)!,
        fingerprint: marker.fingerprint,
        ownerId: marker.ownerId,
        balanceAfter: sourceReceipt.balanceAfter,
        dealt,
        enemyHp,
        appliedAt: now,
    };
    const desired: Record<string, unknown> = jsonClone({
        ...current,
        hp: { ...(hp as Record<string, unknown>), [marker.enemy]: enemyHp },
        contributions: nextContributions,
        [WAR_MERCENARY_RECEIPTS_FIELD]: {
            ...recordMap(current, WAR_MERCENARY_RECEIPTS_FIELD),
            [marker.hireId]: receipt,
        },
        updatedAt: Math.max(nonnegativeSafeInteger(current.updatedAt) ?? 0, now),
    });
    delete desired[WAR_MERCENARY_FUNDING_FIELD];
    try {
        if (await store.compareSet(warKey, fundingRow, desired)) {
            return { status: 'active', row: desired, receipt, sourceRow, replayed: false };
        }
    } catch (error) {
        const recovered = await store.get<Record<string, unknown>>(warKey).catch(() => null);
        const recoveredReceipt = recovered ? warMercenaryAppliedReceiptFromRow(recovered, marker.hireId) : null;
        if (recovered && recoveredReceipt && sameIdentity(recoveredReceipt, marker)) {
            return { status: 'active', row: recovered, receipt: recoveredReceipt, sourceRow, replayed: false };
        }
        throw error;
    }
    const raced = await store.get<Record<string, unknown>>(warKey);
    const racedReceipt = raced ? warMercenaryAppliedReceiptFromRow(raced, marker.hireId) : null;
    if (raced && racedReceipt && sameIdentity(racedReceipt, marker)) {
        return { status: 'active', row: raced, receipt: racedReceipt, sourceRow, replayed: true };
    }
    return { status: 'conflict', row: raced };
}

export async function helpWarMercenaryHire(
    store: MercenaryHireStore,
    warKey: string,
    fundingRow: Record<string, unknown>,
    now: number,
): Promise<WarMercenaryHireResult> {
    const marker = warMercenaryFundingMarkerFromRow(fundingRow);
    if (!marker || positiveSafeInteger(now) === null) {
        return { status: 'blocked', reason: 'funding-marker-invalid', row: fundingRow };
    }
    if (now >= marker.warEndsAt) {
        const aborted = await abortFunding(store, warKey, fundingRow, marker, now);
        if (aborted === 'aborted') {
            return { status: 'expired', row: (await store.get<Record<string, unknown>>(warKey)) ?? fundingRow };
        }
        if (aborted === 'funded') {
            const source = await store.get<Record<string, unknown>>(marker.sourceKey);
            const receipt = source ? sourceEntryFromRow(source, marker) : null;
            if (source && receipt?.state === 'committed') {
                return activateFunding(store, warKey, fundingRow, marker, source, receipt, now);
            }
        }
        return { status: 'blocked', reason: 'expired-funding-abort-incomplete', row: await store.get<Record<string, unknown>>(warKey) };
    }
    const debit = await debitSource(store, warKey, fundingRow, marker, now);
    if (debit.status === 'insufficient') {
        const aborted = await abortFunding(store, warKey, fundingRow, marker, now);
        if (aborted === 'aborted') return { status: 'insufficient', have: debit.have, cost: marker.costSeals };
        if (aborted === 'funded') {
            const source = await store.get<Record<string, unknown>>(marker.sourceKey);
            const receipt = source ? sourceEntryFromRow(source, marker) : null;
            if (source && receipt?.state === 'committed') {
                return activateFunding(store, warKey, fundingRow, marker, source, receipt, now);
            }
        }
        return { status: 'blocked', reason: 'funding-abort-incomplete', row: await store.get<Record<string, unknown>>(warKey) };
    }
    if (debit.status === 'blocked') {
        if (debit.reason === 'balance-invalid' || debit.reason === 'account-village-changed') {
            const aborted = await abortFunding(store, warKey, fundingRow, marker, now);
            if (aborted === 'funded') {
                const source = await store.get<Record<string, unknown>>(marker.sourceKey);
                const receipt = source ? sourceEntryFromRow(source, marker) : null;
                if (source && receipt?.state === 'committed') {
                    return activateFunding(store, warKey, fundingRow, marker, source, receipt, now);
                }
            }
            if (aborted === 'aborted') {
                return { status: 'blocked', reason: debit.reason, row: await store.get<Record<string, unknown>>(warKey) };
            }
        }
        return { status: 'blocked', reason: debit.reason, row: await store.get<Record<string, unknown>>(warKey) };
    }
    return activateFunding(store, warKey, fundingRow, marker, debit.row, debit.receipt, now);
}

export async function settleWarMercenaryHire(
    store: MercenaryHireStore,
    plan: WarMercenaryHirePlan,
): Promise<WarMercenaryHireResult> {
    const reserved = await reserveWarMercenaryFunding(store, plan);
    if (reserved.status === 'active') {
        const sourceRow = await store.get<Record<string, unknown>>(plan.sourceKey);
        if (!sourceRow) return { status: 'blocked', reason: 'applied-source-missing', row: reserved.row };
        return { status: 'active', row: reserved.row, receipt: reserved.receipt, sourceRow, replayed: true };
    }
    if (reserved.status === 'busy' || reserved.status === 'conflict' || reserved.status === 'blocked') return reserved;
    return helpWarMercenaryHire(store, plan.warKey, reserved.row, plan.now);
}
