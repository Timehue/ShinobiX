import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {loadFacing} from './sector-pose-delivery';

function facingFile(marker: string) {
    const page = {file: 'p.264', cell: [64, 96], frames: 4, cols: 4};
    const json = {pages: {[page.file]: page}, clips: {idle: {count: 1, period: 1, origins: [[0, 0]], file: page.file, marker}}};
    const bytes = gzipSync(Buffer.from(JSON.stringify(json)));
    return {name: createHash('sha256').update(bytes).digest('hex') + '.gz', bytes};
}

test('one facing index is read once and shared, and a failed read is retried', async () => {
    const good = facingFile('shared'), flaky = facingFile('flaky');
    let calls = 0, failNext = true;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
        calls++;
        if (url.endsWith(flaky.name) && failNext) { failNext = false; return new Response('', {status: 503}); }
        const file = url.endsWith(good.name) ? good : flaky;
        return new Response(file.bytes, {status: 200});
    }) as typeof fetch;
    try {
        const [first, second] = await Promise.all([loadFacing('https://art/m/', good.name, 2), loadFacing('https://art/m/', good.name, 0)]);
        assert.equal(first, second, 'two figures share the decoded index');
        assert.equal(calls, 1);
        await assert.rejects(loadFacing('https://art/m/', flaky.name));
        const retried = await loadFacing('https://art/m/', flaky.name);
        assert.equal(retried.idle!.url, 'https://art/m/p.264');
        assert.equal(calls, 3, 'the failure was not cached');
    } finally { globalThis.fetch = original; }
});
