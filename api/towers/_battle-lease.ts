import { randomUUID } from 'node:crypto';
import { kv as realKv } from '../_storage.js';
import { withKvLock as realWithKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { sessionKey, TOWER_SESSION_TTL, type TowerKv, type TowerLock } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';
import {
    isTowerBattleLock,
    TOWER_BATTLE_LOCK_KIND,
    TOWER_BATTLE_LOCK_SCREEN,
    type TowerBattleLock,
} from '../_tower-battle-guard.js';

export { TOWER_BATTLE_LOCK_KIND, TOWER_BATTLE_LOCK_SCREEN } from '../_tower-battle-guard.js';
export type { TowerBattleLock } from '../_tower-battle-guard.js';
export const TOWER_BATTLE_LOCK_TTL = TOWER_SESSION_TTL;
export const TOWER_BATTLE_PUBLICATION_GRACE_MS = 5 * 60 * 1_000;
export const CLAN_BOSS_MARKER_PUBLICATION_TTL = TOWER_SESSION_TTL;

export type TowerBattleLeaseDeps = {
    kv?: TowerKv;
    lock?: TowerLock;
    now?: () => number;
    beforeConfirmedMissingRelease?: (lease: TowerBattleLock) => Promise<void>;
};

export type TowerBattleLeaseClaim =
    | { ok: true; members: string[]; replayed: boolean }
    | { ok: false; code: 'member-busy'; members: string[] };

export const battleLockKey = (slug: string) => `battle-lock:${safeName(slug)}`;
export const clanBossBattleMarkerKey = (slug: string) => `tower-engine-clan-boss:${safeName(slug)}`;

export type ClanBossBattleMarker = {
    kind: 'clanBoss';
    requestId: string;
    startedAt: number;
    runId: string;
};

function isClanBossBattleMarker(value: unknown): value is ClanBossBattleMarker {
    if (!value || typeof value !== 'object') return false;
    const marker = value as Partial<ClanBossBattleMarker>;
    return marker.kind === 'clanBoss'
        && typeof marker.requestId === 'string'
        && /^[A-Za-z0-9_-]{8,96}$/.test(marker.requestId)
        && Number.isFinite(marker.startedAt)
        && typeof marker.runId === 'string'
        && marker.runId.startsWith('cboss-');
}

function normalizedMembers(members: readonly string[]): string[] {
    return [...new Set(members.map(safeName).filter(Boolean))].sort();
}

async function deleteExactLease(kv: TowerKv, key: string, expected: TowerBattleLock): Promise<boolean> {
    // Production storage supports full-JSON CAS. Swap the object to a unique,
    // short-lived tombstone first, then use the existing atomic string delete.
    // If another writer wins after the swap, delIfEqual cannot erase it. The
    // fallback is for narrow injected test stores and remains serialized by the
    // same battle-lock mutex as every application writer.
    if (kv.compareSet && kv.delIfEqual) {
        const tombstone = `tower-lease-release:${randomUUID()}`;
        if (!(await kv.compareSet(key, expected, tombstone, { ex: 30 }))) return false;
        return kv.delIfEqual(key, tombstone);
    }
    const current = await kv.get<unknown>(key);
    if (!matchingTowerLease(current, expected.battleId)
        || JSON.stringify(current) !== JSON.stringify(expected)) return false;
    return (await kv.del(key)) > 0;
}

async function underMemberLocks<T>(
    members: readonly string[],
    lock: TowerLock,
    fn: () => Promise<T>,
    index = 0,
): Promise<T> {
    if (index >= members.length) return fn();
    return lock(battleLockKey(members[index]!), () => underMemberLocks(members, lock, fn, index + 1), { failClosed: true });
}

export function matchingTowerLease(value: unknown, runId: string): value is TowerBattleLock {
    return isTowerBattleLock(value) && value.battleId === runId;
}

/**
 * Atomically claim every live participant against the shared account-wide
 * `battle-lock:<slug>` namespace. Sorted nested locks interoperate with the
 * existing single-player battle-lock endpoint and avoid party/party deadlocks.
 */
export async function claimTowerBattleLeases(input: {
    runId: string;
    members: readonly string[];
    partyId?: string;
    /** @deprecated Same-run leases are always preserved on a conflicting claim. */
    preserveExistingOnConflict?: boolean;
    /** False fills only missing leases and does not extend existing TTLs. */
    refreshExisting?: boolean;
}, deps: TowerBattleLeaseDeps = {}): Promise<TowerBattleLeaseClaim> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const members = normalizedMembers(input.members);
    if (!members.length) return { ok: false, code: 'member-busy', members: [] };

    return underMemberLocks(members, lock, async () => {
        const rows = await Promise.all(members.map(async member => ({
            member,
            value: await kv.get<unknown>(battleLockKey(member)),
            clanBossMarker: await kv.get<unknown>(clanBossBattleMarkerKey(member)),
        })));
        const activeClanBossMembers = new Set<string>();
        for (const row of rows) {
            if (!isClanBossBattleMarker(row.clanBossMarker)) continue;
            const markerSession = await kv.get<TowerSession>(sessionKey(row.clanBossMarker.runId));
            if (markerSession
                || now() - row.clanBossMarker.startedAt < TOWER_BATTLE_PUBLICATION_GRACE_MS) {
                activeClanBossMembers.add(row.member);
            } else {
                await kv.del(clanBossBattleMarkerKey(row.member));
            }
        }
        const busy = rows
            .filter(row => (row.value !== null && !matchingTowerLease(row.value, input.runId))
                || activeClanBossMembers.has(row.member))
            .map(row => row.member);
        if (busy.length) {
            // A conflicting member must never strip a legitimate same-run lease
            // from an already-published run. Confirmed no-session recovery owns
            // exact-run release; a non-conflicting partial claim is filled below.
            return { ok: false, code: 'member-busy', members: busy };
        }

        const replayed = rows.every(row => matchingTowerLease(row.value, input.runId));
        const newlyCreated: string[] = [];
        try {
            for (const row of rows) {
                const prior = matchingTowerLease(row.value, input.runId) ? row.value : null;
                if (prior && input.refreshExisting === false) continue;
                const lease: TowerBattleLock = {
                    battleId: input.runId,
                    kind: TOWER_BATTLE_LOCK_KIND,
                    screen: TOWER_BATTLE_LOCK_SCREEN,
                    startedAt: prior?.startedAt ?? now(),
                    meta: {
                        runId: input.runId,
                        ...(input.partyId ? { partyId: input.partyId } : {}),
                    },
                };
                // Mark a missing row before the write: a remote adapter may
                // commit and then throw. Refreshed same-run rows are deliberately
                // excluded so rollback can never strip a published run's lease.
                if (!prior) newlyCreated.push(row.member);
                if ((await kv.set(battleLockKey(row.member), lease, { ex: TOWER_BATTLE_LOCK_TTL })) === null) {
                    throw new Error(`Tower battle lease write rejected for ${row.member}.`);
                }
            }
        } catch (error) {
            for (const member of newlyCreated) {
                const observed = await kv.get<unknown>(battleLockKey(member)).catch(() => null);
                if (matchingTowerLease(observed, input.runId)) {
                    await deleteExactLease(kv, battleLockKey(member), observed).catch(() => false);
                }
            }
            throw error;
        }
        return { ok: true, members, replayed };
    });
}

