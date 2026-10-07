import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    consumeRunToken,
    storeRunToken,
    bumpDailyStartCount,
    settleFloorForMember,
    settleAssistForAlly,
    settleConsumedItemsForMember,
    floorPaidKey,
    firstClearKey,
    consumedItemsKey,
    assistCountKey,
    assistPaidKey,
    type RunTokenData,
    MAX_ASSISTS_PER_DAY,
    isPublicTowerRun,
    settleTowerBossGearDrop,
} from './_tower-store.js';
import { gearDropHit } from '../_gear-drop-settlement.js';
import { computeFloorReward, computeFloorClearScore } from './_tower-rewards.js';
import { getFloor, type TowerFloor } from './_floor-catalog.js';
import type { TowerSession, TowerActor } from './_tower-session.js';
import { kv } from '../_storage.js';

// Member saves commit through mutatePlayerSave on the GLOBAL kv, so the whole
// suite runs on its in-memory backend (chosen on first use, so setting the
// flag here is in time despite the hoisted imports). The run-side records use
// the store's default deps, which are that same kv and the real lock.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

const NOW = 1_700_000_000_000;
const now = () => NOW;
const deps = { now };
const ASSIST_DAY = '2023-11-14';

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

// Floor 1 (catalog "Foothold") = { ryo: 400, xp: 150 }. settle resolves the floor from the
// catalog by session.floor, so tests use a real catalog floor id (never a client floor).
const F1 = getFloor(1)!;

function squadActor(slug: string): TowerActor {
    return {
        id: 'sq-0', side: 'squad', name: 'A', ownerSlug: slug, ai: false,
        hp: 800, maxHp: 1000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
    };
}
function makeSession(runId: string, floorId: number, memberSlug: string, over: Partial<TowerSession> = {}): TowerSession {
    return {
        towerId: 'celestial', runId, floor: floorId, seed: 1, partySize: 1,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [squadActor(memberSlug)],
        turnQueue: [], activeIndex: 0, round: 3, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: true, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner: 'squad', recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: 0, lastActionAt: 0, ...over,
    };
}
async function seedSave(slug: string, char: Json = {}, record: Json = {}) {
    await kv.set(`save:${slug}`, {
        ...record,
        character: { level: 30, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0, maxHp: 1000, maxChakra: 100, maxStamina: 100, stats: {}, unspentStats: 0, ...char },
    });
}
/** A save whose regeneration cursor is 30 s old: one point per second in each 100-point pool. */
async function seedTiredSave(slug: string, char: Json = {}) {
    const at = Date.now() - 30_000;
    await seedSave(slug, { hp: 10, maxHp: 100, chakra: 20, stamina: 0, ...char }, { _saveAt: at, _regenAt: at });
}
const charOf = async (slug: string) => ((await kv.get<Json>(`save:${slug}`))!).character as Json;
const has = async (key: string) => (await kv.get(key)) !== null;

function assertRecovered(character: Json, where: string) {
    assert.ok(Number(character.hp) >= 40, `${where}: hp ${character.hp} lost the idle recovery`);
    assert.ok(Number(character.chakra) >= 50, `${where}: chakra ${character.chakra} lost the idle recovery`);
    assert.ok(Number(character.stamina) >= 30, `${where}: stamina ${character.stamina} lost the idle recovery`);
}

/** Replace kv.compareSet for the saves while `run` executes. */
async function withSaveWrites<T>(write: (original: typeof kv.compareSet, ...args: Parameters<typeof kv.compareSet>) => ReturnType<typeof kv.compareSet>, run: () => Promise<T>): Promise<T> {
    const original = kv.compareSet;
    kv.compareSet = (key, expected, value, options) => key.startsWith('save:')
        ? write(original, key, expected, value, options)
        : original.call(kv, key, expected, value, options);
    try {
        return await run();
    } finally {
        kv.compareSet = original;
    }
}

