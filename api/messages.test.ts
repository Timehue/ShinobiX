import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { threadKey, upsertInbox, type InboxEntry } from './messages.js';

describe('threadKey', () => {
    it('is order-independent (same key regardless of who sends)', () => {
        assert.equal(threadKey('Alice', 'Bob'), threadKey('Bob', 'Alice'));
    });
    it('lowercases and trims participant names', () => {
        assert.equal(threadKey('  ALICE ', 'bob'), 'dm:thread:alice|bob');
    });
});

describe('upsertInbox', () => {
    it('inserts a new conversation at the front', () => {
        const out = upsertInbox([], { with: 'bob', lastTs: 100, lastText: 'hi', unread: 1 });
        assert.equal(out.length, 1);
        assert.equal(out[0]!.with, 'bob');
    });

    it('de-dupes by partner (case-insensitive) and keeps the newest summary', () => {
        const start: InboxEntry[] = [{ with: 'bob', lastTs: 100, lastText: 'old', unread: 1 }];
        const out = upsertInbox(start, { with: 'BOB', lastTs: 200, lastText: 'new', unread: 2 });
        assert.equal(out.length, 1);
        assert.equal(out[0]!.lastText, 'new');
        assert.equal(out[0]!.unread, 2);
    });

    it('sorts conversations newest-first', () => {
        let inbox: InboxEntry[] = [];
        inbox = upsertInbox(inbox, { with: 'a', lastTs: 100, lastText: 'a', unread: 0 });
        inbox = upsertInbox(inbox, { with: 'b', lastTs: 300, lastText: 'b', unread: 0 });
        inbox = upsertInbox(inbox, { with: 'c', lastTs: 200, lastText: 'c', unread: 0 });
        assert.deepEqual(inbox.map((e) => e.with), ['b', 'c', 'a']);
    });

    it('caps the inbox at the given max', () => {
        let inbox: InboxEntry[] = [];
        for (let i = 0; i < 10; i++) {
            inbox = upsertInbox(inbox, { with: `u${i}`, lastTs: i, lastText: 'x', unread: 0 }, 3);
        }
        assert.equal(inbox.length, 3);
    });

    it('tolerates a non-array starting inbox', () => {
        const out = upsertInbox(undefined as unknown as InboxEntry[], { with: 'bob', lastTs: 1, lastText: 'hi', unread: 0 });
        assert.equal(out.length, 1);
    });
});
