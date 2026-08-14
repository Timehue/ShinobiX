import { SAVE_FAILURE_BANNER_THRESHOLD, isCurrentSavePayloadRevision, type SaveFlightCoordinator } from "./save-flight";
import { saveConflictAccountKey, stringifySaveConflictPayload, type SaveConflictDraft } from "./save-conflict";
import { acceptVersionedSnapshot } from "./versioned-snapshot";
import { adoptSaveVersion } from "./save-version";

export type SaveSnapshot<TPayload> = {
    name: string;
    payload: TPayload;
    revision: number;
};

export type RequiredSave<TPayload> = {
    name: string;
    payload: TPayload;
    revision: number;
    echoVersion: boolean;
    isStillCurrent: () => boolean;
    onCommitted: () => void;
};

export class SaveConflictError extends Error {
    constructor(message = "The requested save conflicted with newer server progress. Your local draft is protected.") {
        super(message);
        this.name = "SaveConflictError";
    }
}

export const SAVE_PERSISTENCE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Exact JSON-safe POST body that has not yet received a durable acknowledgement.
 * `serializedBody` is the immutable source of truth; `body` is a defensive copy
 * supplied for synchronous unload-draft protection.
 */
export type UnresolvedSavePost = Readonly<{
    accountName: string;
    accountKey: string;
    sessionEpoch: number;
    revision: number;
    body: Readonly<Record<string, unknown>>;
    serializedBody: string;
}>;

type MutableRef<T> = { current: T };

