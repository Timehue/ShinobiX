import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClanWarViewerCache } from './clan-war-viewer-cache.js';

test('account switching clears direct cache readers and rejects the former viewer’s late projection', () => {
    let viewer: string | null = 'AzureNinja';
    const store = createClanWarViewerCache<{ id: string; updatedAt: number; privateQueue: string[] }>(() => viewer);
    const first = store.scope();
    store.accept({ id: 'rivalry', updatedAt: 100, privateQueue: ['AzureNinja'] }, first);
    viewer = 'EmberNinja';
    assert.deepEqual(Object.values(store.cache), []);
    assert.equal(store.accept({ id: 'rivalry', updatedAt: 200, privateQueue: ['AzureNinja'] }, first), undefined);
    const second = store.scope();
    store.accept({ id: 'rivalry', updatedAt: 80, privateQueue: ['EmberNinja'] }, second);
    assert.deepEqual(store.cache.rivalry.privateQueue, ['EmberNinja']);
    viewer = null;
    assert.equal(store.cache.rivalry, undefined);
});

test('older replies cannot reopen a completed war, while identity casing remains stable', () => {
    let viewer = 'AzureNinja';
    const store = createClanWarViewerCache<{ id: string; updatedAt: number; ended: boolean }>(() => viewer);
    const scope = store.scope();
    const ended = { id: 'rivalry', updatedAt: 200, ended: true };
    store.accept(ended, scope);
    viewer = 'azureninja';
    assert.equal(store.accept({ id: 'rivalry', updatedAt: 100, ended: false }, scope), ended);
});
