import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeImageSource, publishSharedImage, deleteSharedImage } from './shared-images.js';

test('safeImageSource allows raster images and rejects executable image schemes', () => {
    assert.equal(safeImageSource('https://images.example/avatar.png'), 'https://images.example/avatar.png');
    const internalImagePath = ['', 'api', 'img', 'avatar', 'rill'].join('/');
    assert.equal(safeImageSource(internalImagePath), internalImagePath);
    assert.equal(safeImageSource('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
    assert.equal(safeImageSource('javascript:alert(1)'), '');
    assert.equal(safeImageSource('data:image/svg+xml,<svg onload=alert(1)>'), '');
    assert.equal(safeImageSource('https://user:secret@images.example/a.png'), '');
});

test('clearing a shared image deletes it instead of publishing a rejected empty image', async t => {
    const requests: RequestInit[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        requests.push(init);
        return new Response(null, { status: 200 });
    });
    assert.equal(await publishSharedImage('vn:example:page:0:actor:yura', ''), false);
    assert.equal(requests.length, 0, 'an empty save is not an explicit removal');
    assert.equal(await deleteSharedImage('vn:example:page:0:actor:yura'), true);
    assert.equal(requests[0].method, 'DELETE');
    assert.deepEqual(JSON.parse(requests[0].body as string), { id: 'vn:example:page:0:actor:yura' });
    assert.equal(await publishSharedImage('vn:example:page:0:actor:yura', 'data:image/png;base64,AAAA'), true);
    assert.equal(requests[1].method, 'POST');
    assert.equal(await publishSharedImage('vn:example:page:0:actor:yura', '/api/img?id=existing'), true);
    assert.equal(requests.length, 2);
});
