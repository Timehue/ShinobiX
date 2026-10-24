import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Page } from '@playwright/test';
import { collectNavigationPageErrors } from '../e2e/helpers/navigation-page-errors';

function nativeError(url = 'http://127.0.0.1:4173/api/pvp/session?pending=1&playerName=AuditNinja') {
    const text = 'Fetch API cannot load ' + url + ' due to access control checks.';
    return Object.assign(new Error(text), { name: 'Fetch API cannot load http', stack: text + '\n    at fetch (game.js:1:1)' });
}

function fixture(browser = 'webkit') {
    const events = new EventEmitter();
    const frame = { url: () => 'http://127.0.0.1:4173/#/inventory' };
    const page = Object.assign(events, { url: frame.url, mainFrame: () => frame }) as unknown as Page;
    const captured = collectNavigationPageErrors(page, browser);
    const navigation = { isNavigationRequest: () => true, frame: () => frame };
    return { events, frame, navigation, captured };
}

test('the original WebKit reload refusal is classified only before document commit', () => {
    const f = fixture();
    f.events.emit('request', f.navigation);
    f.events.emit('pageerror', nativeError());
    assert.equal(f.captured.documentReplacementErrors.length, 1);
    assert.deepEqual(f.captured.errors, []);
    f.events.emit('framenavigated', f.frame);
    f.events.emit('pageerror', nativeError());
    assert.equal(f.captured.errors.length, 1, 'a loaded-page access-control error must fail');
});

test('a failed navigation closes the exception window', () => {
    const f = fixture();
    f.events.emit('request', f.navigation);
    f.events.emit('requestfailed', f.navigation);
    f.events.emit('pageerror', nativeError());
    assert.equal(f.captured.errors.length, 1);
    assert.equal(f.captured.documentReplacementErrors.length, 0);
});

for (const [name, error, browser] of [
    ['ordinary exceptions during reload', new Error('ReferenceError: missing state'), 'webkit'],
    ['application errors that quote the fetch warning', new Error(nativeError().message), 'webkit'],
    ['cross-origin access failures', nativeError('http://other.example/api/pvp/session?pending=1'), 'webkit'],
    ['a live fight request', nativeError('http://127.0.0.1:4173/api/pvp/session?id=live'), 'webkit'],
    ['other API failures', nativeError('http://127.0.0.1:4173/api/save/player?pending=1'), 'webkit'],
    ['Chromium page errors', nativeError(), 'chromium'],
    ['Firefox page errors', nativeError(), 'firefox'],
] as const) test(name + ' are retained', () => {
    const f = fixture(browser);
    f.events.emit('request', f.navigation);
    f.events.emit('pageerror', error);
    assert.deepEqual(f.captured.errors, [error.message]);
    assert.deepEqual(f.captured.documentReplacementErrors, []);
});

test('subframe and fetch requests do not open a document-replacement window', () => {
    const f = fixture();
    f.events.emit('request', { isNavigationRequest: () => true, frame: () => ({}) });
    f.events.emit('request', { isNavigationRequest: () => false, frame: () => f.frame });
    f.events.emit('pageerror', nativeError());
    assert.equal(f.captured.errors.length, 1);
});

test('an iframe commit does not end the main-document replacement window', () => {
    const f = fixture();
    f.events.emit('request', f.navigation);
    f.events.emit('framenavigated', {});
    f.events.emit('pageerror', nativeError());
    assert.equal(f.captured.documentReplacementErrors.length, 1);
});

test('capture disposes every listener without changing recorded errors', () => {
    const f = fixture();
    f.events.emit('pageerror', new Error('recorded'));
    f.captured.dispose();
    for (const event of ['request', 'requestfailed', 'framenavigated', 'pageerror']) {
        assert.equal(f.events.listenerCount(event), 0);
    }
    assert.deepEqual(f.captured.errors, ['recorded']);
});