describe('Battle Towers reward computation', () => {
    it('reward is the SEALED floor reward (cloned), never a client input', () => {
        const r = computeFloorReward(F1);
        assert.deepEqual(r, { ryo: 400, xp: 150 });
        r.ryo = 999999;
        assert.equal(F1.firstClearReward.ryo, 400);
    });
    it('Floor Clear Score rewards speed, survival, and no deaths', () => {
        const f: TowerFloor = { ...F1, roundBudget: 10 };
        const fast = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const slow = computeFloorClearScore({ roundsUsed: 10, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const hurt = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 100, squadHpMax: 1000, deaths: 0 }, f);
        const died = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 1 }, f);
        assert.ok(fast > slow && fast > hurt && fast > died && fast > 0);
    });
});

describe('Battle Towers run token (single-use, atomic)', { concurrency: false }, () => {
    it('mints, consumes once, refuses a second consume (del-gated)', async () => {
        const data: RunTokenData = { host: 'host', members: ['host', 'a'], seed: 1, floor: 5, partySize: 2, mintedAt: NOW };
        await storeRunToken('tok1', data, deps);
        assert.deepEqual(await consumeRunToken('host', 'tok1', deps), data);
        assert.equal(await consumeRunToken('host', 'tok1', deps), null);
    });
    it('daily start counter increments atomically', async () => {
        assert.equal(await bumpDailyStartCount('host', deps), 1);
        assert.equal(await bumpDailyStartCount('host', deps), 2);
    });
});

