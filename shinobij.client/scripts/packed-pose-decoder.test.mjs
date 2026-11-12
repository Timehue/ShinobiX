import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { packedPoseDecoder } from './packed-pose-decoder.mjs';

test('the shipped pose decoder initializes from opaque and transparently decompressed responses', async t => {
    const path = fileURLToPath(import.meta.resolve('@yume-chan/h264bsd'));
    let emitted;
    const result = packedPoseDecoder().transform.call({
        emitFile(file) { emitted = file; },
        error(message) { throw Error(message); },
    }, readFileSync(path, 'utf8'), path);
    const factory = (await import('data:text/javascript;base64,' + Buffer.from(result.code).toString('base64'))).default;
    const location = {href:'https://example.test/assets/pose.worker.js'};
    const prevSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    Object.defineProperty(globalThis, 'self', {value:{location}, configurable:true});
    t.after(() => {
        if (prevSelf) Object.defineProperty(globalThis, 'self', prevSelf);
        else delete globalThis.self;
    });
    for (const payload of [emitted.source, gunzipSync(emitted.source)]) {
        const fetch = t.mock.method(globalThis, 'fetch', async url => {
            assert.equal(url.pathname, '/'+emitted.fileName);
            return new Response(payload);
        });
        const module = await factory();
        const decoder = new module.Decoder();
        decoder.delete();
        assert.equal(fetch.mock.callCount(), 1);
        fetch.mock.restore();
    }
});
