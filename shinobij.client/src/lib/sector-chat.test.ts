import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_CHAT_KEEP, type SectorChatMessage } from '../../../shared/sector-chat';
import { mergeSectorChat, sectorChatAge, sectorChatCursor, sectorChatLayoutFor, shapeSectorChat, unreadSectorChat } from './sector-chat';
import { fetchSectorChat, resetSectorChatAvailability, sectorChatUnavailable, sendSectorChat } from './sector-chat-api';

const line = (id: string, ts: number, name = 'Kaze', text = `line ${id}`): SectorChatMessage => ({ id, name, text, ts });
const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
    resetSectorChatAvailability();
});

function fakeFetch(status: number, body: unknown, calls: string[] = []) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return calls;
}

describe('sector chat merging', () => {
    it('dedupes by id, keeps time order and caps at the shared limit', () => {
        const merged = mergeSectorChat([line('b', 20), line('a', 10)].sort((x, y) => x.ts - y.ts), [line('c', 30), line('b', 20)]);
        assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
        const flood = Array.from({ length: SECTOR_CHAT_KEEP + 5 }, (_, i) => line(`m${i}`, i));
        const capped = mergeSectorChat([], flood);
        assert.equal(capped.length, SECTOR_CHAT_KEEP);
        assert.equal(capped[0].id, 'm5');
    });

    it('hands back the same array when nothing arrived, so React can skip the render', () => {
        const current = [line('a', 1)];
        assert.equal(mergeSectorChat(current, []), current);
    });

    it('places a line that was stored late in its true position', () => {
        const merged = mergeSectorChat([line('a', 10), line('c', 30)], [line('b', 20)]);
        assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
        assert.equal(sectorChatCursor(merged), 30);
        assert.equal(sectorChatCursor([]), 0);
    });
});

describe('sector chat display', () => {
    it('marks the viewer\'s own lines regardless of name casing', () => {
        const shaped = shapeSectorChat([line('a', 1, 'Kaze'), line('b', 2, 'Mira')], 'kaze');
        assert.deepEqual(shaped.map((l) => l.own), [true, false]);
        assert.deepEqual(shapeSectorChat([line('a', 1)], '').map((l) => l.own), [false]);
    });

    it('groups a burst from one speaker and breaks it on a new speaker or a long pause', () => {
        const shaped = shapeSectorChat([
            line('a', 0, 'Kaze'), line('b', 30_000, 'kaze'), line('c', 60_000, 'Mira'),
            line('d', 90_000, 'Mira'), line('e', 90_000 + 4 * 60_000, 'Mira'),
        ], 'Rin');
        assert.deepEqual(shaped.map((l) => l.continued), [false, true, false, true, false]);
    });

    it('counts unread lines from other people only', () => {
        const lines = [line('a', 10, 'Kaze'), line('b', 20, 'Mira'), line('c', 30, 'Kaze'), line('d', 40, 'Rin')];
        assert.equal(unreadSectorChat(lines, 15, 'Kaze'), 2);
        assert.equal(unreadSectorChat(lines, 40, 'Kaze'), 0);
    });

    it('words ages short enough to sit beside a name', () => {
        const now = 10_000_000;
        assert.equal(sectorChatAge(now - 5_000, now), 'now');
        assert.equal(sectorChatAge(now + 5_000, now), 'now');
        assert.equal(sectorChatAge(now - 50_000, now), '1m');
        assert.equal(sectorChatAge(now - 14 * 60_000, now), '14m');
        assert.equal(sectorChatAge(now - 61 * 60_000, now), '1h');
    });
});

describe('sector chat layout', () => {
    it('picks from the column the HUD measured (heights from the real HUD, 2026-10-04)', () => {
        assert.equal(sectorChatLayoutFor(747, null), 'roomy');   // 1920x1080
        assert.equal(sectorChatLayoutFor(404, null), 'roomy');   // 1366x768
        assert.equal(sectorChatLayoutFor(204, null), 'compact'); // 390x844
        assert.equal(sectorChatLayoutFor(112, null), 'compact'); // 768x1024
        assert.equal(sectorChatLayoutFor(41, null), 'tight');    // 375x667
        assert.equal(sectorChatLayoutFor(28, null), 'tight');    // 360x640
    });

    it('does not flap while the column settles a few pixels either side of a boundary', () => {
        assert.equal(sectorChatLayoutFor(350, 'roomy'), 'roomy');
        assert.equal(sectorChatLayoutFor(329, 'roomy'), 'compact');
        assert.equal(sectorChatLayoutFor(380, 'compact'), 'compact');
        assert.equal(sectorChatLayoutFor(390, 'compact'), 'roomy');
        assert.equal(sectorChatLayoutFor(105, 'tight'), 'tight');
        assert.equal(sectorChatLayoutFor(110, 'tight'), 'compact');
        assert.equal(sectorChatLayoutFor(95, 'compact'), 'compact');
        assert.equal(sectorChatLayoutFor(89, 'compact'), 'tight');
    });
});

describe('sector chat client calls', () => {
    it('reads with a cursor and returns the server clock', async () => {
        const calls = fakeFetch(200, { messages: [line('a', 5)], now: 1234 });
        const read = await fetchSectorChat(12, 99.7);
        assert.deepEqual(calls, ['GET /api/sector/chat?sector=12&since=99']);
        assert.equal(read.ok, true);
        if (read.ok) { assert.equal(read.now, 1234); assert.equal(read.messages.length, 1); }
    });

    it('latches a 404 so the panel stops asking for the rest of the session', async () => {
        fakeFetch(404, { error: 'Sector chat is unavailable.', disabled: true });
        const read = await fetchSectorChat(12, 0);
        assert.equal(read.ok, false);
        assert.equal(sectorChatUnavailable(), true);
    });

    it('surfaces the refusal details the panel words for the player', async () => {
        fakeFetch(429, { error: 'Slow down.', retryAfterMs: 4200 });
        const limited = await sendSectorChat(12, 'hi');
        assert.equal(limited.ok, false);
        if (!limited.ok) { assert.equal(limited.status, 429); assert.equal(limited.retryAfterMs, 4200); }

        fakeFetch(403, { error: 'You are silenced.', silence: { until: 777, reason: 'x' } });
        const silenced = await sendSectorChat(12, 'hi');
        assert.equal(!silenced.ok && silenced.silencedUntil, 777);
        assert.equal(sectorChatUnavailable(), false, 'only a 404 latches');
    });

    it('posts the sector and text, and returns the stamped line', async () => {
        const calls = fakeFetch(200, { ok: true, message: line('z', 9, 'Kaze', 'hello') });
        const sent = await sendSectorChat(12, 'hello');
        assert.deepEqual(calls, ['POST /api/sector/chat']);
        assert.equal(sent.ok && sent.message.text, 'hello');
    });

    it('turns a dropped connection into a refusal instead of throwing', async () => {
        globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
        const read = await fetchSectorChat(12, 0);
        assert.equal(read.ok, false);
        if (!read.ok) assert.equal(read.status, 0);
    });
});
