/**
 * Endless Spire ryo purse (2026-10 economy rebalance, owner amendment A7):
 * every cleared tier pays each squad member 1.5 x A(L) per active minute of
 * the run, in the same save write as the clear. The weekly-first rule still
 * governs the Fate Shards only.
 *
 * Runs against the global in-memory KV mutatePlayerSave uses (chosen on first
 * use, so setting the flag here is in time despite the hoisted imports).
 */
import { after, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readSession, settleSpireForMember, SPIRE_SHARDS_PER_TIER, writeSession } from './_tower-store.js';
import type { TowerSession, TowerActor } from './_tower-session.js';
import { kv } from '../_storage.js';
import { drainBackgroundWork } from '../_background-work.js';
import { ECON_TXN_LIST_KEY } from '../_economy.js';
import { ACTIVITY_PURSE_MAX_MINUTES, SPIRE_PURSE_A_MULT } from '../_activity-purse.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

const NOW = 1_700_000_000_000;
const deps = { now: () => NOW };
const MINUTE = 60_000;

beforeEach(async () => {
    await drainBackgroundWork();
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(async () => {
    await drainBackgroundWork();
    delete process.env.SPIRE_PURSE_SCALE;
});

function actor(slug: string): TowerActor {
    return {
        id: 'sq-0', side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 900, maxHp: 10000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
    };
}

function cleared(runId: string, tier: number, slug: string, minutes: number): TowerSession {
    return {
        towerId: 'endless-spire', runId, floor: tier, seed: 1, partySize: 1, ascensionTier: tier, spireBossId: 'sovereign',
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [actor(slug)],
        turnQueue: [], activeIndex: 0, round: 5, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-boss', completed: true, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner: 'squad', recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: NOW - minutes * MINUTE, lastActionAt: NOW - minutes * MINUTE, terminalAt: NOW,
    };
}

async function seed(slug: string, level: number) {
    await kv.set(`save:${slug}`, { character: { level, xp: 0, ryo: 1_000, fateShards: 0, boneCharms: 0, maxHp: 10000, stats: {} } });
}
const charOf = async (slug: string) => ((await kv.get<Json>(`save:${slug}`))!).character as Json;

describe('Endless Spire purse', { concurrency: false }, () => {
    it('pays 1.5 x A(L) per active minute of the cleared tier, with the clear', async () => {
        await seed('hero', 100);
        const r = await settleSpireForMember({ slug: 'hero', session: cleared('purse-1', 8, 'hero', 8) }, deps);
        assert.equal(SPIRE_PURSE_A_MULT, 1.5);
        // A(100) = 300 ryo a minute; 8 minutes x 1.5 x 300 = 3,600.
        assert.deepEqual(r.purse, { ryo: 3_600, minutes: 8 });
        const c = await charOf('hero');
        assert.equal(c.ryo, 1_000 + 3_600);
        assert.equal(c.fateShards, SPIRE_SHARDS_PER_TIER, 'the weekly-first Fate Shards still pay');
    });

    it('pays at the member\'s own level', async () => {
        await seed('rookie', 30);
        const r = await settleSpireForMember({ slug: 'rookie', session: cleared('purse-l30', 2, 'rookie', 10) }, deps);
        // A(30) = 140; 10 minutes x 1.5 x 140 = 2,100.
        assert.equal(r.purse?.ryo, 2_100);
    });

    it('pays every clear; a repeat of the tier this week pays the purse but no shards', async () => {
        await seed('hero', 100);
        await settleSpireForMember({ slug: 'hero', session: cleared('repeat-a', 8, 'hero', 5) }, deps);
        const again = await settleSpireForMember({ slug: 'hero', session: cleared('repeat-b', 8, 'hero', 5) }, deps);
        assert.equal(again.paid, true);
        assert.equal(again.purse?.ryo, 2_250);
        assert.equal(again.shards, 0, 'the result says the shards were already banked this week');
        const c = await charOf('hero');
        assert.equal(c.ryo, 1_000 + 2 * 2_250);
        assert.equal(c.fateShards, SPIRE_SHARDS_PER_TIER, 'shards stay best-tier-per-week');
    });

    it('caps the credited minutes, so a run held open does not stretch its pay', async () => {
        await seed('hero', 100);
        const r = await settleSpireForMember({ slug: 'hero', session: cleared('idle', 3, 'hero', 120) }, deps);
        assert.deepEqual(r.purse, { ryo: 1.5 * 300 * ACTIVITY_PURSE_MAX_MINUTES, minutes: ACTIVITY_PURSE_MAX_MINUTES });
    });

    it('a replay of the same run pays nothing more and reports the sealed purse', async () => {
        await seed('hero', 100);
        const session = cleared('replay', 4, 'hero', 6);
        await settleSpireForMember({ slug: 'hero', session }, deps);
        const replay = await settleSpireForMember({ slug: 'hero', session }, deps);
        assert.equal(replay.paid, false);
        assert.equal(replay.reason, 'already-paid');
        assert.deepEqual(replay.purse, { ryo: 2_700, minutes: 6 });
        assert.equal((await charOf('hero')).ryo, 1_000 + 2_700);
    });

    it('a run with no terminal stamp (ended before the purse existed) pays no purse', async () => {
        await seed('hero', 100);
        const legacy = cleared('legacy', 8, 'hero', 8);
        delete legacy.terminalAt;
        const r = await settleSpireForMember({ slug: 'hero', session: legacy }, deps);
        assert.equal(r.paid, true);
        assert.equal(r.purse, undefined);
        assert.equal((await charOf('hero')).ryo, 1_000);
    });

    it('the store stamps the first terminal write and never moves it', async () => {
        const session = cleared('stamp', 8, 'hero', 8);
        delete session.terminalAt;
        session.status = 'active';
        await writeSession(session, { now: () => NOW - 5 * MINUTE });
        assert.equal(session.terminalAt, undefined, 'an active write does not stamp');
        session.status = 'done';
        await writeSession(session, { now: () => NOW });
        await writeSession(session, { now: () => NOW + 30 * MINUTE });
        assert.equal((await readSession('stamp'))?.terminalAt, NOW);
    });

    it('SPIRE_PURSE_SCALE=0 turns the purse off and leaves the rest of the clear', async () => {
        process.env.SPIRE_PURSE_SCALE = '0';
        try {
            await seed('hero', 100);
            const r = await settleSpireForMember({ slug: 'hero', session: cleared('off', 8, 'hero', 8) }, deps);
            assert.equal(r.paid, true);
            assert.equal(r.purse, undefined);
            assert.equal((await charOf('hero')).ryo, 1_000);
        } finally {
            delete process.env.SPIRE_PURSE_SCALE;
        }
    });

    it('records the committed purse in the economy ledger once', async () => {
        await seed('hero', 100);
        const session = cleared('ledger', 8, 'hero', 8);
        await settleSpireForMember({ slug: 'hero', session }, deps);
        await settleSpireForMember({ slug: 'hero', session }, deps);
        await drainBackgroundWork();
        const txns = ((await kv.get<Json[]>(ECON_TXN_LIST_KEY)) ?? []).filter((txn) => txn.source === 'spire.purse');
        assert.deepEqual(txns.map((txn) => [txn.player, txn.currency, txn.delta]), [['hero', 'ryo', 3_600]]);
    });
});
