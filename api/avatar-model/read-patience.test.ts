import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { modelCreationFixture } from './_creation-config.fixture.js';

// Modal can queue a portrait check behind other players' (one queued 11 minutes on 2026-11-20). A check
// that lapsed after 15 minutes started a second Modal call for the same portrait and counted a second check.
test('a portrait check Modal still holds stays the same check, up to two hours', async t => {
    Object.assign(process.env, modelCreationFixture, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1',
        SESSION_SECRET: 'local-portrait-patience-test-session-secret' });
    const start = Date.UTC(2026, 10, 20, 2, 34);
    t.mock.timers.enable({ apis: ['Date'], now: start });
    const { kv } = await import('../_storage.js');
    const { perImageKey } = await import('../images.js');
    const { checkPlayerPortrait, READ_PATIENCE_MS } = await import('./read.js');
    const source = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#cba' } }).png().toBuffer();
    const owner = 'patientplayer';
    await kv.set('save:' + owner, { character: { name: owner, patreon: { active: true, source: 'promo', tier: 'supporter' } } });
    await kv.set(perImageKey('avatar:' + owner), 'data:image/png;base64,' + source.toString('base64'));
    const operations: string[] = [];
    const ports = {
        moderate: async (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex'),
        read: async (operation: string) => { operations.push(operation); return { status: 'pending' as const }; },
        seal: async () => { throw new Error('a pending check never seals'); },
    };
    const row = async () => {
        const [key] = await kv.keys('avatar-model:screen:' + owner + ':*');
        return kv.get<{ operation: string; expiresAt: number; startedAt: number }>(key!);
    };
    const day = 'avatar-model:read-day:2026-11-20';

    assert.deepEqual(await checkPlayerPortrait(owner, ports), { state: 'pending' });
    const first = await row();
    assert.equal(first?.startedAt, start);
    assert.equal(first.expiresAt, start + 15 * 60_000);

    // Still queued at 12 minutes: the same check now runs until 27 minutes.
    t.mock.timers.setTime(start + 12 * 60_000);
    assert.deepEqual(await checkPlayerPortrait(owner, ports), { state: 'pending' });
    assert.equal((await row())?.expiresAt, start + 27 * 60_000);
    // Far from its end, a poll does not rewrite it.
    t.mock.timers.setTime(start + 13 * 60_000);
    assert.deepEqual(await checkPlayerPortrait(owner, ports), { state: 'pending' });
    assert.equal((await row())?.expiresAt, start + 27 * 60_000);

    // Kept alive poll by poll, it never passes two hours from its start.
    for (let minute = 24; minute < 120; minute += 11) {
        t.mock.timers.setTime(start + minute * 60_000);
        assert.deepEqual(await checkPlayerPortrait(owner, ports), { state: 'pending' });
    }
    assert.equal((await row())?.expiresAt, start + READ_PATIENCE_MS);
    assert.deepEqual(new Set(operations), new Set([first.operation]), 'one Modal operation the whole time');
    assert.equal(await kv.get(day), 1, 'one check counted');

    // Past two hours it lapses, and the next poll starts a fresh check.
    t.mock.timers.setTime(start + READ_PATIENCE_MS + 60_000);
    assert.deepEqual(await checkPlayerPortrait(owner, ports), { state: 'pending' });
    const fresh = await row();
    assert.notEqual(fresh?.operation, first.operation);
    assert.equal(fresh.expiresAt, start + READ_PATIENCE_MS + 16 * 60_000);
    assert.equal(await kv.get(day), 2);
});
