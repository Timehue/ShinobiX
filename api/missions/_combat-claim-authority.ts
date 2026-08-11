import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';

export const COMBAT_MISSION_CLAIM_TOKEN_TTL_SECONDS = 6 * 60 * 60;
export const COMBAT_MISSION_CLAIM_TOKEN_TTL_MS = COMBAT_MISSION_CLAIM_TOKEN_TTL_SECONDS * 1000;
const MAX_COMBAT_MISSION_CLAIM_SETTLEMENTS = 64;
// DAILY_MISSION_LIMIT is 20 and a six-hour token horizon can cross at most one
// UTC reset, so no legitimate save can hold more than 40 live combat markers.
const MAX_TOKEN_HORIZON_COMBAT_MISSION_CLAIMS = 40;

export interface CombatMissionClaimToken {
    version: 1;
    authority: 'server-combat';
    playerName: string;
    runId: string;
    missionId: string;
    enemyProfileId: string;
    rewardFingerprint: string;
    wonAt: number;
}

export interface CombatMissionClaimResult {
    reward: {
        xpBoosted: number;
        statPoints: number;
        ryo: number;
        stamina: number;
        territoryScrolls: number;
        currency: Record<string, number>;
        items: string[];
    };
    combat: { aiProfileId: string; missionKey: string };
    completion: 'daily';
}

export interface CombatMissionClaimSettlement {
    version: 1;
    runId: string;
    missionId: string;
    rewardFingerprint: string;
    settledAt: number;
    result: CombatMissionClaimResult;
    effects?: CombatMissionClaimEffects;
}

/**
 * Durable payout reservation. Its authority string is intentionally unknown to
 * the previous claim worker, which accepted every `server-combat` row but could
 * not see the new save-atomic payout receipt. New workers CAS an active token to
 * this state before writing any reward, closing the rolling-deploy double-pay
 * window while retaining enough pinned data to help a pre-commit crash forward.
 */
export interface CombatMissionClaimPaymentReservation {
    version: 1;
    authority: 'server-combat-paying';
    playerName: string;
    runId: string;
    missionId: string;
    enemyProfileId: string;
    rewardFingerprint: string;
    wonAt: number;
    reservedAt: number;
    settlement: CombatMissionClaimSettlement;
}

export interface CombatMissionClaimEffects {
    version: 1;
    newbieAppliedAt?: number;
    newbieRyoAwarded?: number;
    legacyAppliedAt?: number;
    eraAppliedAt?: number;
    completedAt?: number;
}

export interface SpentCombatMissionClaimToken {
    version: 1;
    authority: 'server-combat-spent';
    playerName: string;
    runId: string;
    missionId: string;
    rewardFingerprint: string;
    settledAt: number;
}

type ClaimAuthorityStore = Pick<KvLike, 'get' | 'set' | 'compareSet'>;

function cleanBoundedString(value: unknown, max: number): string {
    return typeof value === 'string' && value.length > 0 && value.length <= max ? value : '';
}

function cleanCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function cleanCurrency(value: unknown): Record<string, number> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const currency: Record<string, number> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 16) return null;
    for (const [key, raw] of entries) {
        const id = cleanBoundedString(key, 48);
        const amount = cleanCount(raw);
        if (!id || amount === null) return null;
        currency[id] = amount;
    }
    return currency;
}

function cleanResult(value: unknown): CombatMissionClaimResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw.completion !== 'daily') return null;
    const combatRaw = raw.combat;
    const rewardRaw = raw.reward;
    if (!combatRaw || typeof combatRaw !== 'object' || Array.isArray(combatRaw)
        || !rewardRaw || typeof rewardRaw !== 'object' || Array.isArray(rewardRaw)) return null;
    const combatRecord = combatRaw as Record<string, unknown>;
    const rewardRecord = rewardRaw as Record<string, unknown>;
    const combat = {
        aiProfileId: cleanBoundedString(combatRecord.aiProfileId, 80),
        missionKey: cleanBoundedString(combatRecord.missionKey, 80),
    };
    const xpBoosted = cleanCount(rewardRecord.xpBoosted);
    const statPoints = cleanCount(rewardRecord.statPoints);
    const ryo = cleanCount(rewardRecord.ryo);
    const stamina = cleanCount(rewardRecord.stamina);
    const territoryScrolls = cleanCount(rewardRecord.territoryScrolls);
    const currency = cleanCurrency(rewardRecord.currency);
    const items = Array.isArray(rewardRecord.items)
        ? rewardRecord.items.map((item) => cleanBoundedString(item, 80))
        : [];
    if (!combat.aiProfileId || !combat.missionKey
        || xpBoosted === null || statPoints === null || ryo === null
        || stamina === null || territoryScrolls === null || !currency
        || items.length > 64 || items.some((item) => !item)) return null;
    return {
        reward: { xpBoosted, statPoints, ryo, stamina, territoryScrolls, currency, items },
        combat,
        completion: 'daily',
    };
}