/**
 * Directional Tower/Clan-Boss serialization. The short marker is minted under
 * the same sorted account mutexes used by Tower lease claims, closing the race
 * where both modes could preflight empty and publish simultaneously.
 */
export async function claimClanBossBattleMarkers(input: {
    requestId: string;
    runId: string;
    members: readonly string[];
}, deps: TowerBattleLeaseDeps = {}): Promise<TowerBattleLeaseClaim> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const members = normalizedMembers(input.members);
    if (!members.length) return { ok: false, code: 'member-busy', members: [] };
    return underMemberLocks(members, lock, async () => {
        const rows = await Promise.all(members.map(async member => ({
            member,
            battle: await kv.get<unknown>(battleLockKey(member)),
            marker: await kv.get<unknown>(clanBossBattleMarkerKey(member)),
        })));
        const busy = rows.filter(row => row.battle !== null
            || (isClanBossBattleMarker(row.marker) && row.marker.requestId !== input.requestId))
            .map(row => row.member);
        if (busy.length) return { ok: false, code: 'member-busy', members: busy };

        const newlyCreated = rows.filter(row => !isClanBossBattleMarker(row.marker)).map(row => row.member);
        try {
            for (const row of rows) {
                const prior = isClanBossBattleMarker(row.marker) ? row.marker : null;
                const marker: ClanBossBattleMarker = {
                    kind: 'clanBoss',
                    requestId: input.requestId,
                    startedAt: prior?.startedAt ?? now(),
                    runId: prior?.runId ?? input.runId,
                };
                if ((await kv.set(clanBossBattleMarkerKey(row.member), marker, { ex: CLAN_BOSS_MARKER_PUBLICATION_TTL })) === null) {
                    throw new Error(`Clan Boss battle marker write rejected for ${row.member}.`);
                }
            }
        } catch (error) {
            for (const member of newlyCreated) {
                const observed = await kv.get<unknown>(clanBossBattleMarkerKey(member)).catch(() => null);
                if (isClanBossBattleMarker(observed) && observed.requestId === input.requestId) {
                    await kv.del(clanBossBattleMarkerKey(member)).catch(() => 0);
                }
            }
            throw error;
        }
        return {
            ok: true,
            members,
            replayed: rows.every(row => isClanBossBattleMarker(row.marker) && row.marker.requestId === input.requestId),
        };
    });
}

