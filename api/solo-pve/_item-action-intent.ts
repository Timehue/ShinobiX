import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { kv } from '../_storage.js';
import {
    isSoloPveSession,
    type SoloPveCombatEvent,
    type SoloPvePendingItemAction,
    type SoloPveSession,
} from './_session.js';

const ITEM_INTENT_TTL_SECONDS = 2 * 60 * 60;

export type SoloPveItemActionIntent = {
    version: 1;
    fingerprint: string;
    sessionId: string;
    ownerSlug: string;
    moveToken: string;
    expectedVersion: number;
    pending: SoloPvePendingItemAction;
    baseSession: SoloPveSession;
    reservedSession: SoloPveSession;
    resolvedSession: SoloPveSession;
    event: SoloPveCombatEvent;
    actionAt: number;
};

type ActiveItemIntentPointer = {
    version: 1;
    moveToken: string;
    fingerprint: string;
};

type IntentStore = Pick<KvLike, 'get' | 'compareSet' | 'delIfEqual'>;

export function soloPveItemIntentKey(sessionId: string, moveToken: string): string {
    return `solo-pve:item-intent:${sessionId}:${moveToken}`;
}

export function soloPveActiveItemIntentKey(sessionId: string): string {
    return `solo-pve:item-intent-active:${sessionId}`;
}

function intentFingerprint(params: {
    sessionId: string;
    ownerSlug: string;
    moveToken: string;
    expectedVersion: number;
    pending: SoloPvePendingItemAction;
    baseSession: SoloPveSession;
    reservedSession: SoloPveSession;
    resolvedSession: SoloPveSession;
    event: SoloPveCombatEvent;
    actionAt: number;
}): string {
    return createHash('sha256').update(JSON.stringify({
        version: 1,
        sessionId: params.sessionId,
        ownerSlug: params.ownerSlug.toLowerCase(),
        moveToken: params.moveToken,
        expectedVersion: params.expectedVersion,
        pending: params.pending,
        baseCreatedAt: params.baseSession.createdAt,
        baseVersion: params.baseSession.version,
        baseEventSeq: params.baseSession.eventSeq,
        baseRecentMoveTokens: params.baseSession.recentMoveTokens,
        reservedSession: params.reservedSession,
        resolvedSession: params.resolvedSession,
        event: params.event,
        actionAt: params.actionAt,
    })).digest('hex');
}

export function createSoloPveItemActionIntent(params: {
    baseSession: SoloPveSession;
    reservedSession: SoloPveSession;
    resolvedSession: SoloPveSession;
    event: SoloPveCombatEvent;
    actionAt: number;
    pending: SoloPvePendingItemAction;
}): SoloPveItemActionIntent {
    const { baseSession, reservedSession, resolvedSession, event, actionAt, pending } = params;
    const fingerprint = intentFingerprint({
        sessionId: baseSession.sessionId,
        ownerSlug: baseSession.ownerSlug,
        moveToken: pending.moveToken,
        expectedVersion: pending.expectedVersion,
        pending,
        baseSession,
        reservedSession,
        resolvedSession,
        event,
        actionAt,
    });
    const intent: SoloPveItemActionIntent = {
        version: 1,
        fingerprint,
        sessionId: baseSession.sessionId,
        ownerSlug: baseSession.ownerSlug.toLowerCase(),
        moveToken: pending.moveToken,
        expectedVersion: pending.expectedVersion,
        pending: structuredClone(pending),
        baseSession: structuredClone(baseSession),
        reservedSession: structuredClone(reservedSession),
        resolvedSession: structuredClone(resolvedSession),
        event: structuredClone(event),
        actionAt,
    };
    return JSON.parse(JSON.stringify(intent)) as SoloPveItemActionIntent;
}

function parseIntent(raw: unknown): SoloPveItemActionIntent | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<SoloPveItemActionIntent>;
    if (value.version !== 1
        || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
        || typeof value.sessionId !== 'string' || !value.sessionId
        || typeof value.ownerSlug !== 'string' || value.ownerSlug !== value.ownerSlug.toLowerCase()
        || typeof value.moveToken !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value.moveToken)
        || !Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1
        || !value.pending
        || !isSoloPveSession(value.baseSession)
        || !isSoloPveSession(value.reservedSession)
        || !isSoloPveSession(value.resolvedSession)
        || !value.event || typeof value.event !== 'object'
        || !Number.isFinite(Number(value.actionAt)) || Number(value.actionAt) <= 0) return null;
    const intent = value as SoloPveItemActionIntent;
    if (intent.sessionId !== intent.baseSession.sessionId
        || intent.sessionId !== intent.reservedSession.sessionId
        || intent.sessionId !== intent.resolvedSession.sessionId
        || intent.ownerSlug !== intent.baseSession.ownerSlug.toLowerCase()
        || intent.ownerSlug !== intent.reservedSession.ownerSlug.toLowerCase()
        || intent.ownerSlug !== intent.resolvedSession.ownerSlug.toLowerCase()
        || intent.moveToken !== intent.pending.moveToken
        || intent.expectedVersion !== intent.pending.expectedVersion
        || intent.expectedVersion !== intent.baseSession.version
        || !isDeepStrictEqual(intent.reservedSession.pendingItemAction, intent.pending)
        || intent.fingerprint !== intentFingerprint({
            sessionId: intent.sessionId,
            ownerSlug: intent.ownerSlug,
            moveToken: intent.moveToken,
            expectedVersion: intent.expectedVersion,
            pending: intent.pending,
            baseSession: intent.baseSession,
            reservedSession: intent.reservedSession,
            resolvedSession: intent.resolvedSession,
            event: intent.event,
            actionAt: intent.actionAt,
        })) return null;
    return structuredClone(intent);
}