export function combatMissionClaimTokenKey(playerName: string, missionId: string): string {
    return `missions:combat-claim:${playerName}:${missionId}`;
}

export function createCombatMissionClaimToken(params: {
    playerName: string;
    runId: string;
    missionId: string;
    enemyProfileId: string;
    rewardFingerprint: string;
    wonAt: number;
}): CombatMissionClaimToken {
    return { version: 1, authority: 'server-combat', ...params };
}

/**
 * Parse both the v1 seal and the immediately preceding rolling-deploy shape.
 * Legacy tokens are still bound to their server-minted run and mission; they
 * simply have no catalog fingerprint to compare.
 */
export function parseCombatMissionClaimToken(value: unknown): CombatMissionClaimToken | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw.authority !== 'server-combat') return null;
    const version = raw.version === 1 ? 1 : (raw.version === undefined ? 0 : -1);
    if (version < 0) return null;
    const playerName = version === 1 ? cleanBoundedString(raw.playerName, 32) : '';
    const runId = cleanBoundedString(raw.runId, 96);
    const missionId = cleanBoundedString(raw.missionId, 80);
    const enemyProfileId = version === 1 ? cleanBoundedString(raw.enemyProfileId, 80) : '';
    const rewardFingerprint = version === 1 ? cleanBoundedString(raw.rewardFingerprint, 64) : '';
    const wonAt = raw.wonAt;
    if ((version === 1 && (!playerName || !enemyProfileId || !/^[a-f0-9]{64}$/i.test(rewardFingerprint)))
        || !runId || !missionId || typeof wonAt !== 'number' || !Number.isFinite(wonAt) || wonAt <= 0) return null;
    return {
        version: 1,
        authority: 'server-combat',
        playerName,
        runId,
        missionId,
        enemyProfileId,
        rewardFingerprint,
        wonAt,
    };
}

/**
 * Parse the tombstone left after a payout is fully durable. A tombstone is
 * distinct from an absent token: it binds a lost-response replay to one exact
 * run, while an unknown non-null row must fail closed as corrupt authority.
 */
export function parseSpentCombatMissionClaimToken(value: unknown): SpentCombatMissionClaimToken | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1 || raw.authority !== 'server-combat-spent') return null;
    const playerName = raw.playerName === '' ? '' : cleanBoundedString(raw.playerName, 32);
    const runId = cleanBoundedString(raw.runId, 96);
    const missionId = cleanBoundedString(raw.missionId, 80);
    const rewardFingerprint = cleanBoundedString(raw.rewardFingerprint, 64);
    const settledAt = raw.settledAt;
    if ((raw.playerName !== '' && !playerName) || !runId || !missionId
        || !/^[a-f0-9]{64}$/i.test(rewardFingerprint)
        || typeof settledAt !== 'number' || !Number.isFinite(settledAt) || settledAt <= 0) return null;
    return {
        version: 1,
        authority: 'server-combat-spent',
        playerName,
        runId,
        missionId,
        rewardFingerprint,
        settledAt,
    };
}

export function combatMissionClaimTokenMatches(params: {
    token: CombatMissionClaimToken;
    playerName: string;
    missionId: string;
    enemyProfileId: string;
    rewardFingerprint: string;
}): boolean {
    const { token } = params;
    return token.missionId === params.missionId
        && (!token.playerName || token.playerName === params.playerName)
        && (!token.enemyProfileId || token.enemyProfileId === params.enemyProfileId)
        && (!token.rewardFingerprint || token.rewardFingerprint === params.rewardFingerprint);
}

/**
 * Retire only the exact token observed by this claimant. A successor token that
 * appeared after a lock lease expired is never deleted or overwritten.
 */
