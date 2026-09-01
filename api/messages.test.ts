import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    messagesAfterDeletion,
    removeInboxConversation,
    threadKey,
    upsertInbox,
    type DmMessage,
    type InboxEntry,
} from './messages.js';

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

describe('conversation deletion helpers', () => {
    it('removes the deleted partner while preserving unrelated conversations', () => {
        const inbox: InboxEntry[] = [
            { with: 'bob', lastTs: 100, lastText: 'old', unread: 2 },
            { with: 'carol', lastTs: 90, lastText: 'hello', unread: 0 },
        ];
        assert.deepEqual(removeInboxConversation(inbox, 'BOB', 100), [inbox[1]]);
    });

    it('keeps a message that arrived after the deletion cutoff', () => {
        const fresh: InboxEntry = { with: 'bob', lastTs: 101, lastText: 'new', unread: 1 };
        assert.deepEqual(removeInboxConversation([fresh], 'bob', 100), [fresh]);
    });

    it('hides prior thread history but shows messages after deletion', () => {
        const messages: DmMessage[] = [
            { from: 'alice', text: 'old', ts: 99 },
            { from: 'bob', text: 'at cutoff', ts: 100 },
            { from: 'alice', text: 'new', ts: 101 },
        ];
        assert.deepEqual(messagesAfterDeletion(messages, 100), [messages[2]]);
    });
});
