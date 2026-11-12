import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelCreationFixture } from '../avatar-model/_creation-config.fixture.js';

test('public world layout advertises Make Model only while the static intake configuration is ready', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', ...modelCreationFixture });
    const handler = (await import('./sector-layout.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    async function get() {
        let body: Record<string, unknown> = {};
        let status = 0;
        const res = {
            setHeader() {},
            status(code: number) { status = code; return res; },
            json(value: typeof body) { body = value; },
        };
        await handler({ method: 'GET', headers: {} } as never, res as never);
        assert.equal(status, 200);
        return body;
    }
    const available = await get();
    assert.equal(available.worldModelCreationAvailable, true);
    assert.equal(typeof available.modelArtBase, 'string');
    assert.equal(available.playerGaitsEnabled, true);
    const publicKeys = new Set(['obstaclesEnabled', 'modelArtBase', 'profileDetailUploads',
        'playerGaitsEnabled', 'worldModelCreationAvailable']);
    assert.ok(Object.keys(available).every(key => publicKeys.has(key)));
    for (const key of ['AVATAR_MODEL_DISPATCH_ENABLED', 'AVATAR_MODEL_CLEANUP_ENABLED', 'AVATAR_MODEL_MODAL_TOKEN_SECRET'] as const) {
        process.env[key] = '';
        assert.equal((await get()).worldModelCreationAvailable, undefined);
        process.env[key] = modelCreationFixture[key];
    }
    process.env.AVATAR_MODEL_KILL_SWITCH = '1';
    const paused = await get();
    assert.equal(paused.worldModelCreationAvailable, undefined);
    assert.equal(paused.modelArtBase, available.modelArtBase);
    assert.equal(paused.playerGaitsEnabled, true);
    process.env.ENABLE_SECTOR_MODEL_DISPLAY = '0';
    const hidden = await get();
    assert.equal(hidden.modelArtBase, null);
    assert.equal(hidden.playerGaitsEnabled, false);
    delete process.env.ENABLE_SECTOR_MODEL_DISPLAY;
    delete process.env.R2_PUBLIC_BASE;
    const withoutArtHost = await get();
    assert.equal(withoutArtHost.modelArtBase, null);
    assert.equal(withoutArtHost.playerGaitsEnabled, false);
});