export async function retireCombatMissionClaimToken(params: {
    store: ClaimAuthorityStore;
    key: string;
    expected: unknown;
    token: CombatMissionClaimToken | CombatMissionClaimPaymentReservation;
    settlement: CombatMissionClaimSettlement;
}): Promise<void> {
    const spent: SpentCombatMissionClaimToken = {
        version: 1,
        authority: 'server-combat-spent',
        playerName: params.token.playerName,
        runId: params.token.runId,
        missionId: params.token.missionId,
        rewardFingerprint: params.settlement.rewardFingerprint,
        settledAt: params.settlement.settledAt,
    };
    let writeError: unknown;
    let swapped = false;
    try {
        swapped = await params.store.compareSet(params.key, params.expected, spent, {
            ex: COMBAT_MISSION_CLAIM_TOKEN_TTL_SECONDS,
        });
    } catch (error) {
        writeError = error;
    }
    if (swapped) return;
    let readback: unknown;
    let readError: unknown;
    try {
        readback = await params.store.get(params.key);
    } catch (error) {
        readError = error;
    }
    if (readError) {
        if (writeError) throw writeError;
        throw readError;
    }
    if (isDeepStrictEqual(readback, spent)) return;
    // A different current row is a successor's authority, not our cleanup job.
    if (!isDeepStrictEqual(readback, params.expected)) return;
    if (writeError) throw writeError;
    throw new Error('combat-mission-claim-token-retirement-unconfirmed');
}

export function parseCombatMissionClaimSettlement(value: unknown): CombatMissionClaimSettlement | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const runId = cleanBoundedString(raw.runId, 96);
    const missionId = cleanBoundedString(raw.missionId, 80);
    const rewardFingerprint = cleanBoundedString(raw.rewardFingerprint, 64);
    const settledAt = raw.settledAt;
    const result = cleanResult(raw.result);
    let effects: CombatMissionClaimEffects | undefined;
    if (raw.effects !== undefined) {
        if (!raw.effects || typeof raw.effects !== 'object' || Array.isArray(raw.effects)) return null;
        const effectRaw = raw.effects as Record<string, unknown>;
        if (effectRaw.version !== 1) return null;
        const cleanOptionalTime = (field: string): number | undefined | null => {
            const candidate = effectRaw[field];
            if (candidate === undefined) return undefined;
            return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
                ? candidate
                : null;
        };
        const newbieAppliedAt = cleanOptionalTime('newbieAppliedAt');
        const legacyAppliedAt = cleanOptionalTime('legacyAppliedAt');
        const eraAppliedAt = cleanOptionalTime('eraAppliedAt');
        const completedAt = cleanOptionalTime('completedAt');
        const newbieRyoAwarded = effectRaw.newbieRyoAwarded === undefined
            ? undefined
            : cleanCount(effectRaw.newbieRyoAwarded);
        if (newbieAppliedAt === null || legacyAppliedAt === null || eraAppliedAt === null
            || completedAt === null || newbieRyoAwarded === null) return null;
        effects = {
            version: 1,
            ...(newbieAppliedAt ? { newbieAppliedAt } : {}),
            ...(newbieRyoAwarded !== undefined ? { newbieRyoAwarded } : {}),
            ...(legacyAppliedAt ? { legacyAppliedAt } : {}),
            ...(eraAppliedAt ? { eraAppliedAt } : {}),
            ...(completedAt ? { completedAt } : {}),
        };
    }
    if (raw.version !== 1 || !runId || !missionId
        || !/^[a-f0-9]{64}$/i.test(rewardFingerprint)
        || typeof settledAt !== 'number' || !Number.isFinite(settledAt) || settledAt <= 0 || !result
        || result.combat.missionKey !== missionId) return null;
    return { version: 1, runId, missionId, rewardFingerprint, settledAt, result, ...(effects ? { effects } : {}) };
}

export function createCombatMissionClaimPaymentReservation(params: {
    token: CombatMissionClaimToken;
    playerName: string;
    enemyProfileId: string;
    rewardFingerprint: string;
    settlement: CombatMissionClaimSettlement;
    reservedAt?: number;
}): CombatMissionClaimPaymentReservation {
    return {
        version: 1,
        authority: 'server-combat-paying',
        playerName: params.playerName,
        runId: params.token.runId,
        missionId: params.token.missionId,
        enemyProfileId: params.enemyProfileId,
        rewardFingerprint: params.rewardFingerprint,
        wonAt: params.token.wonAt,
        reservedAt: params.reservedAt ?? Date.now(),
        settlement: params.settlement,
    };
}