describe('Battle Towers per-member settlement (server-authoritative, idempotent)', { concurrency: false }, () => {
    it('credits the sealed floor reward + score once', async () => {
        await seedSave('alice', { ryo: 50, village: 'Frostfang Village' });
        const res = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, deps);
        assert.equal(res.paid, true);
        const c = await charOf('alice');
        assert.equal(c.ryo, 450, 'ryo += sealed 400');
        assert.equal(c.battleTowerBestFloor, 1);
        assert.deepEqual(c.elderWinDays, [{ day: new Date(NOW).toISOString().slice(0, 10), village: 'frostfangvillage', pvp: 0, pve: 1 }]);
        assert.equal(c.battleTowerRating, res.score);
        assert.ok((res.score ?? 0) > 0);
        assert.deepEqual(c.battleTowerClearedFloors, [1]);
        assert.ok(await has(firstClearKey('alice', 1)), 'permanent first-clear receipt placed');
    });

    it('a second settle of the SAME run pays nothing (per-run NX receipt)', async () => {
        await seedSave('alice', { village: 'Frostfang Village' });
        await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, deps);
        const ryo1 = (await charOf('alice')).ryo;
        const res2 = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, deps);
        assert.equal(res2.reason, 'already-paid');
        assert.equal((await charOf('alice')).ryo, ryo1);
        assert.equal(((await charOf('alice')).elderWinDays as Array<{ pve: number }>)[0]!.pve, 1);
    });

    it('the one-time gate is FORGERY-PROOF: emptying the client cleared-array does NOT re-pay (C1)', async () => {
        await seedSave('alice');
        await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, deps);
        const after1 = await charOf('alice');
        // simulate the C1 exploit: client POSTs a save that empties the cleared/claimed arrays
        const forged = (await kv.get<Json>('save:alice'))!;
        await kv.set('save:alice', { ...forged, character: { ...after1, battleTowerClearedFloors: [], battleTowerClaimedRewards: [] } });
        // re-run a NEW run for the same floor — the PERMANENT server receipt still blocks it
        const res3 = await settleFloorForMember({ session: makeSession('run2', 1, 'alice'), slug: 'alice' }, deps);
        assert.equal(res3.paid, false);
        assert.equal(res3.reason, 'already-first-cleared');
        assert.equal((await charOf('alice')).ryo, after1.ryo, 'no extra ryo despite the forged array');
        assert.equal((await charOf('alice')).battleTowerRating, after1.battleTowerRating, 'rating not re-added');
    });

    it('rejects an un-cleared session, a non-member, and an unknown floor', async () => {
        await seedSave('alice');
        const active = await settleFloorForMember({ session: makeSession('r', 1, 'alice', { status: 'active', winner: null }), slug: 'alice' }, deps);
        assert.equal(active.reason, 'not-cleared');
        const nonMember = await settleFloorForMember({ session: makeSession('r', 1, 'alice'), slug: 'mallory' }, deps);
        assert.equal(nonMember.reason, 'not-a-member');
        const badFloor = await settleFloorForMember({ session: makeSession('r', 999, 'alice'), slug: 'alice' }, deps);
        assert.equal(badFloor.reason, 'no-floor');
    });

    it('lock contention pays nothing AND leaves no receipts (clean retry)', async () => {
        await seedSave('alice');
        await kv.set('lock:save:alice', 'another-holder', { nx: true, ex: 30 });
        const res = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, deps);
        assert.equal(res.reason, 'contended');
        assert.equal(await has(floorPaidKey('run1', 1, 'alice')), false);
        assert.equal(await has(firstClearKey('alice', 1)), false);
        await kv.del('lock:save:alice');
        const retry = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, deps);
        assert.equal(retry.paid, true);
    });

    it('a lost compare-and-set re-runs once on the fresh save and pays the clear once', async () => {
        await seedSave('alice', { ryo: 50 });
        let raced = false;
        const res = await withSaveWrites(async (original, key, expected, value, options) => {
            if (!raced) {
                // Another writer commits between this settle's read and its write.
                raced = true;
                const current = (await kv.get<Json>(key))!;
                await kv.set(key, { ...current, _saveVersion: Number(current._saveVersion ?? 0) + 1, character: { ...(current.character as Json), boneCharms: 7 } });
            }
            return original.call(kv, key, expected, value, options);
        }, () => settleFloorForMember({ session: makeSession('race-run', 1, 'alice'), slug: 'alice' }, deps));
        assert.ok(raced);
        assert.equal(res.paid, true);
        const c = await charOf('alice');
        assert.equal(c.boneCharms, 7, "the other writer's commit survives");
        assert.equal(c.ryo, 450, 'the sealed 400 is paid once');
        assert.ok(await has(floorPaidKey('race-run', 1, 'alice')));
    });

    it('a write that did not land publishes no receipt, so the retry pays', async () => {
        await seedSave('alice', { ryo: 50 });
        const res = await withSaveWrites(async () => { throw new Error('storage-down'); },
            () => settleFloorForMember({ session: makeSession('down-run', 1, 'alice'), slug: 'alice' }, deps));
        assert.equal(res.reason, 'contended');
        assert.equal(await has(floorPaidKey('down-run', 1, 'alice')), false);
        assert.equal(await has(firstClearKey('alice', 1)), false);
        assert.equal((await charOf('alice')).ryo, 50);
        const retry = await settleFloorForMember({ session: makeSession('down-run', 1, 'alice'), slug: 'alice' }, deps);
        assert.equal(retry.paid, true);
        assert.equal((await charOf('alice')).ryo, 450);
    });

    it('a member who is still battle-locked gets no idle recovery, exactly as before', async () => {
        // A human member settles while the run's battle lease is still held, and
        // a fight's time is not idle time.
        await seedTiredSave('alice');
        await kv.set('battle-lock:alice', { battleId: 'run1' });
        await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, deps);
        const c = await charOf('alice');
        assert.equal(c.hp, 10);
        assert.equal(c.chakra, 20);
        assert.equal(c.stamina, 0);
    });

    it('deducts server-recorded consumables exactly once from stacks then legacy inventory', async () => {
        await seedSave('alice', {
            itemStacks: [
                { itemId: 'kunai', count: 2 },
                { itemId: 'pot', count: 1 },
            ],
            inventory: ['kunai', 'pill', 'pill'],
        });
        const actor = squadActor('alice');
        actor.itemsUsed = { kunai: 3, pill: 1, pot: 1 };
        const session = makeSession('run-items', 1, 'alice', { actors: [actor] });

        const res = await settleConsumedItemsForMember({ session, slug: 'alice' }, deps);
        assert.equal(res.consumed, true);
        assert.deepEqual((await charOf('alice')).itemStacks, []);
        assert.deepEqual((await charOf('alice')).inventory, ['pill']);
        assert.ok(await has(consumedItemsKey('run-items', 'alice')));

        const again = await settleConsumedItemsForMember({ session, slug: 'alice' }, deps);
        assert.equal(again.reason, 'already-consumed');
        assert.deepEqual((await charOf('alice')).inventory, ['pill'], 'retry did not double-deduct');
    });

    it('deducts used consumables after a wipe without paying floor rewards', async () => {
        await seedSave('alice', {
            itemStacks: [{ itemId: 'smoke', count: 1 }],
            inventory: ['kunai'],
        });
        const actor = squadActor('alice');
        actor.itemsUsed = { smoke: 1, kunai: 1 };
        const session = makeSession('run-wipe-items', 1, 'alice', {
            actors: [actor],
            winner: 'enemy',
            objectiveState: { kind: 'defeat-all', completed: false, failed: true },
        });

        const consumed = await settleConsumedItemsForMember({ session, slug: 'alice' }, deps);
        assert.equal(consumed.consumed, true);
        assert.deepEqual((await charOf('alice')).itemStacks, []);
        assert.deepEqual((await charOf('alice')).inventory, []);

        const reward = await settleFloorForMember({ session, slug: 'alice' }, deps);
        assert.equal(reward.paid, false);
        assert.equal(reward.reason, 'not-cleared');
        assert.equal((await charOf('alice')).ryo, 0, 'wipe consumed items but paid no clear reward');
    });

    it('does not finalize consumable spends before the run is done', async () => {
        await seedSave('alice', { itemStacks: [{ itemId: 'smoke', count: 1 }] });
        const actor = squadActor('alice');
        actor.itemsUsed = { smoke: 1 };
        const session = makeSession('run-active-items', 1, 'alice', {
            actors: [actor],
            status: 'active',
            winner: null,
        });

        const consumed = await settleConsumedItemsForMember({ session, slug: 'alice' }, deps);
        assert.equal(consumed.consumed, false);
        assert.equal(consumed.reason, 'not-done');
        assert.deepEqual((await charOf('alice')).itemStacks, [{ itemId: 'smoke', count: 1 }]);
        assert.equal(await has(consumedItemsKey('run-active-items', 'alice')), false);
    });

    it('a consumable settle outside a battle lock keeps the recovery since the last save', async () => {
        // A lapsed run, a caravan fight or a clan boss assault settles items with
        // no lease held. A raw version bump threw that recovery away.
        await seedTiredSave('alice', { itemStacks: [{ itemId: 'smoke', count: 2 }] });
        const actor = squadActor('alice');
        actor.itemsUsed = { smoke: 1 };
        const res = await settleConsumedItemsForMember({ session: makeSession('run-tired', 1, 'alice', { actors: [actor] }), slug: 'alice' }, deps);
        assert.equal(res.consumed, true);
        const c = await charOf('alice');
        assert.deepEqual(c.itemStacks, [{ itemId: 'smoke', count: 1 }]);
        assertRecovered(c, 'committed save');
    });
});

