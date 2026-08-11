import test from 'node:test';
import assert from 'node:assert/strict';
import { placeBounty } from './pvp-bounty.js';

test('an ambiguous PLACE retry reuses one stable client requestId', { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    let attempt = 0;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        attempt += 1;
        if (attempt === 1) throw new Error('simulated lost response');
        return new Response(JSON.stringify({ ok: true, bounties: [], balances: { ryo: 9000 } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;
    try {
        const result = await placeBounty('Rill', 'Kenji', 1000);
        assert.equal(result.ok, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(bodies.length, 2);
    assert.match(String(bodies[0]?.requestId ?? ''), /^[A-Za-z0-9_-]{8,96}$/);
    assert.equal(bodies[1]?.requestId, bodies[0]?.requestId);
    assert.deepEqual(
        { ...bodies[1], requestId: undefined },
        { ...bodies[0], requestId: undefined },
        'retry must preserve every economic parameter',
    );
});
