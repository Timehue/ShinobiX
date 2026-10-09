import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WAR_MAP_MEMO_MS, clearWarMapCache, contestGarrisonFeed, contestUnfedToday, contestVillageUnfed, declareSectorWar, engageOpenSectorBattle, fetchWarMap, storesUtcDay, type SectorWarContest } from './village-war-map';

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

// The Fed/Unfed chip read the raw `fed: false`, so yesterday's verdict stayed on
// screen through a day the daily pass never ran.
describe('contestUnfedToday — the Fed/Unfed chip expires with its day too', () => {
    it('reads Unfed only while the verdict names today', () => {
        assert.equal(contestUnfedToday(contest({ storesDate: TODAY, fed: false }), TODAY), true);
        assert.equal(contestUnfedToday(contest({ storesDate: YESTERDAY, fed: false }), TODAY), false, 'a stale verdict reads as fed');
        assert.equal(contestUnfedToday(contest({ fed: false }), TODAY), false, 'a war the pass never evaluated reads as fed');
        assert.equal(contestUnfedToday(contest({ storesDate: TODAY, fed: true }), TODAY), false);
    });
});

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

describe('engageOpenSectorBattle — an attack in a Pet or Card war is that war\'s game', () => {
    const realFetch = globalThis.fetch;
    const ENGAGE_ID = '0123456789abcdef01234567';

    it('asks the war\'s own endpoint to fight the named player, and returns the battle to open', async () => {
        const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
        globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
            seen.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
            return { ok: true, json: async () => ({ engageId: ENGAGE_ID, session: {} }) } as unknown as Response;
        }) as typeof globalThis.fetch;
        try {
            assert.deepEqual(await engageOpenSectorBattle('pet', 'Raider', '10:storm-vs-leaf', 'Warden'),
                { kind: 'pet', sectorWarId: '10:storm-vs-leaf', engageId: ENGAGE_ID });
            assert.deepEqual(await engageOpenSectorBattle('card', 'Raider', '10:storm-vs-leaf', 'Warden'),
                { kind: 'card', sectorWarId: '10:storm-vs-leaf', engageId: ENGAGE_ID });
            assert.deepEqual(seen.map((call) => call.url), ['/api/village/sector-pet', '/api/village/sector-card']);
            for (const call of seen) {
                // No pet or deck rides along: the server seals both sides from their saves.
                assert.deepEqual(call.body, { action: 'engage', playerName: 'Raider', sectorWarId: '10:storm-vs-leaf', target: 'Warden' });
            }
        } finally { globalThis.fetch = realFetch; clearWarMapCache(); }
    });

    it('throws the server\'s own sentence on a refusal, for the player\'s row to show', async () => {
        globalThis.fetch = (async () => ({
            ok: false, status: 409,
            json: async () => ({ error: 'That shinobi just lost a battle and is recovering. You can challenge them in 2 min.' }),
        }) as unknown as Response) as typeof globalThis.fetch;
        try {
            await assert.rejects(engageOpenSectorBattle('pet', 'Raider', '10:storm-vs-leaf', 'Warden'),
                { name: 'WarMapRequestError', message: 'That shinobi just lost a battle and is recovering. You can challenge them in 2 min.' });
        } finally { globalThis.fetch = realFetch; clearWarMapCache(); }
    });

    it('never opens a battle the server did not name', async () => {
        globalThis.fetch = (async () => ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response) as typeof globalThis.fetch;
        try {
            await assert.rejects(engageOpenSectorBattle('card', 'Raider', '10:storm-vs-leaf', 'Warden'), { name: 'WarMapRequestError' });
        } finally { globalThis.fetch = realFetch; clearWarMapCache(); }
    });
});
