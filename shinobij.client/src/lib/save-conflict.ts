export const SAVE_CONFLICT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const SAVE_CONFLICT_STORAGE_PREFIX = "ninjav-save-conflict-v1:";

/** The two area labels that mean "there is nothing here for the player to recover". */
export const SAVE_TIMING_ONLY_AREA = "Save timing only";
export const SERVER_MANAGED_AREA = "Server-managed progress";

export type SaveConflictPayload = Record<string, unknown>;

export type SaveConflictRevision = {
    schemaVersion: 1;
    id: string;
    accountName: string;
    accountKey: string;
    detectedAt: number;
    expiresAt: number;
    payload: SaveConflictPayload;
    areas: string[];
};

export type SaveConflictDraft = {
    accountName: string;
    accountKey: string;
    revisions: SaveConflictRevision[];
};

export type SaveConflictStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const EMBEDDED_IMAGE_RE = /^\s*data:image\//i;
const PRESENTATION_KEYS = new Set([
    "image",
    "bodyImage",
    "avatarImage",
    "portrait",
    "bossPortrait",
    "backdropImage",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function saveConflictAccountKey(name: string): string {
    return name.trim().toLowerCase();
}

export function stripEmbeddedSaveImages(_key: string, value: unknown): unknown {
    return typeof value === "string" && EMBEDDED_IMAGE_RE.test(value) ? "" : value;
}

/** Match the JSON-safe body sent to /api/save while removing embedded artwork. */
export function stringifySaveConflictPayload(payload: unknown, space?: number): string {
    return JSON.stringify(payload, stripEmbeddedSaveImages, space);
}

export function sanitizeSaveConflictPayload(payload: unknown): SaveConflictPayload {
    const json = stringifySaveConflictPayload(payload);
    const parsed = json ? JSON.parse(json) as unknown : null;
    if (!isRecord(parsed)) throw new Error("The local save draft was not a valid save payload.");
    return parsed;
}

function canonicalize(value: unknown, key = ""): unknown {
    if (PRESENTATION_KEYS.has(key)) return undefined;
    if (typeof value === "string" && EMBEDDED_IMAGE_RE.test(value)) return "";
    if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const childKey of Object.keys(value).sort()) {
        if (childKey === "_baseSaveVersion" || childKey === "_saveVersion" || childKey === "_saveAt") continue;
        const child = canonicalize(value[childKey], childKey);
        if (child !== undefined) out[childKey] = child;
    }
    return out;
}

type SaveOwnershipModule = typeof import("./save-ownership");

/*
 * Conflict CLASSIFICATION — the ownership mirror plus the area table — is ~6KB
 * of lookup data needed only when a conflict is being described, which is rare
 * and always user-visible. It is code-split out of the boot bundle rather than
 * riding in the entry chunk with the rest of the save path (the entry budget in
 * scripts/check-build-size.mjs is drained, never raised). Both classification
 * sites await loadSaveOwnershipClassifier() before reading areas.
 *
 * If the chunk cannot be fetched, classification degrades to "every field is
 * restorable, area unknown". That is the safe direction: the player is shown a
 * recovery draft that may not be actionable, rather than having one silently
 * dropped.
 */
let ownership: SaveOwnershipModule | null = null;

export async function loadSaveOwnershipClassifier(): Promise<SaveOwnershipModule> {
    if (!ownership) ownership = await import("./save-ownership");
    return ownership;
}

function canonicalRecord(value: unknown): Record<string, unknown> {
    const canonical = canonicalize(value);
    return isRecord(canonical) ? canonical : {};
}

/**
 * Shallow paths at which two save payloads semantically differ: `['currentSector']`
 * for a top-level field, `['character', 'level']` for a character field. That is
 * the granularity the ownership manifest classifies at, so it is the granularity
 * the conflict areas are computed at.
 */
export function differingSavePaths(localPayload: unknown, serverSnapshot: unknown): string[][] {
    const local = canonicalRecord(localPayload);
    const server = canonicalRecord(serverSnapshot);
    const paths: string[][] = [];
    for (const key of [...new Set([...Object.keys(local), ...Object.keys(server)])].sort()) {
        if (JSON.stringify(local[key]) === JSON.stringify(server[key])) continue;
        const localChild = local[key];
        const serverChild = server[key];
        if (key === "character" && isRecord(localChild) && isRecord(serverChild)) {
            for (const field of [...new Set([...Object.keys(localChild), ...Object.keys(serverChild)])].sort()) {
                if (JSON.stringify(localChild[field]) !== JSON.stringify(serverChild[field])) paths.push(["character", field]);
            }
            continue;
        }
        paths.push([key]);
    }
    return paths;
}



/**
 * Name what a player could actually recover from this draft.
 *
 * Only differences a generic save may durably write count. A divergence confined
 * to server-owned fields (level, rank, currencies, counters, payout stamps, and
 * the read-projected vitals) is the server correcting the client — the sanitizer
 * would discard a restore of exactly those fields — so it collapses to
 * SERVER_MANAGED_AREA and the revision is dropped rather than shown. Reporting
 * those as recoverable progress is what made the recovery banner reappear after
 * every autosave with a draft that no button could resolve.
 */
export function detectSaveConflictAreas(localPayload: unknown, serverSnapshot?: unknown): string[] {
    if (!serverSnapshot) return ["Unsaved device progress"];
    const differing = differingSavePaths(localPayload, serverSnapshot);
    if (differing.length === 0) return [SAVE_TIMING_ONLY_AREA];
    const restorable = differing.filter((path) => !(ownership?.isServerOwnedSavePath(path) ?? false));
    if (restorable.length === 0) return [SERVER_MANAGED_AREA];
    const restorableKeys = new Set(restorable.map((path) => path.join(".")));
    const areas = (ownership?.CONFLICT_AREA_PATHS ?? [])
        .filter(({ paths }) => paths.some((path) => restorableKeys.has(path.join("."))))
        .map(({ label }) => label);
    return areas.length > 0 ? areas : ["Other local progress"];
}

const RESOLVED_CONFLICT_AREAS: ReadonlySet<string> = new Set([SAVE_TIMING_ONLY_AREA, SERVER_MANAGED_AREA]);

/** True when these areas name nothing a player could act on. */
export function isResolvedConflictAreas(areas: readonly string[]): boolean {
    return areas.length > 0 && areas.every((area) => RESOLVED_CONFLICT_AREAS.has(area));
}

/** True when a revision holds nothing the player could restore — safe to drop. */
export function isResolvedSaveConflictRevision(revision: SaveConflictRevision): boolean {
    return isResolvedConflictAreas(revision.areas);
}

export function createSaveConflictRevision(params: {
    id: string;
    accountName: string;
    payload: unknown;
    detectedAt?: number;
    serverSnapshot?: unknown;
}): SaveConflictRevision {
    const detectedAt = params.detectedAt ?? Date.now();
    const accountName = params.accountName.trim();
    const payload = sanitizeSaveConflictPayload(params.payload);
    return {
        schemaVersion: 1,
        id: params.id,
        accountName,
        accountKey: saveConflictAccountKey(accountName),
        detectedAt,
        expiresAt: detectedAt + SAVE_CONFLICT_DRAFT_TTL_MS,
        payload,
        areas: detectSaveConflictAreas(payload, params.serverSnapshot),
    };
}

function validRevision(value: unknown, accountName: string, now: number): value is SaveConflictRevision {
    if (!isRecord(value) || value.schemaVersion !== 1) return false;
    if (typeof value.id !== "string" || !value.id) return false;
    if (typeof value.accountName !== "string" || typeof value.accountKey !== "string") return false;
    if (value.accountKey !== saveConflictAccountKey(accountName)) return false;
    if (typeof value.detectedAt !== "number" || !Number.isFinite(value.detectedAt)) return false;
    if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) return false;
    if (value.expiresAt - value.detectedAt > SAVE_CONFLICT_DRAFT_TTL_MS) return false;
    return isRecord(value.payload)
        && Array.isArray(value.areas)
        && value.areas.every((area) => typeof area === "string");
}

