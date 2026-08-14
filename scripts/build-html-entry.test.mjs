import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleEntryReference } from './build-html-entry.mjs';

test('build size gate selects the Vite module entry after a classic boot watchdog', () => {
    const html = `
        <script src="/boot-watchdog.js"></script>
        <script type="module" crossorigin src="/assets/index-DjeDeMvK.js"></script>
        <link rel="modulepreload" href="/assets/react-vendor-C9mu56rn.js">
    `;

    assert.equal(moduleEntryReference(html), 'assets/index-DjeDeMvK.js');
});

test('module entry selection supports attribute order and never falls back to classic JS', () => {
    assert.equal(
        moduleEntryReference(`<script src='/assets/index-12345678.js?v=2' defer type='MODULE'></script>`),
        'assets/index-12345678.js',
    );
    assert.equal(moduleEntryReference('<script src="/boot-watchdog.js"></script>'), undefined);
});