describe('Battle Towers borrowed-ally assist (capped, once per run)', { concurrency: false }, () => {
    it('pays a capped fraction once per run', async () => {
        await seedSave('ally');
        const res = await settleAssistForAlly({ session: makeSession('run1', 1, 'ally'), slug: 'ally' }, deps);
        assert.equal(res.paid, true);
        // 25% of sealed 400 ryo, plus the assist's old XP share folded to ryo
        // at ~0.75:1 (25% of 150 xp → 37 → floor(37 × 0.75) = 27).
        assert.equal((await charOf('ally')).ryo, 100 + 27);
        const again = await settleAssistForAlly({ session: makeSession('run1', 1, 'ally'), slug: 'ally' }, deps);
        assert.equal(again.reason, 'assist-already-paid');
    });

    it('enforces the daily assist cap and does NOT burn the per-run receipt', async () => {
        await seedSave('ally');
        await kv.set(assistCountKey('ally', ASSIST_DAY), MAX_ASSISTS_PER_DAY);
        const res = await settleAssistForAlly({ session: makeSession('runX', 1, 'ally'), slug: 'ally' }, deps);
        assert.equal(res.reason, 'assist-daily-cap');
        assert.equal(await has('tower-assist-paid:runX:ally'), false, 'denied cap rolls back the receipt');
    });

    it('a lent ally keeps the recovery earned since their last save', async () => {
        // The ally is offline and in no battle, yet the raw assist write fenced
        // their regeneration cursor and erased that recovery.
        await seedTiredSave('ally');
        const res = await settleAssistForAlly({ session: makeSession('run-lent', 1, 'ally'), slug: 'ally' }, deps);
        assert.equal(res.paid, true);
        assertRecovered(await charOf('ally'), 'committed save');
    });

    it('a lost compare-and-set gives the day\'s slot back before the retry takes it again', async () => {
        await seedSave('ally');
        let lost = false;
        const res = await withSaveWrites(async (original, key, expected, value, options) => {
            if (!lost) { lost = true; return false; }
            return original.call(kv, key, expected, value, options);
        }, () => settleAssistForAlly({ session: makeSession('run-cas', 1, 'ally'), slug: 'ally' }, deps));
        assert.ok(lost);
        assert.equal(res.paid, true);
        assert.equal(await kv.get(assistCountKey('ally', ASSIST_DAY)), 1, 'one assist, one slot');
        assert.equal((await charOf('ally')).ryo, 127);
        assert.ok(await has(assistPaidKey('run-cas', 'ally')));
    });

    it('a write that did not land gives the slot back; one that may have landed keeps it', async () => {
        await seedSave('ally');
        const missed = await withSaveWrites(async () => { throw new Error('storage-down'); },
            () => settleAssistForAlly({ session: makeSession('run-down', 1, 'ally'), slug: 'ally' }, deps));
        assert.equal(missed.reason, 'contended');
        assert.equal(await kv.get(assistCountKey('ally', ASSIST_DAY)), 0, 'the claim is absent, so the slot is released');
        assert.equal(await has(assistPaidKey('run-down', 'ally')), false);

        // Same failure, but the save read that would prove the miss fails too.
        const originalGet = kv.get;
        let saveReads = 0;
        const inconclusive = await withSaveWrites(async () => { throw new Error('storage-down'); }, async () => {
            kv.get = (async (key: string) => {
                // The first read is mutatePlayerSave's own; anything after the
                // failed write is the verdict, and it is inconclusive.
                if (key === 'save:ally' && ++saveReads > 1) throw new Error('read-timeout');
                return originalGet.call(kv, key);
            }) as typeof kv.get;
            try {
                return await settleAssistForAlly({ session: makeSession('run-unknown', 1, 'ally'), slug: 'ally' }, deps);
            } finally {
                kv.get = originalGet;
            }
        });
        assert.equal(inconclusive.reason, 'contended');
        assert.equal(await kv.get(assistCountKey('ally', ASSIST_DAY)), 1, 'an inconclusive read fails closed and keeps the slot');

        const paid = await settleAssistForAlly({ session: makeSession('run-down', 1, 'ally'), slug: 'ally' }, deps);
        assert.equal(paid.paid, true);
        assert.equal((await charOf('ally')).ryo, 127);
    });

    it('a lost reply after the save committed is recognised as paid, keeping its slot', async () => {
        await seedSave('ally');
        const res = await withSaveWrites(async (original, key, expected, value, options) => {
            await original.call(kv, key, expected, value, options);
            throw new Error('reply lost');
        }, () => settleAssistForAlly({ session: makeSession('run-fwd', 1, 'ally'), slug: 'ally' }, deps));
        assert.equal(res.paid, true);
        assert.equal(await kv.get(assistCountKey('ally', ASSIST_DAY)), 1);
        assert.equal((await charOf('ally')).ryo, 127);
        const again = await settleAssistForAlly({ session: makeSession('run-fwd', 1, 'ally'), slug: 'ally' }, deps);
        assert.equal(again.reason, 'assist-already-paid');
        assert.equal(await kv.get(assistCountKey('ally', ASSIST_DAY)), 1);
    });
});