export function mergeSaveConflictRevisions(
    accountName: string,
    revisions: readonly SaveConflictRevision[],
    now = Date.now(),
): SaveConflictDraft | null {
    const normalized = saveConflictAccountKey(accountName);
    const byId = new Map<string, SaveConflictRevision>();
    for (const revision of revisions) {
        if (revision.accountKey !== normalized || revision.expiresAt <= now) continue;
        byId.set(revision.id, revision);
    }
    const merged = [...byId.values()].sort((left, right) => left.detectedAt - right.detectedAt || left.id.localeCompare(right.id));
    return merged.length ? { accountName: accountName.trim(), accountKey: normalized, revisions: merged } : null;
}

export function updateSaveConflictAreas(draft: SaveConflictDraft, serverSnapshot: unknown): SaveConflictDraft {
    return {
        ...draft,
        revisions: draft.revisions.map((revision) => ({
            ...revision,
            areas: detectSaveConflictAreas(revision.payload, serverSnapshot),
        })),
    };
}

export function latestSaveConflictRevision(draft: SaveConflictDraft): SaveConflictRevision {
    return draft.revisions[draft.revisions.length - 1];
}

function storagePrefixForAccount(accountName: string): string {
    return `${SAVE_CONFLICT_STORAGE_PREFIX}${encodeURIComponent(saveConflictAccountKey(accountName))}:`;
}

