/**
 * Endless Spire settlement (settleSpireForMember in api/towers/_tower-store.ts):
 * best-tier-per-week, server-authoritative.
 *
 * Each member's clear commits through mutatePlayerSave, so these run against
 * the global in-memory KV it uses (chosen on first use, so setting the flag
 * here is in time despite the hoisted imports). The pure Spire catalog,
 * modifier and engine tests are in _spire.test.ts.
 */
import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { getSpireFloor } from './_spire-catalog.js';
import {
    settleSpireForMember, isSpireRun, floorPaidKey, spireRewardKey, spireLbKey, SPIRE_SHARDS_PER_TIER,
    type SpireBoardEntry,
} from './_tower-store.js';
import { weekKey } from '../missions/_weekly-board.js';
import type { TowerSession, TowerActor } from './_tower-session.js';
import { kv } from '../_storage.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

const NOW = 1_700_000_000_000;
const now = () => NOW;
const deps = { now };

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

function spireSquadActor(slug: string): TowerActor {
    return {
        id: 'sq-0', side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 900, maxHp: 10000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
    };
}
function spireSession(runId: string, tier: number, slug: string): TowerSession {
    return {
        towerId: 'endless-spire', runId, floor: tier, seed: 1, partySize: 1, ascensionTier: tier, spireBossId: 'sovereign',
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [spireSquadActor(slug)],
        turnQueue: [], activeIndex: 0, round: 5, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-boss', completed: true, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner: 'squad', recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: 0, lastActionAt: 0,
    };
}
async function seedSave(slug: string, char: Json = {}) {
    await kv.set(`save:${slug}`, { character: { level: 100, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0, maxHp: 10000, stats: {}, ...char } });
}
const charOf = async (slug: string) => ((await kv.get<Json>(`save:${slug}`))!).character as Json;
const has = async (key: string) => (await kv.get(key)) !== null;
const board = async () => (await kv.get<SpireBoardEntry[]>(spireLbKey(weekKey(NOW))))!;

