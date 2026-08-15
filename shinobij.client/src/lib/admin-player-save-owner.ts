export type AdminPlayerSaveSnapshot = Record<string, unknown>;

export type LoadedAdminPlayerSave = Readonly<{
    ownerKey: string;
    snapshot: AdminPlayerSaveSnapshot;
}>;

export type PreparedAdminPlayerSaveWrite = Readonly<{
    ownerKey: string;
    snapshot: AdminPlayerSaveSnapshot;
}>;

export type AdminPlayerMutationToken = Readonly<{
    ownerKey: string;
    epoch: number;
}>;

export type AdminPlayerSaveWriteFailure =
    | "no-loaded-save"
    | "target-changed"
    | "payload-owner-mismatch";

export type AdminPlayerSaveWriteCheck =
    | { ok: true; write: PreparedAdminPlayerSaveWrite }
    | { ok: false; reason: AdminPlayerSaveWriteFailure };

/** Mirrors the server's safeName() rule used to derive save KV keys. */
export function canonicalAdminPlayerKey(name: unknown): string {
    return typeof name === "string"
        ? name.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32)
        : "";
}

export function tagLoadedAdminPlayerSave(
    ownerName: string,
    snapshot: unknown,
): LoadedAdminPlayerSave | null {
    const ownerKey = canonicalAdminPlayerKey(ownerName);
    if (!ownerKey || !snapshotOwnerMatches(ownerKey, snapshot)) return null;
    return { ownerKey, snapshot };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function snapshotOwnerMatches(ownerKey: string, snapshot: unknown): snapshot is AdminPlayerSaveSnapshot {
    if (!isPlainRecord(snapshot)) return false;
    const character = snapshot.character;
    return isPlainRecord(character)
        && canonicalAdminPlayerKey(character.name) === ownerKey;
}

export function prepareAdminPlayerSaveWrite(
    loaded: LoadedAdminPlayerSave | null,
    currentTarget: string,
    snapshot: AdminPlayerSaveSnapshot = loaded?.snapshot ?? {},
): AdminPlayerSaveWriteCheck {
    if (!loaded) return { ok: false, reason: "no-loaded-save" };
    if (canonicalAdminPlayerKey(currentTarget) !== loaded.ownerKey) {
        return { ok: false, reason: "target-changed" };
    }

    if (!snapshotOwnerMatches(loaded.ownerKey, snapshot)) {
        return { ok: false, reason: "payload-owner-mismatch" };
    }

    return { ok: true, write: { ownerKey: loaded.ownerKey, snapshot } };
}

export function createAdminPlayerMutationToken(
    currentEpoch: number,
    targetName: string,
): AdminPlayerMutationToken | null {
    const ownerKey = canonicalAdminPlayerKey(targetName);
    return ownerKey ? { ownerKey, epoch: currentEpoch + 1 } : null;
}

export function isAdminPlayerMutationCurrent(
    mutation: AdminPlayerMutationToken,
    currentEpoch: number,
): boolean {
    return mutation.epoch === currentEpoch;
}

export function isAdminPlayerLookupCurrent(
    requestEpoch: number,
    currentEpoch: number,
    ownerKey: string,
    currentTarget: string,
): boolean {
    return requestEpoch === currentEpoch
        && canonicalAdminPlayerKey(currentTarget) === ownerKey;
}

export function adminPlayerSaveUrl(ownerKey: string, signal = false): string {
    const canonical = canonicalAdminPlayerKey(ownerKey);
    if (!canonical || canonical !== ownerKey) {
        throw new Error("Admin player save owner key must already be canonical.");
    }
    return `/api/save/${encodeURIComponent(ownerKey)}${signal ? "?signal=1" : ""}`;
}
