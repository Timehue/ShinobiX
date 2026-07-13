import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeImageSource } from './shared-images.js';

test('safeImageSource allows raster images and rejects executable image schemes', () => {
    assert.equal(safeImageSource('https://images.example/avatar.png'), 'https://images.example/avatar.png');
    const internalImagePath = ['', 'api', 'img', 'avatar', 'rill'].join('/');
    assert.equal(safeImageSource(internalImagePath), internalImagePath);
    assert.equal(safeImageSource('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
    assert.equal(safeImageSource('javascript:alert(1)'), '');
    assert.equal(safeImageSource('data:image/svg+xml,<svg onload=alert(1)>'), '');
    assert.equal(safeImageSource('https://user:secret@images.example/a.png'), '');
});
