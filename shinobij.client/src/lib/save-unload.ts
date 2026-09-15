import { latestSaveConflictRevision, saveConflictAccountKey, stringifySaveConflictPayload, type SaveConflictDraft, type SaveConflictRevision } from "./save-conflict";
import type { SaveSnapshot, UnresolvedSavePost } from "./save-persistence";

export function protectSaveOnUnload<TPayload extends Record<string, unknown>>(params: {
    dirty: boolean;
    flightBusy: boolean;
    accountKey: string;
    sessionEpoch: number;
    latestVersion: number;
    unresolved: UnresolvedSavePost | null;
    liveSnapshot: SaveSnapshot<TPayload> | null;
    captureConflict: (accountName: string, payload: unknown) => SaveConflictDraft;
    discardRevision: (revision: SaveConflictRevision) => void;
    isCurrentSession: (accountKey: string, sessionEpoch: number) => boolean;
    /** False preserves the durable local guard without attempting a forbidden POST. */
    send?: boolean;
    request?: typeof fetch;
}): void {
    const activeUnresolved = params.unresolved
        && params.unresolved.accountKey === params.accountKey
        && params.unresolved.sessionEpoch === params.sessionEpoch
        ? params.unresolved
        : null;
    if (!params.dirty && !params.flightBusy && !activeUnresolved) return;
    const preferUnresolved = !!activeUnresolved
        && (!params.liveSnapshot || activeUnresolved.revision >= params.liveSnapshot.revision);
    const name = preferUnresolved ? activeUnresolved.accountName : params.liveSnapshot?.name;
    const payload = preferUnresolved ? activeUnresolved.body : params.liveSnapshot?.payload;
    if (!name || !payload || !params.accountKey || saveConflictAccountKey(name) !== params.accountKey) return;
    const body = { ...payload, _baseSaveVersion: preferUnresolved ? activeUnresolved.body._baseSaveVersion : params.latestVersion };
    const guard = latestSaveConflictRevision(params.captureConflict(name, body));
    if (params.send === false) return;
    const serializedBody = preferUnresolved ? activeUnresolved.serializedBody : stringifySaveConflictPayload(body);
    // Keepalive has a 64 KiB body budget. Preserve the full durable guard for
    // normal recovery instead of submitting a request the browser must reject.
    // Count UTF-8 bytes: player-authored text can use more than one byte per char.
    if (new TextEncoder().encode(serializedBody).byteLength > 64 * 1024) return;
    void (params.request ?? fetch)(`/api/save/${encodeURIComponent(name.toLowerCase())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: serializedBody,
    }).then(async (response) => {
        if (!response.ok) return;
        const acknowledgement = await response.clone().json().catch(() => null) as { persisted?: boolean; _saveVersion?: number } | null;
        if (acknowledgement?.persisted !== false
            && Number.isSafeInteger(acknowledgement?._saveVersion) && Number(acknowledgement?._saveVersion) > 0
            && params.isCurrentSession(params.accountKey, params.sessionEpoch)) params.discardRevision(guard);
    }).catch(() => undefined);
}