describe('Endless Spire — settleSpireForMember', { concurrency: false }, () => {
    it('pays 2 shards + unlocks the tier + sets the weekly best (first clear this week)', async () => {
        await seedSave('hero');
        const r = await settleSpireForMember({ slug: 'hero', session: spireSession('run1', 8, 'hero') }, deps);
        assert.equal(r.paid, true);
        const c = await charOf('hero');
        assert.equal(c.fateShards, SPIRE_SHARDS_PER_TIER);
        assert.equal(c.battleTowerAscension, 8);           // unlock gate
        assert.equal(c.battleTowerSpireWeeklyBest, 8);     // leaderboard
        assert.equal(c.battleTowerSpireWeekKey, weekKey(NOW));
        assert.ok(await has(spireRewardKey('hero', weekKey(NOW), 8)));
        assert.ok(await has(floorPaidKey('run1', 8, 'hero')));
    });
    it('is idempotent per run (a second settle of the same run pays nothing)', async () => {
        await seedSave('hero');
        const s = spireSession('run1', 8, 'hero');
        await settleSpireForMember({ slug: 'hero', session: s }, deps);
        const second = await settleSpireForMember({ slug: 'hero', session: s }, deps);
        assert.equal(second.paid, false);
        assert.equal(second.reason, 'already-paid');
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER); // not doubled
    });
    it('best-per-week: a DIFFERENT tier this week pays again; the receipt caps a repeat of the SAME tier', async () => {
        await seedSave('hero');
        await settleSpireForMember({ slug: 'hero', session: spireSession('runA', 8, 'hero') }, deps);
        await settleSpireForMember({ slug: 'hero', session: spireSession('runB', 9, 'hero') }, deps);
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER * 2); // 8 + 9 both paid this week
        // re-clearing tier 8 in a NEW run this same week → reward receipt already exists → no shards,
        // but the run still settles (unlock/best are max()).
        const again = await settleSpireForMember({ slug: 'hero', session: spireSession('runC', 8, 'hero') }, deps);
        assert.equal(again.paid, true);
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER * 2); // unchanged — no double-pay for tier 8
    });
    it('reads the SEALED session tier; a non-spire (story) session is not paid here', async () => {
        await seedSave('hero');
        const story = spireSession('run1', 8, 'hero');
        delete (story as { ascensionTier?: number }).ascensionTier; // now a story-shaped session
        const r = await settleSpireForMember({ slug: 'hero', session: story }, deps);
        assert.equal(r.paid, false);
        assert.equal(r.reason, 'not-spire');
    });
    it('requires the Spire tower id, direct tier binding, and no embedded floor', async () => {
        const invalid = [
            spireSession('wrong-id', 8, 'hero'),
            spireSession('wrong-floor', 8, 'hero'),
            spireSession('embedded', 8, 'hero'),
        ];
        invalid[0]!.towerId = 'celestial';
        invalid[1]!.floor = 7;
        invalid[2]!.encounterFloor = getSpireFloor(8);
        for (const session of invalid) {
            await seedSave('hero');
            assert.equal(isSpireRun(session), false);
            const result = await settleSpireForMember({ slug: 'hero', session }, deps);
            assert.equal(result.reason, 'not-spire');
            assert.equal((await charOf('hero')).fateShards, 0);
        }
    });
    it('upserts the weekly leaderboard board (best-per-player, no downgrade)', async () => {
        await seedSave('hero');
        await settleSpireForMember({ slug: 'hero', session: spireSession('runA', 8, 'hero') }, deps);
        let entries = await board();
        assert.ok(Array.isArray(entries) && entries.length === 1);
        assert.equal(entries[0]!.slug, 'hero');
        assert.equal(entries[0]!.tier, 8);
        assert.equal(entries[0]!.level, 100);
        // a HIGHER clear this week raises the board tier
        await settleSpireForMember({ slug: 'hero', session: spireSession('runB', 11, 'hero') }, deps);
        entries = await board();
        assert.equal(entries[0]!.tier, 11);
        // a LOWER re-clear never downgrades the board
        await settleSpireForMember({ slug: 'hero', session: spireSession('runC', 6, 'hero') }, deps);
        entries = await board();
        assert.equal(entries[0]!.tier, 11);
    });
    it('projects only the sealed clear tier, never a character-supplied weekly best', async () => {
        await seedSave('hero', {
            battleTowerSpireWeeklyBest: 20,
            battleTowerSpireWeekKey: weekKey(NOW),
        });
        await settleSpireForMember({ slug: 'hero', session: spireSession('authoritative-tier', 8, 'hero') }, deps);
        assert.equal((await board())[0]!.tier, 8);
    });
    it('recognises a save that committed before its reply was lost, paying the run and weekly tier once', async () => {
        await seedSave('hero');
        const session = spireSession('forwarded-spire', 8, 'hero');
        const original = kv.compareSet;
        let lose = true;
        kv.compareSet = async (key, expected, value, options) => {
            const committed = await original.call(kv, key, expected, value, options);
            if (lose && key === 'save:hero') { lose = false; throw new Error('forwarded save, dropped response'); }
            return committed;
        };
        let first: Awaited<ReturnType<typeof settleSpireForMember>>;
        try {
            first = await settleSpireForMember({ slug: 'hero', session }, deps);
        } finally {
            kv.compareSet = original;
        }
        assert.equal(first.paid, true, 'the read-back recognised the committed write');
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER);
        assert.equal(await has(spireRewardKey('hero', weekKey(NOW), 8)), true);

        const retry = await settleSpireForMember({ slug: 'hero', session }, deps);
        assert.equal(retry.reason, 'already-paid');
        await settleSpireForMember({ slug: 'hero', session: spireSession('new-run-same-tier', 8, 'hero') }, deps);
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER);
    });
    it('repairs a weekly receipt lost after the commit without paying the run or tier twice', async () => {
        await seedSave('hero');
        const session = spireSession('receipt-lost-spire', 8, 'hero');
        const original = kv.set;
        let drop = true;
        kv.set = (async (key: string, value: unknown, options?: Parameters<typeof original>[2]) => {
            if (drop && key.startsWith('tower-spire-reward:')) { drop = false; throw new Error('receipt write lost'); }
            return original.call(kv, key, value, options);
        }) as typeof kv.set;
        let first: Awaited<ReturnType<typeof settleSpireForMember>>;
        try {
            first = await settleSpireForMember({ slug: 'hero', session }, deps);
        } finally {
            kv.set = original;
        }
        assert.equal(first.paid, true);
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER);
        assert.equal(await has(spireRewardKey('hero', weekKey(NOW), 8)), false);

        const retry = await settleSpireForMember({ slug: 'hero', session }, deps);
        assert.equal(retry.reason, 'already-paid');
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER);
        assert.equal(await has(spireRewardKey('hero', weekKey(NOW), 8)), true, 'retry repairs the weekly receipt');

        await settleSpireForMember({ slug: 'hero', session: spireSession('new-run-same-tier', 8, 'hero') }, deps);
        assert.equal((await charOf('hero')).fateShards, SPIRE_SHARDS_PER_TIER);
    });
    it('a lost compare-and-set re-runs once on the fresh save and pays the weekly tier once', async () => {
        await seedSave('hero');
        const original = kv.compareSet;
        let raced = false;
        kv.compareSet = async (key, expected, value, options) => {
            if (!raced && key === 'save:hero') {
                // Another writer commits between this settle's read and its write.
                raced = true;
                const current = (await kv.get<Json>(key))!;
                await kv.set(key, { ...current, _saveVersion: Number(current._saveVersion ?? 0) + 1, character: { ...(current.character as Json), ryo: 777 } });
            }
            return original.call(kv, key, expected, value, options);
        };
        let res: Awaited<ReturnType<typeof settleSpireForMember>>;
        try {
            res = await settleSpireForMember({ slug: 'hero', session: spireSession('race-spire', 8, 'hero') }, deps);
        } finally {
            kv.compareSet = original;
        }
        assert.ok(raced);
        assert.equal(res.paid, true);
        const c = await charOf('hero');
        assert.equal(c.ryo, 777, "the other writer's commit survives");
        assert.equal(c.fateShards, SPIRE_SHARDS_PER_TIER);
        assert.equal((await board())[0]!.tier, 8, 'the board entry is captured once the clear commits');
    });
    it('weekly best RESETS when the reset-week rolls over', async () => {
        // pre-seed a stale weekly best from a previous week
        await seedSave('hero', { battleTowerSpireWeeklyBest: 15, battleTowerSpireWeekKey: 'w0', battleTowerAscension: 15 });
        await settleSpireForMember({ slug: 'hero', session: spireSession('run1', 3, 'hero') }, deps);
        const c = await charOf('hero');
        assert.equal(c.battleTowerSpireWeeklyBest, 3);       // reset to this week's clear, not max(15,3)
        assert.equal(c.battleTowerSpireWeekKey, weekKey(NOW));
        assert.equal(c.battleTowerAscension, 15);            // permanent unlock is NEVER reset (max)
    });
});
