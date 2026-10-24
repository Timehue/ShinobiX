import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Page } from '@playwright/test';
import { reloadWithTransientAssetRecovery } from '../e2e/helpers/navigation-reload';

function fixture(failure?: { url?: string; resourceType?: string; errorText?: string }) {
    const events = new EventEmitter();
    let reloads = 0;
    const page = Object.assign(events, {
        url: () => 'http://127.0.0.1:4173/#/pvpBattle',
        reload: async () => {
            reloads++;
            if (reloads === 1 && failure) events.emit('requestfailed', {
                url: () => failure.url ?? 'http://127.0.0.1:4173/assets/game.js',
                resourceType: () => failure.resourceType ?? 'script',
                failure: () => ({ errorText: failure.errorText ?? 'net::ERR_NETWORK_CHANGED' }),
            });
        },
    }) as unknown as Page;
    return { page, events, reloads: () => reloads };
}

test('navigation reload runs once when ready and removes its failure listener', async () => {
    const f = fixture();
    await reloadWithTransientAssetRecovery(f.page, async () => {});
    assert.equal(f.reloads(), 1);
    assert.equal(f.events.listenerCount('requestfailed'), 0);
});

test('a Windows network change during a local module load gets one fresh reload', async () => {
    const f = fixture({});
    let assertions = 0;
    await reloadWithTransientAssetRecovery(f.page, async () => {
        if (++assertions === 1) throw new Error('boot could not load its module');
    });
    assert.equal(f.reloads(), 2);
    assert.equal(assertions, 2);
    assert.equal(f.events.listenerCount('requestfailed'), 0);
});

for (const [name, failure] of Object.entries({
    'a navigation regression': undefined,
    'an HTTP or other network failure': { errorText: 'net::ERR_FAILED' },
    'an API outage': { url: 'http://127.0.0.1:4173/api/pvp/session', resourceType: 'fetch' },
    'a third party outage': { url: 'https://other.example/assets/game.js' },
    'an image failure': { url: 'http://127.0.0.1:4173/assets/game.webp', resourceType: 'image' },
})) test(name + ' cannot trigger reload recovery', async () => {
    const f = fixture(failure), original = new Error(name);
    await assert.rejects(reloadWithTransientAssetRecovery(f.page, async () => { throw original; }), error => error === original);
    assert.equal(f.reloads(), 1);
    assert.equal(f.events.listenerCount('requestfailed'), 0);
});

test('a continuing failure is surfaced after the single recovery attempt', async () => {
    const f = fixture({}), original = new Error('still broken');
    await assert.rejects(reloadWithTransientAssetRecovery(f.page, async () => { throw original; }), error => error === original);
    assert.equal(f.reloads(), 2);
    assert.equal(f.events.listenerCount('requestfailed'), 0);
});
