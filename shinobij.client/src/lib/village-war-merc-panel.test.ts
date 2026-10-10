import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { WarMapRequestError, hireMerc, newMercRequestId, type MercContextView, type MercLeaseView } from './village-war-map';
import {
    groupMercBands,
    isRetryableMercError,
    mercAllowanceLine,
    mercContextTime,
    mercContextTitle,
    mercTierCost,
    withMercRetry,
} from './village-war-merc-panel';

// The War Map mercenary panel's pure half (owner redesign 2026-10-08): a band
// is hired FOR one war, the panel quotes the server's price, and a hire click
// is retried only with its own request id.

const VILLAGE_WAR: MercContextView = {
    kind: 'village', key: 'village:a-vs-b:g2', enemy: 'Moonshadow Village', endsAt: 10 * 3_600_000, acting: true,
    hiresUsed: 2, hiresLimit: 6, callerHiresLeft: 1,
    seats: [
        { seat: 'kage', used: 2, limit: 3 }, { seat: 'elder-1', used: 0, limit: 1 },
        { seat: 'elder-2', used: 0, limit: 1 }, { seat: 'elder-3', used: 0, limit: 1 },
    ],
};
const SIEGE: MercContextView = {
    kind: 'sector', key: 'sector:23:a-vs-b:g1.s1', enemy: 'Moonshadow Village', endsAt: 5 * 3_600_000, acting: true,
    contestId: '23:a-vs-b', sector: 23, hiresUsed: 1, hiresLimit: 3, callerHiresLeft: 2,
};

describe('copy', () => {
    it('names the war a band serves', () => {
        assert.equal(mercContextTitle(VILLAGE_WAR), 'Village war vs Moonshadow Village');
        assert.equal(mercContextTitle(SIEGE), 'Defending Sector 23 vs Moonshadow Village');
    });

    it('counts down, or says when a pending village war starts', () => {
        assert.equal(mercContextTime(SIEGE, 3_600_000), '4h left');
        assert.equal(mercContextTime({ ...VILLAGE_WAR, startsAt: 40 * 60_000 }, 0), 'starts in 40m');
    });

    it('shows the hires left, per seat in a village war', () => {
        assert.equal(
            mercAllowanceLine(VILLAGE_WAR, true),
            '4 of 6 hires left this war (Kage 1/3 · First Elder 1/1 · Second Elder 1/1 · Third Elder 1/1). You can hire 1 more.',
        );
        assert.equal(mercAllowanceLine(SIEGE, true), '2 of 3 hires left for this sector war.');
        assert.equal(mercAllowanceLine(SIEGE, false), '2 of 3 hires left for this sector war (Kage and Elders hire).');
    });

    it('prices a tier at the cost the server quotes, not the base', () => {
        assert.equal(mercTierCost({ costWr: 60, cost: 15 }), 15);
        assert.equal(mercTierCost({ costWr: 60, cost: 0 }), 0, 'a free comeback hire is free');
        assert.equal(mercTierCost({ costWr: 60 }), 60, 'an older server that quotes nothing falls back to the base');
    });
});

describe('groupMercBands', () => {
    const lease = (over: Partial<MercLeaseView>): MercLeaseView => ({ id: 'mh_x', tierId: 'merc-ronin', player: 'k', expiresAt: 9e12, count: 3, ...over });

    it('groups bands under their war, then over wars, then legacy bands; spent bands are hidden', () => {
        const groups = groupMercBands([
            lease({ id: 'a', contextKey: SIEGE.key }),
            lease({ id: 'b', contextKey: 'sector:old:g1.s0' }),
            lease({ id: 'c', contextKey: null }),
            lease({ id: 'd', contextKey: VILLAGE_WAR.key }),
            lease({ id: 'e', contextKey: SIEGE.key, count: 0 }),
        ], [VILLAGE_WAR, SIEGE]);
        assert.deepEqual(groups.map((g) => [g.title, g.bands.map((b) => b.id)]), [
            ['Village war vs Moonshadow Village', ['d']],
            ['Defending Sector 23 vs Moonshadow Village', ['a']],
            ['Bands whose war is over', ['b']],
            ['Earlier contracts (village wars only)', ['c']],
        ]);
    });
});

describe('a hire click retries with its own request id only', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });

    it('retries a lost response or a 5xx, never a refusal', () => {
        assert.equal(isRetryableMercError(new TypeError('Failed to fetch')), true);
        assert.equal(isRetryableMercError(new WarMapRequestError(503, { error: 'busy' })), true);
        assert.equal(isRetryableMercError(new WarMapRequestError(409, { error: 'no hires left' })), false);
        assert.equal(isRetryableMercError(new WarMapRequestError(429, { error: 'slow down' })), false);
    });

    it('sends the SAME request id on every attempt, so the server can replay instead of charging twice', async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let calls = 0;
        globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
            bodies.push(JSON.parse(String(init?.body ?? '{}')));
            calls += 1;
            if (calls === 1) throw new TypeError('network dropped');
            return new Response(JSON.stringify({ ok: true, replayed: true, hireId: 'mh_x', cost: 15 }), { status: 200 });
        }) as typeof fetch;
        const requestId = newMercRequestId();
        const out = await withMercRetry(() => hireMerc('kage', 'Frostfang Village', 'merc-ronin', { kind: 'sector', contestId: '23:a-vs-b' }, requestId), 3, 0, async () => undefined);
        assert.equal(out.replayed, true);
        assert.equal(bodies.length, 2);
        assert.deepEqual(bodies[0], { action: 'hire', playerName: 'kage', village: 'Frostfang Village', tierId: 'merc-ronin', requestId, context: 'sector', contestId: '23:a-vs-b' });
        assert.deepEqual(bodies[1], bodies[0]);
    });

    it('gives up on a refusal at once', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return new Response(JSON.stringify({ error: 'Your seat has used its mercenary hires for this war.' }), { status: 409 });
        }) as typeof fetch;
        await assert.rejects(
            withMercRetry(() => hireMerc('kage', 'Frostfang Village', 'merc-ronin', { kind: 'village' }, newMercRequestId()), 3, 0, async () => undefined),
            /used its mercenary hires/,
        );
        assert.equal(calls, 1);
    });

    it('mints a fresh id per click', () => {
        const a = newMercRequestId();
        const b = newMercRequestId();
        assert.notEqual(a, b);
        assert.match(a, /^[A-Za-z0-9_-]{8,64}$/, 'the shape the server accepts');
    });
});
