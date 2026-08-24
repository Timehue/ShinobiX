import { isDeepStrictEqual } from 'node:util';
import { kv, type KvLike } from './_storage.js';
import { withKvLock } from './_lock.js';
import { clanRecordKey, safeName } from './_utils.js';
import { REGISTRY_KEY, parsePublicPlayerIndexEntry, publicIndexKey } from './player/_public-index.js';
import { collectTerritorySupply } from './_territory-supply.js';
import {
    releaseTerritory,
    settleExpiredTerritoryBreach,
    TERRITORY_INACTIVE_RELEASE_MS,
    TERRITORY_REWARD_SUSPEND_MS,
    type TerritoryLifecycleRow,
} from './_territory-lifecycle.js';

const TERRITORY_KEY_PREFIX = 'world:territory:';

type LockRunner = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export type TerritoryLifecycleSweepResult = {
    scanned: number;
    breachesRecovered: number;
    breachesReleased: number;
    rewardsSuspended: number;
    rewardsResumed: number;
    inactiveReleased: number;
    missingClanReleased: number;
    errors: string[];
};

function clanMemberNames(clan: Record<string, unknown>): string[] {
    const values: unknown[] = [clan.founderName];
    if (Array.isArray(clan.members)) {
        for (const member of clan.members) {
            values.push(typeof member === 'string' ? member : (member as Record<string, unknown>)?.name);
        }
    }
    return [...new Set(values.map((value) => safeName(String(value ?? ''))).filter(Boolean))];
}

async function compareSetExact(
    store: KvLike,
    key: string,
    before: TerritoryLifecycleRow,
    after: TerritoryLifecycleRow,
): Promise<void> {
    try {
        if (await store.compareSet(key, before, after)) return;
        throw new Error('territory-lifecycle-conflict');
    } catch (error) {
        const recovered = await store.get(key).catch(() => null);
        if (isDeepStrictEqual(recovered, after)) return;
        throw error;
    }
}

/**
 * Finalizes breach deadlines and enforces the 14/30-day inactivity lifecycle.
 * Inactivity never acts on partial registry data: every roster member must have
 * a credible lastSeen value or the sector is left untouched (fail-safe).
 */
export async function runTerritoryLifecycleSweep(
    options: { store?: KvLike; lock?: LockRunner; now?: number } = {},
): Promise<TerritoryLifecycleSweepResult> {
    const store = options.store ?? kv;
    const lock = options.lock ?? ((key, fn) => withKvLock(key, fn, { failClosed: true }));
    const now = options.now ?? Date.now();
    const result: TerritoryLifecycleSweepResult = {
        scanned: 0,
        breachesRecovered: 0,
        breachesReleased: 0,
        rewardsSuspended: 0,
        rewardsResumed: 0,
        inactiveReleased: 0,
        missingClanReleased: 0,
        errors: [],
    };
    const [keys, rawRegistry] = await Promise.all([
        store.keys(`${TERRITORY_KEY_PREFIX}*`),
        store.hgetall<Record<string, unknown>>(REGISTRY_KEY).catch(() => null),
    ]);
    const registry = rawRegistry ?? {};

    for (const key of keys) {
        result.scanned += 1;
        try {
            await lock(key, async () => {
                const before = await store.get<TerritoryLifecycleRow>(key);
                if (!before) return;
                let row = before;
                const breach = settleExpiredTerritoryBreach(row, now);
                if (breach.changed) {
                    row = breach.row;
                    if (breach.outcome === 'released') result.breachesReleased += 1;
                    if (breach.outcome === 'recovered') result.breachesRecovered += 1;
                }

                const ownerClan = String(row.ownerClan ?? '').trim();
                if (!ownerClan) {
                    if (breach.changed) await compareSetExact(store, key, before, row);
                    return;
                }
                const clan = await store.get<Record<string, unknown>>(clanRecordKey(ownerClan));
                const names = clan ? clanMemberNames(clan) : [];
                if (!clan || names.length === 0) {
                    row = releaseTerritory(row, now, 'clan-missing');
                    await compareSetExact(store, key, before, row);
                    result.missingClanReleased += 1;
                    return;
                }

                // Missing, malformed, or zero timestamps mean the evidence is
                // incomplete. Never evict a clan because an index row failed.
                const lastSeen: number[] = [];
                for (const name of names) {
                    const entry = parsePublicPlayerIndexEntry(registry[publicIndexKey(name)], name);
                    if (!entry || !Number.isFinite(entry.lastSeen) || entry.lastSeen <= 0) return;
                    lastSeen.push(entry.lastSeen);
                }
                const lastActiveAt = Math.max(...lastSeen);
                const idleFor = Math.max(0, now - lastActiveAt);
                if (idleFor >= TERRITORY_INACTIVE_RELEASE_MS) {
                    row = releaseTerritory(row, now, 'clan-inactive');
                    await compareSetExact(store, key, before, row);
                    result.inactiveReleased += 1;
                    return;
                }
                if (idleFor >= TERRITORY_REWARD_SUSPEND_MS) {
                    if (!Number(row.rewardSuspendedAt)) {
                        const suspendedAt = lastActiveAt + TERRITORY_REWARD_SUSPEND_MS;
                        const storedSupply = Math.max(0, Math.floor(Number(row.warSupply) || 0));
                        const banked = Math.max(
                            storedSupply,
                            collectTerritorySupply(row, suspendedAt).collected,
                        );
                        row = {
                            ...row,
                            warSupply: banked,
                            lastSupplyAt: now,
                            rewardSuspendedAt: suspendedAt,
                            inactiveReleaseAt: lastActiveAt + TERRITORY_INACTIVE_RELEASE_MS,
                            updatedAt: now,
                        };
                        result.rewardsSuspended += 1;
                    }
                } else if (Number(row.rewardSuspendedAt)) {
                    row = {
                        ...row,
                        rewardSuspendedAt: undefined,
                        inactiveReleaseAt: undefined,
                        lastSupplyAt: now,
                        updatedAt: now,
                    };
                    result.rewardsResumed += 1;
                }
                if (!isDeepStrictEqual(before, row)) await compareSetExact(store, key, before, row);
            });
        } catch (error) {
            result.errors.push(`${key}:${(error as Error).message}`);
        }
    }
    return result;
}
