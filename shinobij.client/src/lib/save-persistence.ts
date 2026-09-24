import { SAVE_FAILURE_BANNER_THRESHOLD, isCurrentSavePayloadRevision, type SaveFlightCoordinator } from "./save-flight";
import {
    detectSaveConflictAreas,
    isResolvedConflictAreas,
    loadSaveOwnershipClassifier,
    saveConflictAccountKey,
    stringifySaveConflictPayload,
    type SaveConflictDraft,
} from "./save-conflict";
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
    bloodlineEquipIntent?: string;
    bloodlineWriteIntent?: string;
    isStillCurrent: () => boolean;
    onCommitted: () => void;
};

export class SaveConflictError extends Error {
    constructor(message = "The requested save conflicted with newer server progress. Your local draft is protected.") {
        super(message);
        this.name = "SaveConflictError";
    }
}

export class SaveRateLimitError extends Error {
    readonly retryAfterMs: number | null;

    constructor(retryAfterMs?: unknown) {
        super("Server returned 429");
        this.name = "SaveRateLimitError";
        this.retryAfterMs = validRetryAfterMs(retryAfterMs);
    }
}

function validRetryAfterMs(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export const SAVE_PERSISTENCE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * The server accepts one successful player save per aligned 3-second window
 * (`save-burst` in api/save/[name].ts) and answers 429 to the next. Nothing on
 * the client respected that: a travel or training flush, a mission-progress
 * flush, the 15s interval and a purchase's required save could all land inside
 * one window, so ordinary play produced 429s, the save-error banner and the
 * logout "Save temporarily paused" prompt.
 *
 * Spacing is measured from when the previous acknowledgement ARRIVED. The
 * server charged the window before it replied, so a send this long after the
 * reply can never share that window, whatever the latency or clock skew.
 */
export const SAVE_MIN_SPACING_MS = 3_100;

/**
 * Longest a write will wait for its slot. A server `retryAfterMs` can be far
 * longer (the per-minute attempt cap); rather than stall a player's action on
 * it, a required save sends anyway and surfaces the 429 as before, and an
 * autosave defers to a later tick.
 */
export const SAVE_MAX_PACING_WAIT_MS = 5_000;

export type SavePacingClock = Readonly<{
    now: () => number;
    sleep: (ms: number) => Promise<void>;
}>;

const realPacingClock: SavePacingClock = {
    now: () => Date.now(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
};

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

type CurrencyAuthorityConflict = Readonly<{ authoritativeRyo: number }>;

/**
 * A RYO_SERVER_AUTHORITY response rejects the WHOLE atomic save, but only its
 * attempted Ryo increase is invalid. Keep the authoritative balance needed to
 * repair that one field; the authoritative GET decides whether the rejected
 * body also contains recoverable device progress that still needs protection.
 */
function currencyAuthorityConflict(body: unknown): CurrencyAuthorityConflict | null {
    if (!body || typeof body !== "object" || (body as { code?: unknown }).code !== "RYO_SERVER_AUTHORITY") return null;
    const authoritativeRyo = (body as { authoritativeRyo?: unknown }).authoritativeRyo;
    return typeof authoritativeRyo === "number" && Number.isFinite(authoritativeRyo) && authoritativeRyo >= 0
        ? { authoritativeRyo }
        : null;
}

function withAuthoritativeRyo(payload: Record<string, unknown>, authoritativeRyo: number): Record<string, unknown> {
    const character = payload.character;
    if (!character || typeof character !== "object" || Array.isArray(character)) return payload;
    return { ...payload, character: { ...character, ryo: authoritativeRyo } };
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
    /** Receives the stored ryo a save acknowledgement carries (ryo is server-owned). */
    onAuthoritativeRyo?: (accountName: string, ryo: number) => void;
    onAuthoritativeFateShards?: (accountName: string, fateShards: number) => void;
    onAcknowledgedSnapshot?: (snapshot: SaveSnapshot<TPayload>) => void;
    requestTimeoutMs?: number;
    pacingClock?: SavePacingClock;
}) {
    const conflictFlights = new Map<string, Promise<boolean>>();
    const clock = params.pacingClock ?? realPacingClock;
    // Earliest time the next save POST may leave. Only touched inside the
    // flight coordinator, so there is never more than one writer.
    let nextSaveAt = 0;
    const saveSlotWaitMs = () => Math.max(0, nextSaveAt - clock.now());
    const noteSaveAccepted = () => { nextSaveAt = Math.max(nextSaveAt, clock.now() + SAVE_MIN_SPACING_MS); };
    const noteSaveThrottled = (retryAfterMs: number | null) => {
        if (retryAfterMs !== null) nextSaveAt = Math.max(nextSaveAt, clock.now() + retryAfterMs);
    };
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

    /**
     * A generic save re-asserts the stored ryo, and its acknowledgement carries
     * that balance. Adopt it only while this acknowledgement is still the newest
     * authority the client has seen: an older response must never roll back a
     * balance that a later versioned write already installed.
     */
    const adoptAcknowledgedRyo = (accountName: string, acknowledgement: { _saveVersion?: number; ryo?: unknown; fateShards?: unknown } | null) => {
        if (params.latestVersion.current !== acknowledgement?._saveVersion) return;
        const fateShards = acknowledgement?.fateShards;
        if (typeof fateShards === "number" && Number.isSafeInteger(fateShards) && fateShards >= 0) {
            params.onAuthoritativeFateShards?.(accountName, fateShards);
        }
        const ryo = acknowledgement?.ryo;
        if (typeof ryo !== "number" || !Number.isFinite(ryo) || ryo < 0) return;
        if (params.latestVersion.current !== acknowledgement?._saveVersion) return;
        params.onAuthoritativeRyo?.(accountName, ryo);
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

    const refetchAfterConflict = async (
        accountName: string,
        submittedRevision = params.latestPayloadRevision.current,
        currencyRecovery?: Readonly<{ rejectedPayload: Record<string, unknown>; authoritativeRyo: number }>,
    ): Promise<boolean> => {
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
                if (currencyRecovery) {
                    // Classification is rare and user-visible, so its ownership
                    // table remains code-split. A failed load degrades safely:
                    // unknown fields are treated as recoverable and protected.
                    await loadSaveOwnershipClassifier().catch(() => undefined);
                    if (!params.isCurrentSession(accountKey, epoch)) return false;
                    const protectIfRecoverable = (payload: Record<string, unknown>) => {
                        const repaired = withAuthoritativeRyo(payload, currencyRecovery.authoritativeRyo);
                        if (!isResolvedConflictAreas(detectSaveConflictAreas(repaired, snapshot))) {
                            params.captureConflict(accountName, repaired);
                        }
                    };
                    protectIfRecoverable(currencyRecovery.rejectedPayload);
                    if (localAtInstall?.name === accountName && localAtInstall.revision > submittedRevision) {
                        protectIfRecoverable({ ...localAtInstall.payload, _baseSaveVersion: params.latestVersion.current });
                    }
                }
                if (localAtInstall?.name === accountName && localAtInstall.revision > submittedRevision) {
                    if (!currencyRecovery) {
                        params.captureConflict(localAtInstall.name, { ...localAtInstall.payload, _baseSaveVersion: params.latestVersion.current });
                    }
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
            // Wait for the server's save window inside the flight, so a required
            // save cannot slip in between the wait and the send.
            const wait = saveSlotWaitMs();
            if (wait > SAVE_MAX_PACING_WAIT_MS) { params.dirty.current = true; return; }
            if (wait > 0) await clock.sleep(wait);
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
                    const currencyAuthority = currencyAuthorityConflict(await response.json().catch(() => null));
                    try {
                        if (!currencyAuthority) params.captureConflict(snapshot.name, body);
                        const current = params.currentSnapshot();
                        if (!currencyAuthority && current?.name === snapshot.name && current.revision > snapshot.revision) {
                            params.captureConflict(current.name, { ...current.payload, _baseSaveVersion: params.latestVersion.current });
                        }
                        if (!await refetchAfterConflict(snapshot.name, snapshot.revision, currencyAuthority
                            ? { rejectedPayload: body, authoritativeRyo: currencyAuthority.authoritativeRyo }
                            : undefined)) throw new Error("Conflict recovery could not load the authoritative save.");
                        clearUnresolvedPost(pending);
                    } finally { authorityGeneration += 1; }
                    return;
                }
                if (response.status === 429) {
                    const retryAfterMs = validRetryAfterMs((await response.json().catch(() => null) as { retryAfterMs?: unknown } | null)?.retryAfterMs);
                    // A hinted 429 (the save window from another tab, or a travel or
                    // reward write briefly holding the save lock) says when to come
                    // back, so it is not a failing save: keep the state dirty for the
                    // next tick without advancing toward the save-error banner. A 429
                    // with no hint (a per-minute gain cap) still counts.
                    if (retryAfterMs !== null) {
                        noteSaveThrottled(retryAfterMs);
                        params.dirty.current = true;
                        return;
                    }
                }
                if (!response.ok) {
                    console.warn(`[autosave] server rejected save (status ${response.status})`);
                    params.dirty.current = true;
                    params.failureCount.current += 1;
                    if (response.status === 413 || params.failureCount.current >= SAVE_FAILURE_BANNER_THRESHOLD) params.setBlocked(true);
                    return;
                }
                noteSaveAccepted();
                const acknowledgement = await response.json().catch((error: unknown) => {
                    if (signal.aborted) throw error;
                    return null;
                }) as { _saveVersion?: number; persisted?: boolean; reason?: string; ryo?: number; fateShards?: number } | null;
                if (!params.isCurrentSession(accountKey, epoch)) return;
                if (acknowledgement?.persisted === false) throw new Error(`Save deferred by the server (${acknowledgement.reason ?? "locked"}).`);
                if (!validAcknowledgementVersion(acknowledgement?._saveVersion)) throw new Error("Save acknowledgement did not include a valid authoritative version.");
                params.latestVersion.current = adoptSaveVersion(params.latestVersion.current, acknowledgement?._saveVersion);
                clearUnresolvedPost(pending);
                if (params.latestVersion.current === acknowledgement._saveVersion) params.onAcknowledgedSnapshot?.(snapshot);
                if (isCurrentSavePayloadRevision(snapshot.revision, params.latestPayloadRevision.current)) {
                    params.writePreview(snapshot.name, { ...snapshot.payload, _saveVersion: params.latestVersion.current });
                }
                adoptAcknowledgedRyo(snapshot.name, acknowledgement);
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
        const wait = saveSlotWaitMs();
        if (wait > 0 && wait <= SAVE_MAX_PACING_WAIT_MS) await clock.sleep(wait);
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
            headers: { "Content-Type": "application/json",
                ...(save.bloodlineEquipIntent ? { "x-bloodline-equip-intent": save.bloodlineEquipIntent } : {}),
                ...(save.bloodlineWriteIntent ? { "x-bloodline-write-intent": save.bloodlineWriteIntent } : {}) },
            body: pending.serializedBody,
            signal,
        });
        if (save.echoVersion && !params.isCurrentSession(accountKey, epoch)) {
            throw new Error("The active save account changed before this write completed.");
        }
        if (response.status === 409) {
            authorityGeneration += 1;
            const currencyAuthority = currencyAuthorityConflict(await response.json().catch(() => null));
            try {
                if (!currencyAuthority) params.captureConflict(save.name, body);
                if (!save.echoVersion) throw new Error("The target save changed before this update could be applied.");
                const current = params.currentSnapshot();
                if (!currencyAuthority && current?.name === save.name && current.revision > save.revision) {
                    params.captureConflict(current.name, { ...current.payload, _baseSaveVersion: params.latestVersion.current });
                }
                if (!await refetchAfterConflict(save.name, save.revision, currencyAuthority
                    ? { rejectedPayload: body, authoritativeRyo: currencyAuthority.authoritativeRyo }
                    : undefined)) {
                    throw new Error("Your local draft is protected, but the newer server save could not be loaded yet.");
                }
                clearUnresolvedPost(pending);
                throw new SaveConflictError();
            } finally { authorityGeneration += 1; }
        }
        if (response.status === 429) {
            const rejection = await response.json().catch(() => null) as { retryAfterMs?: unknown } | null;
            const error = new SaveRateLimitError(rejection?.retryAfterMs);
            noteSaveThrottled(error.retryAfterMs);
            throw error;
        }
        if (response.status === 422) {
            const rejection = await response.json().catch(() => null) as { error?: unknown } | null;
            throw new Error(typeof rejection?.error === "string" ? rejection.error : `Server returned ${response.status}`);
        }
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        noteSaveAccepted();
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
            ryo?: number;
            fateShards?: number;
            savedBloodlineIds?: string[];
            savedBloodlineRanks?: Record<string, string>;
            equippedBloodlineId?: string | null;
        } | null;
        if (save.echoVersion && !params.isCurrentSession(accountKey, epoch)) {
            throw new Error("The active save account changed before this write completed.");
        }
        if (acknowledgement?.persisted === false) {
            params.dirty.current = true;
            throw new Error(`Save deferred by the server (${acknowledgement.reason ?? "locked"})`);
        }
        if (!save.echoVersion) { clearUnresolvedPost(pending); return acknowledgement; }
        if (!validAcknowledgementVersion(acknowledgement?._saveVersion)) throw new Error("Save acknowledgement did not include a valid authoritative version.");
        clearUnresolvedPost(pending);
        params.latestVersion.current = adoptSaveVersion(params.latestVersion.current, acknowledgement?._saveVersion);
        if (params.latestVersion.current === acknowledgement._saveVersion) params.onAcknowledgedSnapshot?.(save);
        adoptAcknowledgedRyo(save.name, acknowledgement);
        if (params.failureCount.current) { params.failureCount.current = 0; params.setBlocked(false); }
        if (isCurrentSavePayloadRevision(save.revision, params.latestPayloadRevision.current) && save.isStillCurrent()) {
            params.dirty.current = false;
            save.onCommitted();
        }
        return acknowledgement;
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
