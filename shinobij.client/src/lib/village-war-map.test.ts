import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WAR_MAP_MEMO_MS, clearWarMapCache, contestGarrisonFeed, contestVillageUnfed, declareSectorWar, fetchWarMap, storesUtcDay, type SectorWarContest } from './village-war-map';

// MUST mirror api/_sector-war.ts sectorWarVillageUnfed: the stores verdict is
// scoped to the UTC day it was stamped for. Without that, the "marches hungry"
// plate stuck permanently — the daily pass throwing once, or the Village Stores
// kill switch being flipped, froze the last `fed: false` with nothing able to
// clear it.

const MOON = 'Moonshadow Village';
const FROST = 'Frostfang Village';
const TODAY = '2026-08-22';
const YESTERDAY = '2026-08-21';

function contest(over: Partial<SectorWarContest> = {}): SectorWarContest {
    return {
        id: '26:moonshadowvillage-vs-frostfangvillage',
        sector: 26,
        attackerVillage: MOON,
        defenderVillage: FROST,
        winCondition: 'combat',
        attackerPoints: 0,
        defenderPoints: 0,
        endsAt: 0,
        flipped: false,
        ...over,
    };
}

describe('contestVillageUnfed — the hungry plate expires with its day', () => {
    it('applies while the verdict names today', () => {
        const c = contest({ storesDate: TODAY, fed: false, unfedVillages: [FROST] });
        assert.equal(contestVillageUnfed(c, FROST, TODAY), true);
        assert.equal(contestVillageUnfed(c, MOON, TODAY), false, 'only the listed side marches hungry');
    });

    it('a STALE fed:false reads as fed', () => {
        const stale = contest({ storesDate: YESTERDAY, fed: false, unfedVillages: [FROST] });
        assert.equal(contestVillageUnfed(stale, FROST, TODAY), false);
    });

    it('a row the pass never evaluated reads as fed', () => {
        assert.equal(contestVillageUnfed(contest({ fed: false, unfedVillages: [FROST] }), FROST, TODAY), false);
    });

    it('an empty unfedVillages list on the stamped day means BOTH sides are hungry', () => {
        const c = contest({ storesDate: TODAY, fed: false });
        assert.equal(contestVillageUnfed(c, FROST, TODAY), true);
        assert.equal(contestVillageUnfed(c, MOON, TODAY), true);
    });

    it('fed:true and fed:undefined are never hungry', () => {
        assert.equal(contestVillageUnfed(contest({ storesDate: TODAY, fed: true }), FROST, TODAY), false);
        assert.equal(contestVillageUnfed(contest({ storesDate: TODAY }), FROST, TODAY), false);
    });

    it('defaults to the live UTC day when the caller passes none', () => {
        const now = Date.UTC(2026, 7, 22, 4, 0, 0);
        assert.equal(storesUtcDay(now), TODAY);
        const today = storesUtcDay();
        assert.equal(contestVillageUnfed(contest({ storesDate: today, fed: false, unfedVillages: [FROST] }), FROST), true);
        assert.equal(contestVillageUnfed(contest({ storesDate: YESTERDAY, fed: false, unfedVillages: [FROST] }), FROST), false);
    });

    it('the garrison-feed reader is unchanged (its own coverage gate lives server-side)', () => {
        const c = contest({ garrisonFeed: { [FROST]: { on: true, covered: true } } });
        assert.deepEqual(contestGarrisonFeed(c, FROST), { on: true, covered: true });
        assert.deepEqual(contestGarrisonFeed(c, MOON), { on: false, covered: false });
    });
});


/*
 * /api/village/war-map is an aggregator: eight KV reads plus loadHeldSectorCounts(),
 * which is a `world:territory:*` wildcard scan + mget, answered `private,
 * no-store`. The Town Hall calls it on entry to BOTH the default Command tab and
 * Treasury, so every tab flick used to fire that scan again. These guard the
 * in-flight dedupe + short TTL memo that collapses those repeats — and the two
 * places it must NOT elide a read.
 */
describe('fetchWarMap — the aggregator is not re-scanned per tab flick', () => {
    const realFetch = globalThis.fetch;

    function stubFetch(body: unknown = { villages: [], contests: [] }) {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return { ok: true, json: async () => body } as unknown as Response;
        }) as typeof globalThis.fetch;
        return () => calls;
    }
    function stubFailing() {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return { ok: false, status: 503, json: async () => ({ error: 'nope' }) } as unknown as Response;
        }) as typeof globalThis.fetch;
        return () => calls;
    }
    const restore = () => { globalThis.fetch = realFetch; clearWarMapCache(); };

    it('shares ONE request across concurrent callers', async () => {
        clearWarMapCache();
        const calls = stubFetch();
        try {
            const [a, b, c] = await Promise.all([fetchWarMap(), fetchWarMap(), fetchWarMap()]);
            assert.equal(calls(), 1, 'three concurrent tab entries must not be three scans');
            assert.equal(a, b);
            assert.equal(b, c);
        } finally { restore(); }
    });

    it('serves a repeat read inside the TTL from the memo', async () => {
        clearWarMapCache();
        const calls = stubFetch();
        try {
            const first = await fetchWarMap();
            const second = await fetchWarMap();
            assert.equal(calls(), 1, 'Command -> Treasury -> Command is one fetch, not three');
            assert.equal(second, first, 'the memo returns the same payload, not a refetch');
            assert.ok(WAR_MAP_MEMO_MS >= 5_000 && WAR_MAP_MEMO_MS <= 10_000, 'the window stays short');
        } finally { restore(); }
    });

    it('never memoizes a failure — the next caller really retries', async () => {
        clearWarMapCache();
        const calls = stubFailing();
        try {
            await assert.rejects(fetchWarMap());
            await assert.rejects(fetchWarMap());
            assert.equal(calls(), 2);
        } finally { restore(); }
    });

    it('an action POST drops the memo so the refresh that follows really re-reads', async () => {
        clearWarMapCache();
        let warMapCalls = 0;
        globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
            if (String(url).includes('/api/village/war-map')) {
                warMapCalls += 1;
                return { ok: true, json: async () => ({ villages: [], contests: [] }) } as unknown as Response;
            }
            assert.equal(init?.method, 'POST');
            return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
        }) as typeof globalThis.fetch;
        try {
            await fetchWarMap();
            await declareSectorWar('Kage', 'Frostfang Village', 26);
            await fetchWarMap();
            assert.equal(warMapCalls, 2, 'a post-action refresh must not be served stale');
        } finally { restore(); }
    });

    it('clearWarMapCache forces the next read back to the server', async () => {
        clearWarMapCache();
        const calls = stubFetch();
        try {
            await fetchWarMap();
            clearWarMapCache();
            await fetchWarMap();
            assert.equal(calls(), 2);
        } finally { restore(); }
    });
});