/** Promote a publication marker to the session TTL once the run exists. */
export async function bindClanBossBattleMarkers(input: {
    requestId: string;
    runId: string;
    members: readonly string[];
}, deps: TowerBattleLeaseDeps = {}): Promise<void> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const members = normalizedMembers(input.members);
    await underMemberLocks(members, lock, async () => {
        for (const member of members) {
            const marker = await kv.get<unknown>(clanBossBattleMarkerKey(member));
            if (!isClanBossBattleMarker(marker) || marker.requestId !== input.requestId) {
                throw new Error(`Clan Boss battle marker is unavailable for ${member}.`);
            }
            const written = await kv.set(clanBossBattleMarkerKey(member), {
                ...marker,
                runId: input.runId,
            } satisfies ClanBossBattleMarker, { ex: TOWER_SESSION_TTL });
            if (written === null) throw new Error(`Clan Boss battle marker bind rejected for ${member}.`);
        }
    });
}

export async function releaseClanBossStartMarkers(
    requestId: string,
    proposedRunId: string,
    membersInput: readonly string[],
    deps: TowerBattleLeaseDeps = {},
): Promise<void> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const members = normalizedMembers(membersInput);
    await underMemberLocks(members, lock, async () => {
        for (const member of members) {
            const marker = await kv.get<unknown>(clanBossBattleMarkerKey(member));
            if (isClanBossBattleMarker(marker)
                && marker.requestId === requestId
                && marker.runId === proposedRunId) {
                await kv.del(clanBossBattleMarkerKey(member));
            }
        }
    });
}

export async function releaseClanBossBattleMarkers(
    runId: string,
    membersInput: readonly string[],
    deps: TowerBattleLeaseDeps = {},
): Promise<void> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const members = normalizedMembers(membersInput);
    await underMemberLocks(members, lock, async () => {
        for (const member of members) {
            const marker = await kv.get<unknown>(clanBossBattleMarkerKey(member));
            if (isClanBossBattleMarker(marker) && marker.runId === runId) {
                await kv.del(clanBossBattleMarkerKey(member));
            }
        }
    });
}

