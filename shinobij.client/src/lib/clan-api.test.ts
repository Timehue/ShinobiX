import assert from 'node:assert/strict';
import test from 'node:test';
import { writeClanData, writeClanUpdate } from './clan-api';
import type { ClanData } from '../types/clan';

function captureWrites() {
    const oldFetch = globalThis.fetch;
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response('{}');
    }) as typeof fetch;
    return { sent, restore: () => { globalThis.fetch = oldFetch; } };
}

const clan = { name: 'Storm Leaf', village: 'Leaf', founderName: 'Kaze', members: [], treasury: { ryo: 15, items: [] } } as unknown as ClanData;

test('an update to an existing clan never replays the treasury', async () => {
    // The Clan Hall's copy was loaded when the hall opened. Sending its
    // treasury would assert figures from before another member's donation.
    const writes = captureWrites();
    try {
        await writeClanUpdate({ ...clan, recruitment: 'Recruiting.' } as ClanData);
        assert.equal(writes.sent.length, 1);
        assert.equal(writes.sent[0].url, '/api/save/clan-stormleaf');
        assert.equal(Object.hasOwn(writes.sent[0].body, 'treasury'), false);
        assert.equal(writes.sent[0].body.recruitment, 'Recruiting.', 'the rest of the write still goes out');
    } finally { writes.restore(); }
});

test('founding a clan still sends its starting treasury', async () => {
    const writes = captureWrites();
    try {
        await writeClanData(clan);
        assert.deepEqual(writes.sent[0].body.treasury, { ryo: 15, items: [] });
    } finally { writes.restore(); }
});
