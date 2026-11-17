import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prefetchSectorLife, SECTOR_LIFE_PREFETCH_FRESH_MS, takePrefetchedSectorLife} from './sector-life-api';

function stubFetch() {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
        calls++;
        return new Response(JSON.stringify({ok: true, view: {sector: 14, phase: 'active', actors: []}}), {status: 200});
    }) as typeof fetch;
    return {get calls() { return calls; }, restore() { globalThis.fetch = original; }};
}

test('the arriving sector takes the travel read instead of asking again, once', async () => {
    const fetches = stubFetch();
    try {
        prefetchSectorLife('Rin', 14, 1_000);
        const early = takePrefetchedSectorLife('Rin', 14, 4_000);
        assert.ok(early);
        assert.equal((await early).ok, true);
        assert.equal(takePrefetchedSectorLife('Rin', 14, 4_000), undefined, 'a second view polls normally');
        assert.equal(fetches.calls, 1);
    } finally { fetches.restore(); }
});

test('a travel read for another sector, another player, or gone stale is not used', async () => {
    const fetches = stubFetch();
    try {
        prefetchSectorLife('Rin', 14, 0);
        assert.equal(takePrefetchedSectorLife('Rin', 15, 10), undefined);
        prefetchSectorLife('Rin', 14, 0);
        assert.equal(takePrefetchedSectorLife('Kai', 14, 10), undefined);
        prefetchSectorLife('Rin', 14, 0);
        assert.equal(takePrefetchedSectorLife('Rin', 14, SECTOR_LIFE_PREFETCH_FRESH_MS), undefined);
    } finally { fetches.restore(); }
});
