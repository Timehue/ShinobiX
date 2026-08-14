import {
    buildSaveConflictRestorePayload,
    detectSaveConflictAreas,
    latestSaveConflictRevision,
    saveConflictAccountKey,
    stringifySaveConflictPayload,
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

function timingOnly(left: unknown, right: unknown): boolean {
    const areas = detectSaveConflictAreas(left, right);
    return areas.length === 1 && areas[0] === "Save timing only";
}

/**
 * Restore one protected revision as an exclusive, exact-version transaction.
 * The selected revision is discarded only after the authoritative read-back is
 * byte-semantically equivalent and carries the same version as the write ack.
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
}): Promise<void> {
    const request = params.request ?? fetch;
    const assertCurrent = (accountKey: string) => {
        if (!params.isCurrentSession(accountKey, params.sessionEpoch)) {
            throw new Error("The active account changed. The local draft remains protected.");
        }
    };
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
                && (!startingLocal || currentLocal.revision > startingLocal.revision || !timingOnly(startingLocal.payload, currentLocal.payload))) {
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

        if (exactSaveVersion(verified._saveVersion) !== acknowledgedVersion || !timingOnly(selected.payload, verified)) {
            applyAuthoritative(verified);
            throw new Error("The server changed before the restored draft could be verified. The local draft remains protected.");
        }
        applyAuthoritative(verified);
        assertCurrent(draft.accountKey);
        params.discardRevision(selected);
    });
}