function parsePointer(raw: unknown): ActiveItemIntentPointer | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<ActiveItemIntentPointer>;
    if (value.version !== 1
        || typeof value.moveToken !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value.moveToken)
        || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) return null;
    return { version: 1, moveToken: value.moveToken, fingerprint: value.fingerprint };
}

function parseStoredJson(raw: unknown): unknown {
    if (typeof raw !== 'string') return null;
    try { return JSON.parse(raw) as unknown; } catch { return null; }
}

async function compareSetConfirmed(
    store: IntentStore,
    key: string,
    expected: unknown | null,
    next: unknown,
): Promise<boolean> {
    try {
        if (await store.compareSet(key, expected, next, { ex: ITEM_INTENT_TTL_SECONDS }) === true) return true;
    } catch (error) {
        const readback = await store.get(key).catch(() => null);
        if (isDeepStrictEqual(readback, next)) return true;
        throw error;
    }
    return isDeepStrictEqual(await store.get(key).catch(() => null), next);
}

export async function claimSoloPveItemActionIntent(
    intent: SoloPveItemActionIntent,
    store: IntentStore = kv,
): Promise<boolean> {
    const parsed = parseIntent(intent);
    if (!parsed || !isDeepStrictEqual(parsed, intent)) throw new Error('solo-pve-item-intent-invalid');
    const intentKey = soloPveItemIntentKey(intent.sessionId, intent.moveToken);
    const activeKey = soloPveActiveItemIntentKey(intent.sessionId);
    const pointer: ActiveItemIntentPointer = {
        version: 1,
        moveToken: intent.moveToken,
        fingerprint: intent.fingerprint,
    };
    const serializedIntent = JSON.stringify(intent);
    const serializedPointer = JSON.stringify(pointer);
    const currentIntent = await store.get<string>(intentKey);
    if (currentIntent !== null && currentIntent !== serializedIntent) return false;
    if (currentIntent === null && !(await compareSetConfirmed(store, intentKey, null, serializedIntent))) return false;
    const currentPointer = await store.get(activeKey);
    if (currentPointer === serializedPointer) return true;
    if (currentPointer !== null || !(await compareSetConfirmed(store, activeKey, null, serializedPointer))) {
        await store.delIfEqual(intentKey, serializedIntent).catch(() => false);
        return false;
    }
    return true;
}

export async function readActiveSoloPveItemActionIntent(
    sessionId: string,
    store: Pick<IntentStore, 'get'> = kv,
): Promise<SoloPveItemActionIntent | null | 'invalid'> {
    const pointerRaw = await store.get(soloPveActiveItemIntentKey(sessionId));
    if (pointerRaw === null) return null;
    const pointer = parsePointer(parseStoredJson(pointerRaw));
    if (!pointer) return 'invalid';
    const intent = parseIntent(parseStoredJson(await store.get(soloPveItemIntentKey(sessionId, pointer.moveToken))));
    if (!intent || intent.fingerprint !== pointer.fingerprint) return 'invalid';
    return intent;
}

export async function releaseSoloPveItemActionIntent(
    intent: SoloPveItemActionIntent,
    store: Pick<IntentStore, 'delIfEqual' | 'get'> = kv,
): Promise<boolean> {
    const pointer: ActiveItemIntentPointer = {
        version: 1,
        moveToken: intent.moveToken,
        fingerprint: intent.fingerprint,
    };
    const activeKey = soloPveActiveItemIntentKey(intent.sessionId);
    const serializedPointer = JSON.stringify(pointer);
    const serializedIntent = JSON.stringify(intent);
    let activeReleased = false;
    try {
        activeReleased = await store.delIfEqual(activeKey, serializedPointer);
    } catch (error) {
        if (await store.get(activeKey).catch(() => serializedPointer) !== null) throw error;
        activeReleased = true;
    }
    if (!activeReleased && await store.get(activeKey).catch(() => serializedPointer) !== null) return false;
    await store.delIfEqual(soloPveItemIntentKey(intent.sessionId, intent.moveToken), serializedIntent).catch(() => false);
    return true;
}