function validAcknowledgementVersion(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

export function createSavePersistence<TPayload extends Record<string, unknown>>(params: {
    flight: SaveFlightCoordinator;
    latestVersion: MutableRef<number>;
    latestPayloadRevision: MutableRef<number>;
    dirty: MutableRef<boolean>;
    failureCount: MutableRef<number>;
    isCurrentSession: (accountKey: string, sessionEpoch: number) => boolean;
    currentSessionEpoch: () => number;
    captureConflict: (accountName: string, payload: unknown) => SaveConflictDraft;
    currentSnapshot: () => SaveSnapshot<TPayload> | null;
    installSnapshot: (snapshot: SaveSnapshot<TPayload>) => void;
    onConflictSnapshot: (snapshot: TPayload & { _saveVersion?: number }, submittedRevision: number) => boolean;
    writePreview: (accountName: string, payload: unknown) => void;
    setBlocked: (blocked: boolean) => void;
    requestTimeoutMs?: number;
}) {
    const conflictFlights = new Map<string, Promise<boolean>>();
    let authorityGeneration = 0;
    let unresolvedSequence = 0;
    let unresolvedPost: (Omit<UnresolvedSavePost, "body"> & { sequence: number }) | null = null;
    const conflictKey = (accountKey: string, epoch: number) => `${epoch}:${accountKey}`;
    const requestTimeoutMs = Number.isFinite(params.requestTimeoutMs) && Number(params.requestTimeoutMs) > 0
        ? Number(params.requestTimeoutMs)
        : SAVE_PERSISTENCE_REQUEST_TIMEOUT_MS;
    const requestSignal = () => AbortSignal.timeout(requestTimeoutMs);

    const registerUnresolvedPost = (
        accountName: string,
        accountKey: string,
        sessionEpoch: number,
        revision: number,
        body: Record<string, unknown>,
    ) => {
        const serializedBody = stringifySaveConflictPayload(body);
        unresolvedSequence += 1;
        const entry = Object.freeze({
            sequence: unresolvedSequence,
            accountName,
            accountKey,
            sessionEpoch,
            revision,
            serializedBody,
        });
        unresolvedPost = entry;
        return entry;
    };

    const clearUnresolvedPost = (entry: { sequence: number }) => {
        if (unresolvedPost?.sequence === entry.sequence) unresolvedPost = null;
    };

    const getUnresolvedPost = (): UnresolvedSavePost | null => {
        const entry = unresolvedPost;
        if (!entry) return null;
        return Object.freeze({
            accountName: entry.accountName,
            accountKey: entry.accountKey,
            sessionEpoch: entry.sessionEpoch,
            revision: entry.revision,
            body: JSON.parse(entry.serializedBody) as Record<string, unknown>,
            serializedBody: entry.serializedBody,
        });
    };

    const refetchAfterConflict = async (accountName: string, submittedRevision = params.latestPayloadRevision.current): Promise<boolean> => {
        const accountKey = saveConflictAccountKey(accountName);
        const epoch = params.currentSessionEpoch();
        if (!accountKey || !params.isCurrentSession(accountKey, epoch)) return false;
        const key = conflictKey(accountKey, epoch);
        const existing = conflictFlights.get(key);
        if (existing) return existing;
        const request = (async () => {
            try {
                const response = await fetch(`/api/save/${encodeURIComponent(accountName.toLowerCase())}`, {
                    cache: "no-store",
                    signal: requestSignal(),
                });
                if (!response.ok || !params.isCurrentSession(accountKey, epoch)) return false;
                const snapshot = await response.json() as TPayload & { _saveVersion?: number };
                if (!params.isCurrentSession(accountKey, epoch)) return false;
                const localAtInstall = params.currentSnapshot();
                if (localAtInstall?.name === accountName && localAtInstall.revision > submittedRevision) {
                    params.captureConflict(localAtInstall.name, { ...localAtInstall.payload, _baseSaveVersion: params.latestVersion.current });
                }
                const decision = acceptVersionedSnapshot(params.latestVersion.current, snapshot._saveVersion);
                if (!decision.accepted) return false;
                params.latestVersion.current = decision.latestVersion;
                const accepted = params.onConflictSnapshot(snapshot, submittedRevision);
                if (accepted) params.installSnapshot({ name: accountName, payload: snapshot, revision: params.latestPayloadRevision.current });
                return accepted;
            } catch {
                return false;
            } finally {
                conflictFlights.delete(key);
            }
        })();
        conflictFlights.set(key, request);
        return request;
    };

    const waitForConflict = async (accountKey: string): Promise<void> => {
        const pending = conflictFlights.get(conflictKey(accountKey, params.currentSessionEpoch()));
        if (pending) await pending;
    };

    const persistAutosave = async (snapshot: SaveSnapshot<TPayload>) => {
        const result = await params.flight.runAutosave(async () => {
            const body = { ...snapshot.payload, _baseSaveVersion: params.latestVersion.current };
            const accountKey = saveConflictAccountKey(snapshot.name);
            const epoch = params.currentSessionEpoch();
            try {
                if (!params.isCurrentSession(accountKey, epoch)) throw new Error("The active save account changed.");
                const pending = registerUnresolvedPost(snapshot.name, accountKey, epoch, snapshot.revision, body);
                const signal = requestSignal();
                const response = await fetch(`/api/save/${encodeURIComponent(snapshot.name.toLowerCase())}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: pending.serializedBody,
                    signal,
                });
                if (!params.isCurrentSession(accountKey, epoch)) return;
                if (response.status === 409) {
                    authorityGeneration += 1;
                    try {
                        params.captureConflict(snapshot.name, body);
                        const current = params.currentSnapshot();
                        if (current?.name === snapshot.name && current.revision > snapshot.revision) {
                            params.captureConflict(current.name, { ...current.payload, _baseSaveVersion: params.latestVersion.current });
                        }
                        if (!await refetchAfterConflict(snapshot.name, snapshot.revision)) throw new Error("Conflict recovery could not load the authoritative save.");
                        clearUnresolvedPost(pending);
                    } finally { authorityGeneration += 1; }
                    return;
                }
                if (!response.ok) {
                    console.warn(`[autosave] server rejected save (status ${response.status})`);
                    params.dirty.current = true;
                    params.failureCount.current += 1;
                    if (response.status === 413 || params.failureCount.current >= SAVE_FAILURE_BANNER_THRESHOLD) params.setBlocked(true);
                    return;
                }
                const acknowledgement = await response.json().catch((error: unknown) => {
                    if (signal.aborted) throw error;
                    return null;
                }) as { _saveVersion?: number; persisted?: boolean; reason?: string } | null;
                if (!params.isCurrentSession(accountKey, epoch)) return;
                if (acknowledgement?.persisted === false) throw new Error(`Save deferred by the server (${acknowledgement.reason ?? "locked"}).`);
                if (!validAcknowledgementVersion(acknowledgement?._saveVersion)) throw new Error("Save acknowledgement did not include a valid authoritative version.");
                params.latestVersion.current = adoptSaveVersion(params.latestVersion.current, acknowledgement?._saveVersion);
                clearUnresolvedPost(pending);
                if (isCurrentSavePayloadRevision(snapshot.revision, params.latestPayloadRevision.current)) {
                    params.writePreview(snapshot.name, { ...snapshot.payload, _saveVersion: params.latestVersion.current });
                }
                if (params.failureCount.current) {
                    params.failureCount.current = 0;
                    params.setBlocked(false);
                }
            } catch {
                if (params.isCurrentSession(accountKey, epoch)) {
                    params.dirty.current = true;
                    params.failureCount.current += 1;
                    if (params.failureCount.current >= SAVE_FAILURE_BANNER_THRESHOLD) params.setBlocked(true);
                }
            }
        });
        if (result.status === "deferred") params.dirty.current = true;
        return result;
    };

    const persistRequired = async (prepare: () => RequiredSave<TPayload>) => {
        const queuedGeneration = authorityGeneration;
        return params.flight.runRequired(async () => {
        if (queuedGeneration !== authorityGeneration) throw new SaveConflictError("This queued save was retired after authority changed. Your local draft remains protected.");
        const save = prepare();
        const accountKey = saveConflictAccountKey(save.name);
        const epoch = params.currentSessionEpoch();
        if (save.echoVersion && !params.isCurrentSession(accountKey, epoch)) {
            throw new Error("The active save account changed before this write started.");
        }
        const body = save.echoVersion
            ? { ...save.payload, _baseSaveVersion: params.latestVersion.current }
            : save.payload;
        const pending = registerUnresolvedPost(save.name, accountKey, epoch, save.revision, body);
        const signal = requestSignal();
        const response = await fetch(`/api/save/${encodeURIComponent(save.name.toLowerCase())}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: pending.serializedBody,
            signal,
        });
        if (save.echoVersion && !params.isCurrentSession(accountKey, epoch)) {
            throw new Error("The active save account changed before this write completed.");
        }
        if (response.status === 409) {
            authorityGeneration += 1;
            try {
                params.captureConflict(save.name, body);
                if (!save.echoVersion) throw new Error("The target save changed before this update could be applied.");
                const current = params.currentSnapshot();
                if (current?.name === save.name && current.revision > save.revision) {
                    params.captureConflict(current.name, { ...current.payload, _baseSaveVersion: params.latestVersion.current });
                }
                if (!await refetchAfterConflict(save.name, save.revision)) {
                    throw new Error("Your local draft is protected, but the newer server save could not be loaded yet.");
                }
                clearUnresolvedPost(pending);
                throw new SaveConflictError();
            } finally { authorityGeneration += 1; }
        }
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        if (save.echoVersion && !params.isCurrentSession(accountKey, epoch)) {
            throw new Error("The active save account changed before this write completed.");
        }
        const acknowledgement = await response.json().catch((error: unknown) => {
            if (signal.aborted) throw error;
            return null;
        }) as {
            _saveVersion?: number;
            persisted?: boolean;
            reason?: string;
        } | null;
        if (save.echoVersion && !params.isCurrentSession(accountKey, epoch)) {
            throw new Error("The active save account changed before this write completed.");
        }
        if (acknowledgement?.persisted === false) {
            params.dirty.current = true;
            throw new Error(`Save deferred by the server (${acknowledgement.reason ?? "locked"})`);
        }
        if (!save.echoVersion) { clearUnresolvedPost(pending); return; }
        if (!validAcknowledgementVersion(acknowledgement?._saveVersion)) throw new Error("Save acknowledgement did not include a valid authoritative version.");
        clearUnresolvedPost(pending);
        params.latestVersion.current = adoptSaveVersion(params.latestVersion.current, acknowledgement?._saveVersion);
        if (params.failureCount.current) { params.failureCount.current = 0; params.setBlocked(false); }
        if (isCurrentSavePayloadRevision(save.revision, params.latestPayloadRevision.current) && save.isStillCurrent()) {
            params.dirty.current = false;
            save.onCommitted();
        }
        });
    };

    const runExclusive = <T>(work: () => Promise<T>) => params.flight.runRequired(async () => {
        authorityGeneration += 1;
        try { return await work(); } finally { authorityGeneration += 1; }
    });

    /** Synchronously retires captured/queued writes when authority changes elsewhere. */
    const invalidateAuthority = () => { authorityGeneration += 1; };

    return { refetchAfterConflict, waitForConflict, persistAutosave, persistRequired, runExclusive, getUnresolvedPost, invalidateAuthority };
}
