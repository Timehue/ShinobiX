/*
 * Achievement sync planner — decides WHEN the client may ask the server to
 * reconcile achievements, and guarantees it can never ask twice for the same
 * state.
 *
 * WHY THIS EXISTS (read before changing): achievement state is SERVER-OWNED.
 * `api/save/[name].ts` overwrites `unlockedAchievements`,
 * `achievementUnlockedAt`, `claimedAchievementRewards` and `earnedTitles` with
 * the STORED copy on every generic save, so a client-side unlock can never
 * persist. `POST /api/achievements/sync` is the only authoritative writer — it
 * recomputes eligibility from the stored save, unions in the new ids, and pays
 * each reward exactly once from a server claim ledger.
 *
 * Two failure modes this module exists to prevent:
 *
 *  1. Optimistically writing those server-owned fields on the client. The write
 *     marks the save dirty, the server discards it, the next re-hydrate reverts
 *     it, and the detection effect fires again — an endless save churn that
 *     drove /api/save into 409 version conflicts and then 429 rate limits, and
 *     re-rendered the app constantly (unusable mid-combat). The client must only
 *     ever APPLY what the sync endpoint returns.
 *
 *  2. Calling the sync endpoint from a `[character]` effect with no gate. Any
 *     re-render, heartbeat re-hydrate, or non-persisting server reply turned into
 *     another request. `claimAchievementSync` is the guard rail: one request per
 *     distinct state, never while one is outstanding.
 */

/** A description of how the local save diverges from server achievement truth. */
export interface AchievementSyncPlan {
    /** Eligible achievement ids the save has not recorded as unlocked yet. */
    pendingIds: string[];
    /** True when the unlocked achievements imply a title the save is missing. */
    titlesStale: boolean;
    /**
     * True when the save has never carried an unlock array at all. The server
     * treats its first sync as a backfill: it seeds the claim ledger so existing
     * progress cannot pay a retroactive windfall, which also means that sync
     * neither rewards nor toasts. So we want it to happen EARLY (right after the
     * character loads, even with nothing eligible) rather than lazily on the
     * player's first real unlock — otherwise that first unlock would be silently
     * absorbed as backfill instead of being celebrated and paid.
     */
    uninitialized: boolean;
    /** Whether a sync request is warranted at all. */
    needed: boolean;
}

/**
 * Compare local character state against what the achievement catalog implies.
 * Pure — no storage, no fetch, so the decision is testable in isolation.
 */
export function planAchievementSync(input: {
    eligibleIds: string[];
    unlocked: string[] | undefined;
    earnedTitles: string[] | undefined;
    /** Titles implied by the currently eligible achievements. */
    titlesForUnlocked: string[];
}): AchievementSyncPlan {
    const unlockedSet = new Set(input.unlocked ?? []);
    const pendingIds = input.eligibleIds.filter((id) => !unlockedSet.has(id));
    const titleSet = new Set(input.earnedTitles ?? []);
    // A save can hold unlocks but no titles — `earnedTitles` became server-owned
    // after some saves were already written, and a generic save cannot backfill
    // it. Without this, those players could never recover their titles because
    // pendingIds alone would be empty and no sync would ever run.
    const titlesStale = input.titlesForUnlocked.some((title) => !titleSet.has(title));
    const uninitialized = input.unlocked === undefined;
    return {
        pendingIds,
        titlesStale,
        uninitialized,
        needed: pendingIds.length > 0 || titlesStale || uninitialized,
    };
}

/**
 * Identity of a sync attempt. Two plans that describe the same divergence share
 * a signature, which is what stops a re-render (or a server that declines to
 * persist) from re-issuing the same request forever.
 */
export function achievementSyncSignature(player: string, plan: AchievementSyncPlan): string {
    const flags = `${plan.titlesStale ? "t" : ""}${plan.uninitialized ? "i" : ""}`;
    return `${player.toLowerCase()}|${[...plan.pendingIds].sort().join(",")}|${flags}`;
}

/** Mutable gate state. Held in a ref by the caller; never in React state. */
export interface AchievementSyncGate {
    inFlight: boolean;
    lastSignature: string | null;
}

export function createAchievementSyncGate(): AchievementSyncGate {
    return { inFlight: false, lastSignature: null };
}

/**
 * Reserve the right to POST /api/achievements/sync. Returns true at most once
 * per (player, plan) signature, and never while a request is outstanding — so a
 * re-render storm, a heartbeat re-hydrate, or a server reply that does not
 * persist cannot become a request loop. Call `releaseAchievementSync` when the
 * request settles.
 */
export function claimAchievementSync(
    gate: AchievementSyncGate,
    player: string,
    plan: AchievementSyncPlan,
): boolean {
    if (!plan.needed || !player || gate.inFlight) return false;
    const signature = achievementSyncSignature(player, plan);
    if (gate.lastSignature === signature) return false;
    gate.inFlight = true;
    gate.lastSignature = signature;
    return true;
}

/**
 * Mark the outstanding request finished. The signature stays remembered on
 * purpose: a failed sync must not immediately retry (that is the loop this
 * module prevents). It retries when the divergence changes — a new unlock — or
 * on the next page load.
 */
export function releaseAchievementSync(gate: AchievementSyncGate): void {
    gate.inFlight = false;
}

/** Shape of the /api/achievements/sync reply (only the fields we consume). */
export interface AchievementSyncResponse {
    character?: {
        unlockedAchievements?: unknown;
        achievementUnlockedAt?: unknown;
        earnedTitles?: unknown;
        ryo?: unknown;
        fateShards?: unknown;
    };
    newlyUnlocked?: unknown;
}

/** The character fields a successful sync is allowed to overwrite locally. */
export interface AchievementPatch {
    unlockedAchievements: string[];
    achievementUnlockedAt?: Record<string, number>;
    earnedTitles?: string[];
    ryo?: number;
    fateShards?: number;
}

const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/**
 * Translate a sync reply into a character patch, or null when the reply carried
 * no usable achievement state (so the caller leaves local state untouched).
 *
 * `ryo` / `fateShards` are copied as ABSOLUTE server values, never applied as a
 * delta — a repeated or late-arriving reply therefore cannot double-pay a
 * reward, which is why the payout lives on the server in the first place.
 */
export function achievementPatchFromSync(data: AchievementSyncResponse | null | undefined): AchievementPatch | null {
    const character = data?.character;
    if (!character || !Array.isArray(character.unlockedAchievements)) return null;
    const patch: AchievementPatch = { unlockedAchievements: stringList(character.unlockedAchievements) };
    if (character.achievementUnlockedAt && typeof character.achievementUnlockedAt === "object") {
        const stamps: Record<string, number> = {};
        for (const [id, at] of Object.entries(character.achievementUnlockedAt as Record<string, unknown>)) {
            if (typeof at === "number" && Number.isFinite(at)) stamps[id] = at;
        }
        patch.achievementUnlockedAt = stamps;
    }
    if (Array.isArray(character.earnedTitles)) patch.earnedTitles = stringList(character.earnedTitles);
    if (typeof character.ryo === "number" && Number.isFinite(character.ryo)) patch.ryo = character.ryo;
    if (typeof character.fateShards === "number" && Number.isFinite(character.fateShards)) {
        patch.fateShards = character.fateShards;
    }
    return patch;
}

/** Ids the server reports as newly unlocked by this sync (toast candidates). */
export function syncedToastIds(data: AchievementSyncResponse | null | undefined): string[] {
    return stringList(data?.newlyUnlocked);
}