export function saveConflictRevisionStorageKey(revision: SaveConflictRevision): string {
    return `${storagePrefixForAccount(revision.accountName)}${encodeURIComponent(revision.id)}`;
}

export function writeSaveConflictRevision(storage: SaveConflictStorage, revision: SaveConflictRevision): void {
    storage.setItem(saveConflictRevisionStorageKey(revision), stringifySaveConflictPayload(revision));
}

export function loadSaveConflictDraft(
    storage: SaveConflictStorage,
    accountName: string,
    now = Date.now(),
): { draft: SaveConflictDraft | null; staleKeys: string[] } {
    const prefix = storagePrefixForAccount(accountName);
    const revisions: SaveConflictRevision[] = [];
    const staleKeys: string[] = [];
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
        try {
            const raw = storage.getItem(key);
            const parsed = raw ? JSON.parse(raw) as unknown : null;
            if (!validRevision(parsed, accountName, now)) {
                staleKeys.push(key);
                continue;
            }
            revisions.push({ ...parsed, payload: sanitizeSaveConflictPayload(parsed.payload) });
        } catch {
            staleKeys.push(key);
        }
    }
    return { draft: mergeSaveConflictRevisions(accountName, revisions, now), staleKeys };
}

export function clearSaveConflictStorage(storage: SaveConflictStorage, accountName: string): void {
    const prefix = storagePrefixForAccount(accountName);
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
}

export function buildSaveConflictRestorePayload(draft: SaveConflictDraft, latestBaseVersion: number): SaveConflictPayload {
    const latest = latestSaveConflictRevision(draft);
    return sanitizeSaveConflictPayload({ ...latest.payload, _baseSaveVersion: latestBaseVersion });
}

export function serializeSaveConflictDownload(draft: SaveConflictDraft, exportedAt = Date.now()): string {
    return stringifySaveConflictPayload({
        kind: "shinobi-save-conflict-draft",
        schemaVersion: 1,
        accountName: draft.accountName,
        exportedAt,
        revisionCount: draft.revisions.length,
        revisions: draft.revisions,
    }, 2);
}

export function saveConflictDownloadFilename(draft: SaveConflictDraft): string {
    const safeAccount = draft.accountKey.replace(/[^a-z0-9_-]+/g, "-") || "player";
    const stamp = new Date(latestSaveConflictRevision(draft).detectedAt).toISOString().replace(/[:.]/g, "-");
    return `shinobi-local-draft-${safeAccount}-${stamp}.json`;
}

export type SaveConflictDraftStore = ReturnType<typeof createSaveConflictDraftStore>;

/**
 * Owns the browser-storage and in-memory lifecycle for recoverable save drafts.
 * Network recovery remains in App because it must coordinate the active account
 * epoch, authoritative snapshot application, and the current save-version ref.
 */
