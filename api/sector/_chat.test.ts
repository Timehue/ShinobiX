import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    freshSectorChat,
    isSectorChatSector,
    sectorChatSince,
    SECTOR_CHAT_KEEP,
    SECTOR_CHAT_LIFETIME_MS,
    SECTOR_CHAT_MAX_CHARS,
    type SectorChatMessage,
} from '../../shared/sector-chat.js';
import { FESTIVAL_SECTOR, MAX_WILD_SECTOR } from '../../shared/sector-geo.js';
import { appendSectorChat, cleanSectorChatText, sectorChatKey, withoutBlockedAuthors } from './_chat.js';

const line = (id: string, ts: number, name = 'Kaze'): SectorChatMessage => ({ id, name, text: `line ${id}`, ts });

describe('sector chat rules', () => {
    it('opens on every walkable wild board and Death\'s Gate, and nowhere else', () => {
        for (let sector = 1; sector <= MAX_WILD_SECTOR; sector++) {
            assert.equal(isSectorChatSector(sector), sector !== FESTIVAL_SECTOR, `sector ${sector}`);
        }
        assert.equal(isSectorChatSector(99), true);
        for (const bad of [0, -1, MAX_WILD_SECTOR + 1, 98, 1.5, '12', null, undefined, Number.NaN]) {
            assert.equal(isSectorChatSector(bad), false, `rejects ${String(bad)}`);
        }
    });

    it('keys one row per sector', () => {
        assert.equal(sectorChatKey(12), 'chat:sector:12');
    });

    it('moderates like the other chats and caps at the sector limit', () => {
        assert.equal(cleanSectorChatText('   '), null);
        assert.equal(cleanSectorChatText(42), null);
        assert.equal(cleanSectorChatText('  Anyone heading north?  '), 'Anyone heading north?');
        assert.equal(cleanSectorChatText('x'.repeat(SECTOR_CHAT_MAX_CHARS + 50))!.length, SECTOR_CHAT_MAX_CHARS);
    });

    it('keeps the newest lines and drops expired ones on append', () => {
        const now = 10_000_000;
        const stale = line('old', now - SECTOR_CHAT_LIFETIME_MS - 1);
        const full = Array.from({ length: SECTOR_CHAT_KEEP }, (_, i) => line(`m${i}`, now - 1000 + i));
        const next = appendSectorChat([stale, ...full], line('new', now), now);
        assert.equal(next.length, SECTOR_CHAT_KEEP);
        assert.equal(next.at(-1)!.id, 'new');
        assert.ok(!next.some((m) => m.id === 'old'), 'an expired line never survives an append');
        assert.equal(next[0].id, 'm1', 'the oldest live line falls off the cap');
        assert.deepEqual(appendSectorChat(null, line('first', now), now).map((m) => m.id), ['first']);
    });

    it('reads only live lines, and only those past the cursor', () => {
        const now = 50_000_000;
        const lines = [line('a', now - SECTOR_CHAT_LIFETIME_MS), line('b', now - 5000), line('c', now - 10)];
        const live = freshSectorChat(lines, now);
        assert.deepEqual(live.map((m) => m.id), ['b', 'c']);
        assert.deepEqual(sectorChatSince(live, now - 5000).map((m) => m.id), ['c']);
        assert.deepEqual(sectorChatSince(live, 0).map((m) => m.id), ['b', 'c']);
        assert.deepEqual(freshSectorChat(null, now), []);
    });

    it('hides authors the reader blocked, matching names the way blocks store them', () => {
        const lines = [line('a', 1, 'Kaze'), line('b', 2, 'Rin Tohsaka'), line('c', 3, 'Mira')];
        assert.deepEqual(withoutBlockedAuthors(lines, ['kaze']).map((m) => m.id), ['b', 'c']);
        assert.deepEqual(withoutBlockedAuthors(lines, []).map((m) => m.id), ['a', 'b', 'c']);
    });
});
