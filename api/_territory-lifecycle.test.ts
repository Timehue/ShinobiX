import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from './_storage.js';
import { clanRecordKey } from './_utils.js';
import { runTerritoryLifecycleSweep } from './_territory-lifecycle-store.js';
import {
    beginTerritoryBreach,
    settleExpiredTerritoryBreach,
    TERRITORY_BREACH_DURATION_MS,
    TERRITORY_INACTIVE_RELEASE_MS,
    TERRITORY_REWARD_SUSPEND_MS,
} from './_territory-lifecycle.js';

const NOW = Date.UTC(2026, 7, 22, 12);
const passLock = async <T>(_key: string, fn: () => Promise<T>) => fn();

function owned(overrides: Record<string, unknown> = {}) {
    return {
        sector: 40,
        ownerClan: 'Storm Clan',
        ownerVillage: 'Stormveil Village',
        controlScore: 75_000,
        hp: 20_000,
        terrainBuffStat: 'ninjutsuOffense',
        guards: ['Alice'],
        warSupply: 0,
        lastSupplyAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

describe('territory breach lifecycle', () => {
    it('uses one fixed 12-hour deadline across repeated breaches', () => {
        const first = beginTerritoryBreach(owned(), NOW, 300);
        const second = beginTerritoryBreach({ ...first, hp: 1_000 }, NOW + 60_000, 300);
        assert.equal(first.breachEndsAt, NOW + TERRITORY_BREACH_DURATION_MS);
        assert.equal(second.breachedAt, NOW);
        assert.equal(second.breachEndsAt, first.breachEndsAt);
    });

    it('retains ownership if repaired at expiry and releases if still at zero', () => {
        const breached = beginTerritoryBreach(owned(), NOW);
        const repaired = settleExpiredTerritoryBreach(
            { ...breached, hp: 1_000 },
            NOW + TERRITORY_BREACH_DURATION_MS,
        );
        assert.equal(repaired.outcome, 'recovered');
        assert.equal(repaired.row.ownerClan, 'Storm Clan');
        assert.equal(repaired.row.breachedAt, undefined);

        const lost = settleExpiredTerritoryBreach(breached, NOW + TERRITORY_BREACH_DURATION_MS);
        assert.equal(lost.outcome, 'released');
        assert.equal(lost.row.ownerClan, undefined);
        assert.equal(lost.row.ownerVillage, 'Stormveil Village');
        assert.equal(lost.row.controlScore, 0);
        assert.equal(lost.row.rebuiltAt, NOW + TERRITORY_BREACH_DURATION_MS);
    });

    it('never erases already-banked supply when a dormant sector is breached', () => {
        const breached = beginTerritoryBreach(owned({
            warSupply: 400,
            rewardSuspendedAt: NOW - 1,
        }), NOW, 0);
        assert.equal(breached.warSupply, 400);
    });
});

describe('territory inactivity sweep', () => {
    async function seed(lastSeenByName: Record<string, number | undefined>) {
        const store = _makeMemoryKv();
        await store.set(clanRecordKey('Storm Clan'), {
            name: 'Storm Clan',
            founderName: 'Alice',
            members: [{ name: 'Alice' }, { name: 'Bob' }],
        });
        await store.set('world:territory:40', owned({ lastSupplyAt: NOW - 20 * 24 * 60 * 60 * 1_000 }));
        for (const [name, lastSeen] of Object.entries(lastSeenByName)) {
            await store.hset('player:registry', { [name.toLowerCase()]: { name, lastSeen } });
        }
        return store;
    }

    it('suspends after 14 verified idle days and releases after 30', async () => {
        const lastSeen = NOW - TERRITORY_REWARD_SUSPEND_MS - 1;
        const store = await seed({ Alice: lastSeen, Bob: lastSeen });
        const suspended = await runTerritoryLifecycleSweep({ store, lock: passLock, now: NOW });
        assert.equal(suspended.rewardsSuspended, 1);
        const row = await store.get<Record<string, unknown>>('world:territory:40');
        assert.equal(row?.rewardSuspendedAt, lastSeen + TERRITORY_REWARD_SUSPEND_MS);
        assert.ok(Number(row?.warSupply) > 0, 'pre-suspension supply is banked, not erased');

        const released = await runTerritoryLifecycleSweep({
            store,
            lock: passLock,
            now: lastSeen + TERRITORY_INACTIVE_RELEASE_MS,
        });
        assert.equal(released.inactiveReleased, 1);
        assert.equal((await store.get<Record<string, unknown>>('world:territory:40'))?.ownerClan, undefined);
    });

    it('fails safe when any roster member lacks credible activity data', async () => {
        const store = await seed({ Alice: NOW - TERRITORY_INACTIVE_RELEASE_MS - 1 });
        const out = await runTerritoryLifecycleSweep({ store, lock: passLock, now: NOW });
        assert.equal(out.rewardsSuspended, 0);
        assert.equal(out.inactiveReleased, 0);
        assert.equal((await store.get<Record<string, unknown>>('world:territory:40'))?.ownerClan, 'Storm Clan');
    });

    it('never erases banked supply when dormancy begins during a breach', async () => {
        const lastSeen = NOW - TERRITORY_REWARD_SUSPEND_MS - 1;
        const store = await seed({ Alice: lastSeen, Bob: lastSeen });
        await store.set('world:territory:40', owned({
            hp: 0,
            warSupply: 400,
            breachedAt: NOW - 60_000,
            breachEndsAt: NOW + 60_000,
        }));
        const out = await runTerritoryLifecycleSweep({ store, lock: passLock, now: NOW });
        assert.equal(out.rewardsSuspended, 1);
        assert.equal((await store.get<Record<string, unknown>>('world:territory:40'))?.warSupply, 400);
    });

    it('resumes without retroactive supply catch-up when a member returns', async () => {
        const store = await seed({ Alice: NOW, Bob: NOW });
        await store.set('world:territory:40', owned({
            warSupply: 600,
            lastSupplyAt: NOW - 10_000,
            rewardSuspendedAt: NOW - 24 * 60 * 60 * 1_000,
            inactiveReleaseAt: NOW + 10 * 24 * 60 * 60 * 1_000,
        }));
        const out = await runTerritoryLifecycleSweep({ store, lock: passLock, now: NOW });
        assert.equal(out.rewardsResumed, 1);
        const row = await store.get<Record<string, unknown>>('world:territory:40');
        assert.equal(row?.warSupply, 600);
        assert.equal(row?.lastSupplyAt, NOW);
        assert.equal(row?.rewardSuspendedAt, undefined);
    });
});
