import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { refreshVillageMemberState } from './village-member-state';
import { adoptVillageMemberState, hydrateSharedGameState, loadVillageState, saveVillageState, villageMemberEditCount } from './world-state';

/*
 * A village's members-only record (owner ruling 2026-10-08). The public
 * /api/game-state frame no longer carries the treasury, Village Stores,
 * upgrades, contribution total, activity log, orders or daily agenda; members
 * read them from GET /api/village/state, and the answer is merged into the
 * shared village cache that every screen reads.
 */

const MEMBER_FIELDS = ['treasury', 'upgrades', 'contributionPoints', 'notices', 'noticePosts', 'dailyAgenda'];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function treasury(ryo: number) {
    return { ryo, honorSeals: 40, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, provisions: 12, materialPoints: 30, items: [] };
}

/** Answer /api/village/state with `state`; record every request. */
function serve(village: string, state: Record<string, unknown> | null, calls: Array<{ url: string; init?: RequestInit }> = []) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true, village, state }), { status: 200 });
    }) as typeof fetch;
    return calls;
}

/** Capture what village writes POST, without a network. */
function captureWrites() {
    const sent: Array<{ state: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response('{}');
    }) as typeof fetch;
    return sent;
}

describe('refreshVillageMemberState', () => {
    it('reads the village\'s own record, never from a cache, and merges it in', async () => {
        const village = 'Member Read Village';
        const calls = serve(village, { treasury: treasury(900), contributionPoints: 70, upgrades: { training: 3 }, notices: null, noticePosts: null, dailyAgenda: null });
        assert.equal(await refreshVillageMemberState(village, { force: true }), true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/village/state?village=Member%20Read%20Village');
        assert.equal(calls[0].init?.cache, 'no-store');
        const state = loadVillageState(village);
        assert.equal(state.treasury.ryo, 900);
        assert.equal(state.treasury.materialPoints, 30);
        assert.equal(state.contributionPoints, 70);
        assert.equal(state.upgrades.training, 3);
        assert.equal(await refreshVillageMemberState(village, { force: true }), false, 'an unchanged answer changes nothing');
    });

    it('reads a village at most every 30 seconds unless forced', async () => {
        const village = 'Member Gap Village';
        const calls = serve(village, { treasury: treasury(1) });
        await refreshVillageMemberState(village, { force: true });
        await refreshVillageMemberState(village);
        assert.equal(calls.length, 1, 'the World Map\'s unforced poll waits out the gap');
        await refreshVillageMemberState(village, { force: true });
        assert.equal(calls.length, 2, 'the Town Hall\'s forced poll does not');
    });

    it('a refused or failed read leaves the cache alone', async () => {
        const village = 'Member Refused Village';
        serve(village, { treasury: treasury(55) });
        await refreshVillageMemberState(village, { force: true });
        globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'A village\'s records are for its own members.' }), { status: 403 })) as typeof fetch;
        assert.equal(await refreshVillageMemberState(village, { force: true }), false);
        globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
        assert.equal(await refreshVillageMemberState(village, { force: true }), false);
        assert.equal(loadVillageState(village).treasury.ryo, 55);
    });
});

describe('the shared village cache with a members-only record', () => {
    it('keeps the record through every public poll', () => {
        const village = 'Member Merge Village';
        adoptVillageMemberState(village, { treasury: treasury(500), contributionPoints: 40 }, villageMemberEditCount());
        hydrateSharedGameState({ villageStates: { membermergevillage: { kageHistory: [] } } });
        assert.equal(loadVillageState(village).treasury.ryo, 500, 'the public frame has no treasury; the member read still stands');
        assert.equal(loadVillageState(village).contributionPoints, 40);
    });

    it('drops a read that began before a local edit, so it cannot put older figures back', () => {
        const village = 'Member Edit Village';
        adoptVillageMemberState(village, { treasury: treasury(500), contributionPoints: 40 }, villageMemberEditCount());
        const readStarted = villageMemberEditCount();
        captureWrites();
        saveVillageState(village, { ...loadVillageState(village), contributionPoints: 45 });
        assert.equal(adoptVillageMemberState(village, { treasury: treasury(1), contributionPoints: 40 }, readStarted), false);
        assert.equal(loadVillageState(village).contributionPoints, 45);
        assert.equal(loadVillageState(village).treasury.ryo, 500);
        hydrateSharedGameState({ villageStates: { membereditvillage: {} } });
        assert.equal(loadVillageState(village).contributionPoints, 45, 'the edit survives the next public poll too');
    });

    it('never writes back member fields it has not read: they would only be defaults', () => {
        // The validator keeps stored values for anything a write leaves out,
        // but a default it is SENT can win: a seated Kage may lower the
        // contribution total, and the activity log has no rule at all.
        const village = 'Member Unread Village';
        const sent = captureWrites();
        saveVillageState(village, { ...loadVillageState(village), contributionPoints: 10, notices: ['Would erase the real log.'] });
        assert.equal(sent.length, 1);
        for (const field of MEMBER_FIELDS) assert.equal(Object.hasOwn(sent[0].state, field), false, `${field} is not sent before it is read`);
        assert.equal(Object.hasOwn(sent[0].state, 'warRecords'), true, 'the public fields still are');
    });
});
