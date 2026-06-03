"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const messages_js_1 = require("./messages.js");
(0, node_test_1.describe)('threadKey', () => {
    (0, node_test_1.it)('is order-independent (same key regardless of who sends)', () => {
        node_assert_1.strict.equal((0, messages_js_1.threadKey)('Alice', 'Bob'), (0, messages_js_1.threadKey)('Bob', 'Alice'));
    });
    (0, node_test_1.it)('lowercases and trims participant names', () => {
        node_assert_1.strict.equal((0, messages_js_1.threadKey)('  ALICE ', 'bob'), 'dm:thread:alice|bob');
    });
});
(0, node_test_1.describe)('upsertInbox', () => {
    (0, node_test_1.it)('inserts a new conversation at the front', () => {
        const out = (0, messages_js_1.upsertInbox)([], { with: 'bob', lastTs: 100, lastText: 'hi', unread: 1 });
        node_assert_1.strict.equal(out.length, 1);
        node_assert_1.strict.equal(out[0].with, 'bob');
    });
    (0, node_test_1.it)('de-dupes by partner (case-insensitive) and keeps the newest summary', () => {
        const start = [{ with: 'bob', lastTs: 100, lastText: 'old', unread: 1 }];
        const out = (0, messages_js_1.upsertInbox)(start, { with: 'BOB', lastTs: 200, lastText: 'new', unread: 2 });
        node_assert_1.strict.equal(out.length, 1);
        node_assert_1.strict.equal(out[0].lastText, 'new');
        node_assert_1.strict.equal(out[0].unread, 2);
    });
    (0, node_test_1.it)('sorts conversations newest-first', () => {
        let inbox = [];
        inbox = (0, messages_js_1.upsertInbox)(inbox, { with: 'a', lastTs: 100, lastText: 'a', unread: 0 });
        inbox = (0, messages_js_1.upsertInbox)(inbox, { with: 'b', lastTs: 300, lastText: 'b', unread: 0 });
        inbox = (0, messages_js_1.upsertInbox)(inbox, { with: 'c', lastTs: 200, lastText: 'c', unread: 0 });
        node_assert_1.strict.deepEqual(inbox.map((e) => e.with), ['b', 'c', 'a']);
    });
    (0, node_test_1.it)('caps the inbox at the given max', () => {
        let inbox = [];
        for (let i = 0; i < 10; i++) {
            inbox = (0, messages_js_1.upsertInbox)(inbox, { with: `u${i}`, lastTs: i, lastText: 'x', unread: 0 }, 3);
        }
        node_assert_1.strict.equal(inbox.length, 3);
    });
    (0, node_test_1.it)('tolerates a non-array starting inbox', () => {
        const out = (0, messages_js_1.upsertInbox)(undefined, { with: 'bob', lastTs: 1, lastText: 'hi', unread: 0 });
        node_assert_1.strict.equal(out.length, 1);
    });
});
