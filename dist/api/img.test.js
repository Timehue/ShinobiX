"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const img_js_1 = require("./img.js");
(0, node_test_1.describe)('decodeImageDataUrl', () => {
    (0, node_test_1.it)('decodes a base64 png data URL to mime + buffer', () => {
        // 1x1 transparent PNG
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const out = (0, img_js_1.decodeImageDataUrl)(png);
        node_assert_1.strict.ok(out, 'should decode');
        node_assert_1.strict.equal(out.mime, 'image/png');
        node_assert_1.strict.ok(out.buf.length > 0);
        // PNG magic number
        node_assert_1.strict.equal(out.buf[0], 0x89);
        node_assert_1.strict.equal(out.buf[1], 0x50);
    });
    (0, node_test_1.it)('decodes webp + jpeg mime types (case-insensitive)', () => {
        node_assert_1.strict.equal((0, img_js_1.decodeImageDataUrl)('data:image/webp;base64,UklGRg==').mime, 'image/webp');
        node_assert_1.strict.equal((0, img_js_1.decodeImageDataUrl)('DATA:IMAGE/JPEG;BASE64,/9j/4AAQ').mime, 'image/jpeg');
    });
    (0, node_test_1.it)('rejects non-image and non-data-URL strings', () => {
        node_assert_1.strict.equal((0, img_js_1.decodeImageDataUrl)('https://example.com/a.png'), null);
        node_assert_1.strict.equal((0, img_js_1.decodeImageDataUrl)('data:text/plain;base64,aGk='), null);
        node_assert_1.strict.equal((0, img_js_1.decodeImageDataUrl)('not a data url'), null);
        node_assert_1.strict.equal((0, img_js_1.decodeImageDataUrl)(''), null);
    });
    (0, node_test_1.it)('rejects an empty payload', () => {
        node_assert_1.strict.equal((0, img_js_1.decodeImageDataUrl)('data:image/png;base64,'), null);
    });
});
(0, node_test_1.describe)('perImageKey', () => {
    (0, node_test_1.it)('namespaces the id under the shared disk-routed prefix', () => {
        node_assert_1.strict.equal((0, img_js_1.perImageKey)('jutsu:fireball'), 'shared:img:jutsu:fireball');
        node_assert_1.strict.equal((0, img_js_1.perImageKey)('avatar:rill'), 'shared:img:avatar:rill');
    });
});
