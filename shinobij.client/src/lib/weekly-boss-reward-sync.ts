import type { Character, VersionedCharacterCommit } from "../types/character";

/**
 * The Weekly Boss pays its winners on the server, inside their saves, whenever the
 * first request lands after the boss expires. No reply carries that character, so
 * a winner who stayed signed in saw their Core, Key and gear drop only at the next
 * refresh. The public boss state lists the credited players, so any screen that
 * already reads it can notice the credit and adopt the winner's current save.
 *
 * The save is adopted through the same version guarded commit every other server
 * reply uses, so a stale or switched account is refused. Adopting replaces the local
 * character, so it waits until the player has no unsaved edits, and only one
 * adoption per account runs at a time.
 */

type BossLike = { weekKey?: unknown; spawnId?: unknown; creditedPlayers?: unknown; distributedAt?: unknown };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type SyncOptions = {
    name: string;
    commit: VersionedCharacterCommit;
    /** True when the player has no edits waiting to be saved. Adopting a save would erase them. */
    isSaveClean?: () => boolean;
    isCurrent?: () => boolean;
    fetch?: typeof fetch;
    storage?: StorageLike | null;
    toast?: (message: string) => void;
    now?: () => number;
};

/** `adopted`: the save was brought in. `deferred`: try again soon. `skipped`: nothing to do. */
export type WeeklyBossSyncResult = "adopted" | "deferred" | "skipped";

/** A reward older than this is adopted silently: the player has long since seen it. */
export const FRESH_REWARD_MS = 72 * 60 * 60 * 1000;

const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
const syncedThisSession = new Map<string, string>();
const inFlight = new Map<string, Promise<WeeklyBossSyncResult>>();
const storageKey = (account: string) => `weekly-boss-rewards-synced:${account}`;

function browserStorage(): StorageLike | null {
    try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readSynced(account: string, storage: StorageLike | null): string {
    const inMemory = syncedThisSession.get(account);
    if (inMemory) return inMemory;
    try { return storage?.getItem(storageKey(account)) ?? ""; } catch { return ""; }
}

/** The identity of this boss's payout when `name` was credited in it, otherwise null. */
export function weeklyBossRewardKey(boss: BossLike | null | undefined, name: string): string | null {
    const me = slug(name);
    if (!boss || !me) return null;
    const credited = Array.isArray(boss.creditedPlayers) ? boss.creditedPlayers : [];
    if (!credited.some((player) => typeof player === "string" && slug(player) === me)) return null;
    const id = typeof boss.spawnId === "string" && boss.spawnId ? boss.spawnId : typeof boss.weekKey === "string" ? boss.weekKey : "";
    return id || null;
}

/**
 * Adopt the winner's save once per boss payout. A refused or failed attempt leaves
 * the payout unmarked, so a later check tries again. Two callers at once share one
 * adoption, so the player is never adopted twice or told twice.
 */
export function syncWeeklyBossRewards(boss: BossLike | null | undefined, options: SyncOptions): Promise<WeeklyBossSyncResult> {
    const key = weeklyBossRewardKey(boss, options.name);
    if (!key) return Promise.resolve("skipped");
    const account = slug(options.name);
    const storage = options.storage === undefined ? browserStorage() : options.storage;
    if (readSynced(account, storage) === key) return Promise.resolve("skipped");
    const running = inFlight.get(account);
    if (running) return running;
    const attempt = adopt(boss, key, account, storage, options).finally(() => { inFlight.delete(account); });
    inFlight.set(account, attempt);
    return attempt;
}

async function adopt(boss: BossLike | null | undefined, key: string, account: string, storage: StorageLike | null, options: SyncOptions): Promise<WeeklyBossSyncResult> {
    const isCurrent = options.isCurrent ?? (() => true);
    const isClean = options.isSaveClean ?? (() => true);
    if (!isCurrent()) return "skipped";
    if (!isClean()) return "deferred";
    try {
        const response = await (options.fetch ?? fetch)(`/api/save/${encodeURIComponent(account)}`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok || !isCurrent()) return "deferred";
        const snapshot = await response.json() as { character?: Character; _saveVersion?: unknown };
        if (!isCurrent() || !snapshot.character || slug(snapshot.character.name) !== account) return "skipped";
        // The player may have edited while the save was in flight; adopting now would erase that.
        if (!isClean()) return "deferred";
        if (!options.commit(snapshot.character, snapshot._saveVersion)) return "deferred";
    } catch {
        return "deferred";
    }
    syncedThisSession.set(account, key);
    try { storage?.setItem(storageKey(account), key); } catch { /* The session record still prevents a repeat. */ }
    const distributedAt = Number(boss?.distributedAt) || 0;
    const fresh = distributedAt === 0 || (options.now ?? Date.now)() - distributedAt < FRESH_REWARD_MS;
    if (fresh) (options.toast ?? defaultToast)("Your Weekly Boss rewards have arrived. Check your bag.");
    return "adopted";
}

function defaultToast(message: string): void {
    void import("../components/GameToast").then((module) => module.gameToast(message, { kind: "success", duration: 7000 })).catch(() => undefined);
}

export function resetWeeklyBossRewardSyncSession(): void { syncedThisSession.clear(); inFlight.clear(); }