export function createSaveConflictDraftStore(params: {
    storage: SaveConflictStorage;
    activeAccountKey: () => string;
    onVisibleDraft: (draft: SaveConflictDraft | null) => void;
    reportStorageFailure: (error: unknown) => void;
}): {
    capture: (accountName: string, payload: unknown) => SaveConflictDraft;
    discard: (revision: SaveConflictRevision) => void;
    rehydrate: (accountName: string, serverSnapshot?: unknown) => Promise<SaveConflictDraft | null>;
    clear: (accountName: string) => void;
    load: (accountName: string) => SaveConflictDraft | null;
} {
    const memory = new Map<string, SaveConflictDraft>();
    let idSequence = 0;
    let lastDetectedAt = 0;

    const nextId = (): string => {
        idSequence += 1;
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
        return `${Date.now()}-${idSequence}-${Math.random().toString(36).slice(2)}`;
    };
    const load = (accountName: string): SaveConflictDraft | null => {
        const accountKey = saveConflictAccountKey(accountName);
        if (!accountKey) return null;
        const inMemory = memory.get(accountKey) ?? null;
        let stored: SaveConflictDraft | null = null;
        try {
            const loaded = loadSaveConflictDraft(params.storage, accountName);
            stored = loaded.draft;
            for (const staleKey of loaded.staleKeys) {
                try { params.storage.removeItem(staleKey); } catch (error) { params.reportStorageFailure(error); }
            }
        } catch (error) {
            params.reportStorageFailure(error);
        }
        const merged = mergeSaveConflictRevisions(accountName, [
            ...(inMemory?.revisions ?? []),
            ...(stored?.revisions ?? []),
        ]);
        if (merged) memory.set(accountKey, merged);
        else memory.delete(accountKey);
        return merged;
    };
    const capture = (accountName: string, payload: unknown): SaveConflictDraft => {
        // Load first so a fresh tab/store instance cannot stamp a new revision at
        // the same millisecond as an already-persisted one and then lose "newest"
        // status to the random UUID tie-breaker.
        const existing = load(accountName);
        const newestStoredAt = existing?.revisions.at(-1)?.detectedAt ?? 0;
        const detectedAt = Math.max(Date.now(), lastDetectedAt + 1, newestStoredAt + 1);
        lastDetectedAt = detectedAt;
        const revision = createSaveConflictRevision({ id: nextId(), accountName, payload, detectedAt });
        const merged = mergeSaveConflictRevisions(accountName, [
            ...(existing?.revisions ?? []),
            revision,
        ]);
        if (!merged) throw new Error("The local conflict draft could not be prepared.");
        memory.set(revision.accountKey, merged);
        // ⛔ Capture PROTECTS, it does not ANNOUNCE. Never surface the draft here.
        //
        // A capture happens the moment a save is rejected, before recovery has run
        // and before the payload has ever been compared to the server — its areas
        // are still the "Unsaved device progress" placeholder. Most conflicts heal
        // themselves a round-trip later, so surfacing here showed the player a
        // recovery banner for a divergence that did not survive the next refetch:
        // it appeared mid-play, then dismissed itself seconds later. Every capture
        // path is followed by a rehydrate (409 → refetch → applyServerSnapshot;
        // unload → next boot; restore → applyAuthoritative), and rehydrate
        // classifies against real authority. Let IT decide what the player sees.
        try { writeSaveConflictRevision(params.storage, revision); } catch (error) { params.reportStorageFailure(error); }
        return merged;
    };
    const discard = (revision: SaveConflictRevision): void => {
        try { params.storage.removeItem(saveConflictRevisionStorageKey(revision)); } catch (error) { params.reportStorageFailure(error); }
        const current = memory.get(revision.accountKey);
        const remaining = mergeSaveConflictRevisions(
            revision.accountName,
            (current?.revisions ?? []).filter((entry) => entry.id !== revision.id),
        );
        if (remaining) memory.set(revision.accountKey, remaining);
        else memory.delete(revision.accountKey);
        params.onVisibleDraft(remaining);
    };
    /**
     * Re-classify stored drafts against authority and surface what survives.
     *
     * ⛔ `serverSnapshot` must be the SERVER's answer, never the localStorage
     * preview cache. Classifying a protected draft against that cache compares
     * the client to its own stale copy — they differ by whatever changed since
     * the last autosave, so it always "finds" a divergence. The optimistic boot
     * paint applies the preview through applyServerSnapshot, which is why that
     * call passes `authoritative: false`: without it the recovery banner flashed
     * on every refresh and dismissed itself once the real save landed.
     */
    const rehydrate = async (accountName: string, serverSnapshot?: unknown): Promise<SaveConflictDraft | null> => {
        const accountKey = saveConflictAccountKey(accountName);
        let draft = load(accountName);
        if (draft && serverSnapshot !== undefined) {
            // Classify with the ownership mirror loaded, never without it: a
            // server-owned-only draft must be recognised and dropped here, which
            // is the whole reason the banner used to be unclearable.
            await loadSaveOwnershipClassifier().catch(() => undefined);
            draft = updateSaveConflictAreas(draft, serverSnapshot);
            const resolved = draft.revisions.filter(isResolvedSaveConflictRevision);
            draft = mergeSaveConflictRevisions(
                accountName,
                draft.revisions.filter((revision) => !resolved.includes(revision)),
            );
            if (draft) memory.set(accountKey, draft);
            else memory.delete(accountKey);
            try {
                for (const revision of resolved) params.storage.removeItem(saveConflictRevisionStorageKey(revision));
                for (const revision of draft?.revisions ?? []) writeSaveConflictRevision(params.storage, revision);
            } catch (error) {
                params.reportStorageFailure(error);
            }
        }
        if (params.activeAccountKey() === accountKey) params.onVisibleDraft(draft);
        return draft;
    };
    const clear = (accountName: string): void => {
        const accountKey = saveConflictAccountKey(accountName);
        try { clearSaveConflictStorage(params.storage, accountName); } catch (error) { params.reportStorageFailure(error); }
        memory.delete(accountKey);
        params.onVisibleDraft(null);
    };
    return { capture, discard, rehydrate, clear, load };
}