describe('the tower reward channels pay CATALOG floors only', { concurrency: false }, () => {
    // Regression: before the Solo-PvE cutover, non-Tower modes embedded a
    // synthetic floor in a Tower session under a reserved id outside the
    // catalog. floorForSession preferred that embedded floor, so those legacy
    // runs reached the tower payout path — and each was a genuinely won,
    // member-owned TowerSession, so no other check refused them.
    //
    // They paid no currency (a dynamic floor's firstClearReward is {}), but the
    // clear still wrote battleTowerBestFloor / battleTowerRating, which are
    // PUBLIC leaderboard fields. Finish any mission, POST its runId to
    // /api/towers/settle, and your public tower standing was whatever you liked.
    const dynamicFloor = (id: number): TowerFloor => ({
        id,
        name: 'academy-spar',
        biome: 'central',
        objective: 'defeat-boss',
        roundBudget: 24,
        map: { width: 12, height: 10 },
        fieldRule: { kind: 'none' },
        enemies: [],
        boss: { aiId: 'academy-spar-dummy' },
        balanceFor: 1,
        firstClearReward: {},
    } as unknown as TowerFloor);

    function dynamicRun(runId: string, slug: string, floorId: number) {
        return makeSession(runId, floorId, slug, { encounterFloor: dynamicFloor(floorId) });
    }

    it('refuses a first-clear settle for an embedded, non-catalog floor', async () => {
        await seedSave('cheat');
        const res = await settleFloorForMember({ session: dynamicRun('spar-1', 'cheat', 9_250), slug: 'cheat' }, deps);
        assert.equal(res.paid, false);
        assert.equal(res.reason, 'not-a-catalog-floor');
    });

    it('writes NOTHING to the public tower standing', async () => {
        await seedSave('cheat', { battleTowerBestFloor: 3, battleTowerRating: 120 });
        await settleFloorForMember({ session: dynamicRun('spar-2', 'cheat', 9_250), slug: 'cheat' }, deps);
        const char = await charOf('cheat');
        assert.equal(char.battleTowerBestFloor, 3, 'a mission/spar run must not become your best tower floor');
        assert.equal(char.battleTowerRating, 120, 'nor add to the all-time rating');
        assert.equal(char.battleTowerClearedFloors, undefined, 'nor push a phantom cleared floor');
        assert.equal(await has(firstClearKey('cheat', 9_250)), false, 'and must not burn a PERMANENT first-clear receipt');
    });

    it('covers every id the solo modes reserve, not just the spar', async () => {
        // combat missions 9_100+, Anbu 9_101, story 9_200+, weekly boss 9_200,
        // the spar 9_250, generic AI fights 9_300.
        for (const id of [9_100, 9_101, 9_200, 9_208, 9_250, 9_300]) {
            await seedSave('cheat');
            const res = await settleFloorForMember({ session: dynamicRun(`run-${id}`, 'cheat', id), slug: 'cheat' }, deps);
            assert.equal(res.reason, 'not-a-catalog-floor', `floor ${id} still reaches the tower payout`);
        }
    });

    it('refuses the assist channel too, so it cannot burn a daily assist slot', async () => {
        await seedSave('ally');
        const res = await settleAssistForAlly({ session: dynamicRun('spar-3', 'ally', 9_250), slug: 'ally' }, deps);
        assert.equal(res.paid, false);
        assert.equal(res.reason, 'not-a-catalog-floor');
        assert.equal(await has(assistCountKey('ally', ASSIST_DAY)), false, 'the day\'s assist count must be untouched');
    });

    it('a REAL tower floor still settles — the guard must not close the tower itself', async () => {
        // The unguarded precondition: if this ever stops paying, the two tests
        // above are passing for the wrong reason.
        await seedSave('climber');
        const res = await settleFloorForMember({ session: makeSession('tower-1', 1, 'climber'), slug: 'climber' }, deps);
        assert.equal(res.paid, true, 'floor 1 is a catalog floor and must still pay');
        assert.equal((await charOf('climber')).battleTowerBestFloor, 1);
    });

    it('rejects embedded floors even when they reuse a public catalog id', async () => {
        await seedSave('climber');
        const session = makeSession('tower-2', 1, 'climber', { encounterFloor: getFloor(1)! });
        const res = await settleFloorForMember({ session, slug: 'climber' }, deps);
        assert.equal(res.reason, 'not-a-catalog-floor');
        assert.equal(isPublicTowerRun(session), false);
    });
});

