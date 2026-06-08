import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeImageDataUrl, perImageKey } from './img.js';

describe('decodeImageDataUrl', () => {
    it('decodes a base64 png data URL to mime + buffer', () => {
        // 1x1 transparent PNG
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const out = decodeImageDataUrl(png);
        assert.ok(out, 'should decode');
        assert.equal(out!.mime, 'image/png');
        assert.ok(out!.buf.length > 0);
        // PNG magic number
        assert.equal(out!.buf[0], 0x89);
        assert.equal(out!.buf[1], 0x50);
    });

    it('decodes webp + jpeg mime types (case-insensitive)', () => {
        assert.equal(decodeImageDataUrl('data:image/webp;base64,UklGRg==')!.mime, 'image/webp');
        assert.equal(decodeImageDataUrl('DATA:IMAGE/JPEG;BASE64,/9j/4AAQ')!.mime, 'image/jpeg');
    });

    it('rejects non-image and non-data-URL strings', () => {
        assert.equal(decodeImageDataUrl('https://example.com/a.png'), null);
        assert.equal(decodeImageDataUrl('data:text/plain;base64,aGk='), null);
        assert.equal(decodeImageDataUrl('not a data url'), null);
        assert.equal(decodeImageDataUrl(''), null);
    });

    it('rejects an empty payload', () => {
        assert.equal(decodeImageDataUrl('data:image/png;base64,'), null);
    });
});

describe('perImageKey', () => {
    it('namespaces the id under the shared disk-routed prefix', () => {
        assert.equal(perImageKey('jutsu:fireball'), 'shared:img:jutsu:fireball');
        assert.equal(perImageKey('avatar:rill'), 'shared:img:avatar:rill');
    });
});
