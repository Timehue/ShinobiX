import {
    buildSaveConflictRestorePayload,
    detectSaveConflictAreas,
    isResolvedConflictAreas,
    latestSaveConflictRevision,
    loadSaveOwnershipClassifier,
    saveConflictAccountKey,
    stringifySaveConflictPayload,
    SAVE_TIMING_ONLY_AREA,
    SERVER_MANAGED_AREA,
    type SaveConflictDraft,
    type SaveConflictRevision,
} from "./save-conflict";
import type { SaveSnapshot } from "./save-persistence";

type MutableNumberRef = { current: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactSaveVersion(value: unknown): number | null {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

/**
 * True when the difference between two local snapshots holds nothing worth
 * protecting — either no semantic change at all, or one confined to fields the
 * server owns and would discard from a generic save anyway.
 */
function nothingRecoverable(left: unknown, right: unknown): boolean {
    return isResolvedConflictAreas(detectSaveConflictAreas(left, right));
}

/**
 * Restore one protected revision as an exclusive transaction.
 *
 * The revision is discarded once the write is DURABLE — the server acknowledged
 * it and the authoritative read-back is at or past the acknowledged version.
 *
 * It deliberately does NOT require the server to echo the draft back. A generic
 * save is sanitized: the server copies its own stored values over every
 * server-owned field (api/save/_state-ownership.ts), so a byte-semantic equality
 * check can only pass for a draft that diverged in purely client-owned state.
 * Requiring it meant the restore wrote successfully, failed its own
 * verification, reported "the server changed", and kept the draft forever — the
 * banner could never be cleared by the button meant to clear it.
 *
 * What the server declined to take is reported back as `declined` so the caller
 * can tell the player the truth instead of raising an error.
 */
export async function restoreSaveConflictRevision<TPayload extends Record<string, unknown>>(params: {
    visibleDraft: SaveConflictDraft;
    sessionEpoch: number;
    runExclusive: <T>(work: () => Promise<T>) => Promise<unknown>;
    isCurrentSession: (accountKey: string, sessionEpoch: number) => boolean;
    loadDraft: (accountName: string) => SaveConflictDraft | null;
    latestVersion: MutableNumberRef;
    currentSnapshot: () => SaveSnapshot<TPayload> | null;
    captureConflict: (accountName: string, payload: unknown) => unknown;
    applySnapshot: (snapshot: TPayload & { _saveVersion?: number }) => boolean;
    discardRevision: (revision: SaveConflictRevision) => void;
    request?: typeof fetch;
    timeoutMs?: number;
}): Promise<{ declined: string[] }> {
    const request = params.request ?? fetch;
    // Null until the exclusive body actually commits, so a queue that resolves
    // without running the work can never be reported to the player as a restore.
    let outcome: { declined: string[] } | null = null;
    const assertCurrent = (accountKey: string) => {
        if (!params.isCurrentSession(accountKey, params.sessionEpoch)) {
            throw new Error("The active account changed. The local draft remains protected.");
        }
    };
    // Both the advanced-local guard and the declined-areas report classify by
    // ownership, so the mirror must be resident before either runs.
    await loadSaveOwnershipClassifier().catch(() => undefined);
    await params.runExclusive(async () => {
        assertCurrent(params.visibleDraft.accountKey);
        const draft = params.loadDraft(params.visibleDraft.accountName) ?? params.visibleDraft;
        if (draft.accountKey !== params.visibleDraft.accountKey) throw new Error("The protected draft no longer matches this account.");
        const selected = latestSaveConflictRevision(draft);
        const startingLocal = params.currentSnapshot();
        const restorePayload = buildSaveConflictRestorePayload({ ...draft, revisions: [selected] }, params.latestVersion.current);
        const requestInit = (init: RequestInit): RequestInit => ({ ...init, signal: AbortSignal.timeout(params.timeoutMs ?? 15_000) });
        const protectAdvancedLocal = () => {
            const currentLocal = params.currentSnapshot();
            if (currentLocal
                && saveConflictAccountKey(currentLocal.name) === draft.accountKey
                && (!startingLocal || currentLocal.revision > startingLocal.revision || !nothingRecoverable(startingLocal.payload, currentLocal.payload))) {
                params.captureConflict(currentLocal.name, { ...currentLocal.payload, _baseSaveVersion: params.latestVersion.current });
            }
        };
        const applyAuthoritative = (raw: unknown): TPayload & { _saveVersion?: number } => {
            assertCurrent(draft.accountKey);
            if (!isRecord(raw) || !isRecord(raw.character)) throw new Error("The authoritative restore response was invalid. The local draft remains protected.");
            const snapshot = raw as TPayload & { _saveVersion?: number };
            if (saveConflictAccountKey(String((snapshot.character as Record<string, unknown>).name ?? "")) !== draft.accountKey) {
                throw new Error("The authoritative restore response belonged to a different account. The local draft remains protected.");
            }
            const version = exactSaveVersion(snapshot._saveVersion);
            if (version === null) throw new Error("The server did not return an authoritative save version. The local draft remains protected.");
            protectAdvancedLocal();
            assertCurrent(draft.accountKey);
            if (!params.applySnapshot(snapshot)) throw new Error("The server save is authoritative, but this client has already advanced. The local draft remains protected.");
            assertCurrent(draft.accountKey);
            params.latestVersion.current = Math.max(params.latestVersion.current, version);
            return snapshot;
        };
        const refreshAuthority = async () => {
            const refreshedResponse = await request(`/api/save/${encodeURIComponent(draft.accountName.toLowerCase())}`, requestInit({ cache: "no-store" }));
            assertCurrent(draft.accountKey);
            if (!refreshedResponse.ok) throw new Error("The server changed again, but its newest save could not be loaded. Your same local draft remains protected.");
            const refreshedRaw = await refreshedResponse.json().catch(() => null);
            return applyAuthoritative(refreshedRaw);
        };
        const response = await request(`/api/save/${encodeURIComponent(draft.accountName.toLowerCase())}`, requestInit({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: stringifySaveConflictPayload(restorePayload),
        }));
        assertCurrent(draft.accountKey);
        if (response.status === 409) {
            await refreshAuthority();
            throw new Error("The server changed again. Its newest save is now active and your same local draft is protected; try Restore again when ready.");
        }
        if (!response.ok) throw new Error(`The server could not restore this draft (status ${response.status}).`);
        const acknowledgement = await response.json().catch(() => null);
        assertCurrent(draft.accountKey);
        if (!isRecord(acknowledgement)) throw new Error("The server returned an invalid restore acknowledgement. Your draft remains protected.");
        if (acknowledgement.persisted === false) throw new Error(`The server deferred this restore (${String(acknowledgement.reason ?? "save locked")}). Your draft is still protected.`);
        const acknowledgedVersion = exactSaveVersion(acknowledgement._saveVersion);
        if (acknowledgedVersion === null) throw new Error("The server did not confirm an authoritative save version. Your draft remains protected.");

        const verifyResponse = await request(`/api/save/${encodeURIComponent(draft.accountName.toLowerCase())}`, requestInit({ cache: "no-store" }));
        assertCurrent(draft.accountKey);
        if (!verifyResponse.ok) throw new Error("The draft was accepted, but its authoritative result could not be verified yet. The local draft remains protected.");
        const verifiedRaw = await verifyResponse.json().catch(() => null);
        assertCurrent(draft.accountKey);
        if (!isRecord(verifiedRaw) || !isRecord(verifiedRaw.character)) throw new Error("The authoritative restore response was invalid. The local draft remains protected.");
        const verified = verifiedRaw as TPayload & { _saveVersion?: number };
        if (saveConflictAccountKey(String((verified.character as Record<string, unknown>).name ?? "")) !== draft.accountKey) {
            throw new Error("The authoritative restore response belonged to a different account. The local draft remains protected.");
        }

        const verifiedVersion = exactSaveVersion(verified._saveVersion);
        if (verifiedVersion === null || verifiedVersion < acknowledgedVersion) {
            // The authoritative save is BEHIND the version we were just handed —
            // the write we acknowledged is not the one being served. Keep the
            // draft; this is the one case where the restore genuinely did not stick.
            applyAuthoritative(verified);
            throw new Error("The server could not confirm the restored draft is live. The local draft remains protected.");
        }

        // Everything the sanitizer refused to take from the draft. Reported, not
        // thrown: the write is durable and the draft has served its purpose.
        const declined = detectSaveConflictAreas(selected.payload, verified)
            .filter((area) => area !== SAVE_TIMING_ONLY_AREA && area !== SERVER_MANAGED_AREA);

        applyAuthoritative(verified);
        assertCurrent(draft.accountKey);
        params.discardRevision(selected);
        outcome = { declined };
    });
    if (!outcome) throw new Error("The restore never ran. The local draft remains protected.");
    return outcome;
}
