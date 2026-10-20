import assert from 'node:assert/strict';
import test from 'node:test';
import { openWarCrate } from './inventory-settlement';

test('an interrupted or unreadable crate response does not claim no change or encourage opening another', async () => {
    const original = globalThis.fetch;
    try {
        for (const fail of [
            async () => { throw new TypeError('Failed to fetch'); },
            async () => new Response('<html>gateway error</html>', { status: 502 }),
            async () => new Response('{}', { status: 200 }),
        ]) {
            globalThis.fetch = fail;
            const result = await openWarCrate('Aya');
            assert.equal(result.ok, false);
            if (result.ok) assert.fail('an incomplete receipt must not be treated as a paid reward');
            assert.match(result.error, /could not be confirmed.*Refresh your inventory/);
            assert.doesNotMatch(result.error, /Nothing was changed|please retry/);
        }
    } finally { globalThis.fetch = original; }
});
