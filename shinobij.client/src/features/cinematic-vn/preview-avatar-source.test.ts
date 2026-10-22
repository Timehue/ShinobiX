import assert from 'node:assert/strict';
import test from 'node:test';
import { previewAvatarSource } from './preview-avatar-source';

test('preview avatars retain shipped portraits and starter images', () => {
    for (const source of ['/portraits/elder-sova.webp', '/portraits/story/captain-yura.png', '/starter-avatar-one.webp', '/starter-avatar-two.webp']) {
        assert.equal(previewAvatarSource(source), source);
    }
});

test('preview avatars reject URL schemes, path traversal and injected suffixes', () => {
    for (const source of [null, '', 'javascript:alert(1)', 'https://example.com/avatar.png', '//example.com/avatar.png', '/portraits/../outside.webp', '/portraits/%2e%2e/outside.webp', '/portraits/hero.webp?redirect=javascript:alert(1)', '/portraits/hero.webp#payload', '/portraits/hero.svg', '/portraits/hero\\outside.webp', '/portraits/hero\n.webp']) {
        assert.equal(previewAvatarSource(source), '', String(source));
    }
});