export async function refreshClanBossBattleMarkers(
    runId: string,
    membersInput: readonly string[],
    deps: TowerBattleLeaseDeps = {},
): Promise<void> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const members = normalizedMembers(membersInput);
    await underMemberLocks(members, lock, async () => {
        for (const member of members) {
            const battle = await kv.get<unknown>(battleLockKey(member));
            const marker = await kv.get<unknown>(clanBossBattleMarkerKey(member));
            if (battle !== null) throw new Error(`Clan Boss member ${member} is already locked by another battle.`);
            if (isClanBossBattleMarker(marker) && marker.runId !== runId) {
                throw new Error(`Clan Boss member ${member} belongs to another operation.`);
            }
            const next: ClanBossBattleMarker = isClanBossBattleMarker(marker)
                ? marker
                : {
                    kind: 'clanBoss',
                    requestId: `recover_${runId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96),
                    runId,
                    startedAt: now(),
                };
            const written = await kv.set(clanBossBattleMarkerKey(member), next, { ex: TOWER_SESSION_TTL });
            if (written === null) throw new Error(`Clan Boss battle marker refresh rejected for ${member}.`);
        }
    });
}

/** Fill missing legacy/partial leases without extending existing lease TTLs. */
export async function ensureTowerBattleLeases(input: {
    runId: string;
    members: readonly string[];
    partyId?: string;
}, deps: TowerBattleLeaseDeps = {}): Promise<TowerBattleLeaseClaim> {
    return claimTowerBattleLeases({ ...input, refreshExisting: false }, deps);
}

/** Read a well-formed Tower-owned lease for one account. */
export async function towerBattleLeaseForMember(
    memberInput: string,
    deps: TowerBattleLeaseDeps = {},
): Promise<TowerBattleLock | null> {
    const kv = deps.kv ?? realKv;
    const member = safeName(memberInput);
    if (!member) return null;
    const value = await kv.get<unknown>(battleLockKey(member));
    if (!value || typeof value !== 'object') return null;
    const runId = String((value as Partial<TowerBattleLock>).battleId ?? '');
    return matchingTowerLease(value, runId) ? value : null;
}

export type MissingTowerLeaseRecovery = {
    released: boolean;
    pending: boolean;
};

/**
 * Recover a crash-partial claim only after the caller has authoritatively read a
 * missing session. A short publication grace avoids racing a legitimate start;
 * storage read/CAS errors throw so callers fail closed.
 */
export async function recoverConfirmedMissingTowerBattleLease(
    runId: string,
    memberInput: string,
    deps: TowerBattleLeaseDeps = {},
): Promise<MissingTowerLeaseRecovery> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const member = safeName(memberInput);
    if (!member) return { released: false, pending: false };
    return lock(battleLockKey(member), async () => {
        const observed = await kv.get<unknown>(battleLockKey(member));
        if (!matchingTowerLease(observed, runId)) return { released: false, pending: false };
        if (now() - observed.startedAt < TOWER_BATTLE_PUBLICATION_GRACE_MS) {
            return { released: false, pending: true };
        }
        await deps.beforeConfirmedMissingRelease?.(observed);
        const released = await deleteExactLease(kv, battleLockKey(member), observed);
        return { released, pending: false };
    }, { failClosed: true });
}

export async function refreshTowerBattleLeases(input: {
    runId: string;
    members: readonly string[];
    partyId?: string;
}, deps: TowerBattleLeaseDeps = {}): Promise<TowerBattleLeaseClaim> {
    return claimTowerBattleLeases(input, deps);
}

/** Release only leases still owned by this exact Tower run. */
export async function releaseTowerBattleLeases(
    runId: string,
    membersInput: readonly string[],
    deps: TowerBattleLeaseDeps = {},
): Promise<void> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const members = normalizedMembers(membersInput);
    await underMemberLocks(members, lock, async () => {
        for (const member of members) {
            const observed = await kv.get<unknown>(battleLockKey(member));
            if (matchingTowerLease(observed, runId)) {
                await deleteExactLease(kv, battleLockKey(member), observed);
            }
        }
    });
}

/** AI assists never own a cross-mode combat lease. */
export function towerBattleLeaseMembers(session: TowerSession): string[] {
    return normalizedMembers(session.actors
        .filter(actor => actor.side === 'squad' && actor.ai === false && !!actor.ownerSlug)
        .map(actor => actor.ownerSlug!));
}