export function parseCombatMissionClaimPaymentReservation(
    value: unknown,
): CombatMissionClaimPaymentReservation | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1 || raw.authority !== 'server-combat-paying') return null;
    const playerName = cleanBoundedString(raw.playerName, 32);
    const runId = cleanBoundedString(raw.runId, 96);
    const missionId = cleanBoundedString(raw.missionId, 80);
    const enemyProfileId = cleanBoundedString(raw.enemyProfileId, 80);
    const rewardFingerprint = cleanBoundedString(raw.rewardFingerprint, 64);
    const wonAt = raw.wonAt;
    const reservedAt = raw.reservedAt;
    const settlement = parseCombatMissionClaimSettlement(raw.settlement);
    if (!playerName || !runId || !missionId || !enemyProfileId
        || !/^[a-f0-9]{64}$/i.test(rewardFingerprint)
        || typeof wonAt !== 'number' || !Number.isFinite(wonAt) || wonAt <= 0
        || typeof reservedAt !== 'number' || !Number.isFinite(reservedAt) || reservedAt <= 0
        || !settlement || settlement.runId !== runId || settlement.missionId !== missionId
        || settlement.rewardFingerprint !== rewardFingerprint
        || settlement.result.combat.aiProfileId !== enemyProfileId
        || !settlement.effects
        || settlement.effects.newbieAppliedAt !== undefined
        || settlement.effects.legacyAppliedAt !== undefined
        || settlement.effects.eraAppliedAt !== undefined
        || settlement.effects.completedAt !== undefined) return null;
    return {
        version: 1,
        authority: 'server-combat-paying',
        playerName,
        runId,
        missionId,
        enemyProfileId,
        rewardFingerprint,
        wonAt,
        reservedAt,
        settlement,
    };
}

export function combatMissionClaimPaymentMatches(params: {
    reservation: CombatMissionClaimPaymentReservation;
    playerName: string;
    missionId: string;
}): boolean {
    return params.reservation.playerName === params.playerName
        && params.reservation.missionId === params.missionId;
}

export async function reserveCombatMissionClaimPayment(params: {
    store: ClaimAuthorityStore;
    key: string;
    expected: unknown;
    reservation: CombatMissionClaimPaymentReservation;
}): Promise<void> {
    // Unresolved payment authority deliberately has no TTL. Once the save receipt
    // and post-effects are complete it is replaced by the ordinary bounded spent
    // tombstone; expiring it before a retry could strand a legitimately won reward.
    await compareSetExactKvRow(
        params.store,
        params.key,
        params.expected,
        params.reservation,
    );
}

export function replaceCombatMissionClaimSettlement(
    character: Record<string, unknown>,
    settlement: CombatMissionClaimSettlement,
): Record<string, unknown> {
    const raw = Array.isArray(character.combatMissionClaimSettlements)
        ? character.combatMissionClaimSettlements
        : [];
    let replaced = false;
    const next = raw.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
            || (entry as Record<string, unknown>).runId !== settlement.runId) return entry;
        replaced = true;
        return settlement;
    });
    if (!replaced) throw new Error('combat-mission-claim-settlement-missing');
    return { ...character, combatMissionClaimSettlements: next };
}

export function combatMissionClaimSettlements(character: Record<string, unknown>): CombatMissionClaimSettlement[] {
    return Array.isArray(character.combatMissionClaimSettlements)
        ? character.combatMissionClaimSettlements
            .map(parseCombatMissionClaimSettlement)
            .filter((entry): entry is CombatMissionClaimSettlement => !!entry)
        : [];
}

export function inspectCombatMissionClaimSettlement(
    character: Record<string, unknown>,
    runId: string,
    missionId: string,
    rewardFingerprint: string,
): { status: 'missing' } | { status: 'replay'; receipt: CombatMissionClaimSettlement } | { status: 'conflict' } {
    const raw = Array.isArray(character.combatMissionClaimSettlements)
        ? character.combatMissionClaimSettlements
        : [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
            || (entry as Record<string, unknown>).runId !== runId) continue;
        const receipt = parseCombatMissionClaimSettlement(entry);
        if (!receipt || receipt.missionId !== missionId || receipt.rewardFingerprint !== rewardFingerprint) {
            return { status: 'conflict' };
        }
        return { status: 'replay', receipt };
    }
    return { status: 'missing' };
}

export function latestCombatMissionClaimSettlement(
    character: Record<string, unknown>,
    missionId: string,
): CombatMissionClaimSettlement | null {
    return combatMissionClaimSettlements(character)
        .filter((entry) => entry.missionId === missionId)
        .sort((a, b) => b.settledAt - a.settledAt)[0] ?? null;
}

