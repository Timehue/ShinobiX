process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The heartbeat's one-shot offline-notice delivery. The old clear was an
// unlocked, unconditional `kv.del(noticesKey)` whenever the read was non-null,
// so a notice pushed between the mget and the delete — "you were KO'd by X", "a
// bounty was placed on you", "your Kage stake was refunded" — was destroyed
// unread and the player never learned why their state changed.

let kv: typeof import('../_storage.js').kv;
let notices: typeof import('./_offline-notices.js');
let beat: { consumeDeliveredNotices: (key: string, delivered: readonly import('./_offline-notices.js').OfflineNotice[]) => Promise<void> };

const PLAYER = 'beat-target';
const NOW = Date.UTC(2026, 7, 22, 6, 0, 0);

before(async () => {
    ({ kv } = await import('../_storage.js'));
    notices = await import('./_offline-notices.js');
    beat = await import('./heartbeat.js');
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });
beforeEach(async () => { await kv.del(notices.offlineNoticesKey(PLAYER)); });

const key = () => notices.offlineNoticesKey(PLAYER);
const inbox = async () => notices.parseOfflineNotices(await kv.get(key()));

test('the happy path is one-shot: everything delivered is cleared and the key is dropped', async () => {
    await notices.pushOfflineNotice(PLAYER, { kind: 'sleeper-kill', by: 'Raider', village: 'V', sector: 7, at: NOW });
    await notices.pushOfflineNotice(PLAYER, { kind: 'bounty-placed', by: 'Rival', sector: 0, at: NOW + 1, amount: 500, total: 500 });
    const delivered = await inbox();
    assert.equal(delivered.length, 2);

    await beat.consumeDeliveredNotices(key(), delivered);
    assert.deepEqual(await inbox(), []);
    assert.equal(await kv.get(key()), null, 'the inbox key is gone, not left as an empty array');
});

test('a notice pushed MID-BEAT survives the clear and is delivered on the next beat', async () => {
    await notices.pushOfflineNotice(PLAYER, { kind: 'sleeper-kill', by: 'Raider', village: 'V', sector: 7, at: NOW });
    const delivered = await inbox();          // what this beat's mget saw

    // …and the raid that lands while the response is being built.
    await notices.pushOfflineNotice(PLAYER, { kind: 'merc-raid', by: 'V mercenaries', village: 'V', sector: 9, at: NOW + 50 });

    await beat.consumeDeliveredNotices(key(), delivered);
    const left = await inbox();
    assert.equal(left.length, 1, 'the mid-beat notice is NOT destroyed');
    assert.equal(left[0].kind, 'merc-raid');
    assert.equal(left[0].at, NOW + 50);

    // The next beat delivers it and clears cleanly.
    await beat.consumeDeliveredNotices(key(), left);
    assert.equal(await kv.get(key()), null);
});

test('clearing an empty delivery never touches the inbox', async () => {
    await notices.pushOfflineNotice(PLAYER, { kind: 'kage-challenge-refunded', by: 'inactivity', village: 'V', sector: 0, at: NOW, amount: 250_000 });
    await beat.consumeDeliveredNotices(key(), []);
    assert.equal((await inbox()).length, 1, 'a beat that read nothing cannot delete what arrived after it');
});

test('two notices that differ only by amount are distinguished (no over-deletion)', async () => {
    await notices.pushOfflineNotice(PLAYER, { kind: 'bounty-placed', by: 'Rival', sector: 0, at: NOW, amount: 100, total: 100 });
    const delivered = await inbox();
    await notices.pushOfflineNotice(PLAYER, { kind: 'bounty-placed', by: 'Rival', sector: 0, at: NOW, amount: 900, total: 1_000 });
    await beat.consumeDeliveredNotices(key(), delivered);
    const left = await inbox();
    assert.equal(left.length, 1);
    assert.equal(left[0].amount, 900);
});