describe('Battle Towers boss gear drop', { concurrency: false }, () => {
    const BOSS_FLOOR = 5;
    const runWhere = (slug: string, hit: boolean) => {
        for (let i = 0; i < 5000; i += 1) if (gearDropHit(`tower:boss-run-${i}:${slug}`, 500) === hit) return `boss-run-${i}`;
        throw new Error('no run id found');
    };

    it('uses a floor that really has a boss', () => {
        assert.ok(getFloor(BOSS_FLOOR)?.boss);
        assert.ok(!getFloor(1)?.boss);
    });

    it('drops one step item on a boss floor win, and a retry adds nothing more', async () => {
        await seedSave('dana', { inventory: ['kept'] });
        const session = makeSession(runWhere('dana', true), BOSS_FLOOR, 'dana');
        const first = await settleTowerBossGearDrop(session, 'dana');
        assert.match(first.itemId ?? '', /-s[1-5]$/);
        assert.deepEqual((await charOf('dana')).inventory, ['kept', first.itemId]);
        assert.deepEqual(await settleTowerBossGearDrop(session, 'dana'), {});
        assert.deepEqual((await charOf('dana')).inventory, ['kept', first.itemId]);
    });

    it('does not drop when the run did not hit', async () => {
        await seedSave('erin', { inventory: ['kept'] });
        assert.deepEqual(await settleTowerBossGearDrop(makeSession(runWhere('erin', false), BOSS_FLOOR, 'erin'), 'erin'), {});
        assert.deepEqual((await charOf('erin')).inventory, ['kept']);
    });

    it('never drops on an ordinary floor, a lost run, or for a non member', async () => {
        await seedSave('fay', { inventory: ['kept'] });
        const runId = runWhere('fay', true);
        assert.deepEqual(await settleTowerBossGearDrop(makeSession(runId, 1, 'fay'), 'fay'), {});
        assert.deepEqual(await settleTowerBossGearDrop(makeSession(runId, BOSS_FLOOR, 'fay', { winner: 'enemy' }), 'fay'), {});
        assert.deepEqual(await settleTowerBossGearDrop(makeSession(runId, BOSS_FLOOR, 'someoneelse'), 'fay'), {});
        assert.deepEqual((await charOf('fay')).inventory, ['kept']);
    });
});