/** Keep every marker that can still overlap a live token plus bounded history. */
export function appendCombatMissionClaimSettlement(
    character: Record<string, unknown>,
    settlement: CombatMissionClaimSettlement,
    now = Date.now(),
): Record<string, unknown> {
    const existing = combatMissionClaimSettlements(character)
        .filter((entry) => entry.runId !== settlement.runId);
    const tokenHorizon = now - COMBAT_MISSION_CLAIM_TOKEN_TTL_MS;
    const protectedEntries = existing
        .filter((entry) => entry.settledAt >= tokenHorizon
            || !entry.effects?.completedAt)
        .sort((a, b) => b.settledAt - a.settledAt);
    if (protectedEntries.length + 1 > MAX_TOKEN_HORIZON_COMBAT_MISSION_CLAIMS) {
        throw new Error('combat-mission-claim-token-horizon-overflow');
    }
    const expiredCapacity = MAX_COMBAT_MISSION_CLAIM_SETTLEMENTS - protectedEntries.length - 1;
    const expiredHistory = existing
        .filter((entry) => entry.settledAt < tokenHorizon
            && !!entry.effects?.completedAt)
        .sort((a, b) => b.settledAt - a.settledAt)
        .slice(0, expiredCapacity);
    const next = [settlement, ...protectedEntries, ...expiredHistory];
    return { ...character, combatMissionClaimSettlements: next };
}

/** A KV write is accepted only after exact durable readback, including lost ACKs. */
export async function setExactKvRow(
    store: ClaimAuthorityStore,
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean },
): Promise<void> {
    let writeError: unknown;
    try {
        await store.set(key, value, options);
    } catch (error) {
        writeError = error;
    }
    const readback = await store.get(key).catch(() => null);
    if (isDeepStrictEqual(readback, value)) return;
    if (writeError) throw writeError;
    throw new Error(`kv-write-unconfirmed:${key}`);
}

/** CAS variant that fences a writer whose short lease expired mid-request. */
export async function compareSetExactKvRow(
    store: ClaimAuthorityStore,
    key: string,
    expected: unknown | null,
    value: unknown,
    options?: { ex?: number },
): Promise<void> {
    let writeError: unknown;
    try {
        await store.compareSet(key, expected, value, options);
    } catch (error) {
        writeError = error;
    }
    const readback = await store.get(key).catch(() => null);
    if (isDeepStrictEqual(readback, value)) return;
    if (writeError) throw writeError;
    throw new Error(`kv-compare-set-unconfirmed:${key}`);
}

/** Publish token + pending-save rows and prove both before metadata can settle. */
export async function publishCombatMissionClaimRows(params: {
    store: ClaimAuthorityStore;
    tokenKey: string;
    expectedToken: unknown | null;
    token: CombatMissionClaimToken;
    saveKey: string;
    expectedSave: Record<string, unknown>;
    saveRecord: Record<string, unknown>;
}): Promise<void> {
    await compareSetExactKvRow(params.store, params.tokenKey, params.expectedToken, params.token, {
        ex: COMBAT_MISSION_CLAIM_TOKEN_TTL_SECONDS,
    });
    await compareSetExactKvRow(params.store, params.saveKey, params.expectedSave, params.saveRecord);
    const [tokenReadback, saveReadback] = await Promise.all([
        params.store.get(params.tokenKey).catch(() => null),
        params.store.get(params.saveKey).catch(() => null),
    ]);
    if (!isDeepStrictEqual(tokenReadback, params.token)
        || !isDeepStrictEqual(saveReadback, params.saveRecord)) {
        throw new Error('combat-mission-claim-publication-unconfirmed');
    }
}

/** Resolve an ambiguous save write only from its atomic run-bound receipt. */
export async function confirmCombatMissionClaimSave(params: {
    read: () => Promise<Record<string, unknown> | null>;
    write: () => Promise<void>;
    settlement: CombatMissionClaimSettlement;
}): Promise<Record<string, unknown>> {
    let writeError: unknown;
    try {
        await params.write();
    } catch (error) {
        writeError = error;
    }
    const stored = await params.read().catch(() => null);
    const character = stored?.character;
    let confirmationStatus = 'missing-character';
    if (character && typeof character === 'object' && !Array.isArray(character)) {
        const inspected = inspectCombatMissionClaimSettlement(
            character as Record<string, unknown>,
            params.settlement.runId,
            params.settlement.missionId,
            params.settlement.rewardFingerprint,
        );
        confirmationStatus = inspected.status;
        if (inspected.status === 'replay' && isDeepStrictEqual(inspected.receipt, params.settlement)) return stored!;
    }
    if (writeError) throw writeError;
    throw new Error(`combat-mission-claim-save-unconfirmed:${confirmationStatus}`);
}
