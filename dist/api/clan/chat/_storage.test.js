"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _storage_js_1 = require("./_storage.js");
function msg(ts, text = 'hi') {
    return { id: `${ts}`, name: 'A', text, ts };
}
(0, node_test_1.describe)('clan chat storage', () => {
    (0, node_test_1.it)('appendChatMessage caps the ring buffer at CLAN_CHAT_MAX_MESSAGES (oldest dropped)', () => {
        let buf = [];
        for (let i = 1; i <= _storage_js_1.CLAN_CHAT_MAX_MESSAGES + 10; i++)
            buf = (0, _storage_js_1.appendChatMessage)(buf, msg(i));
        node_assert_1.strict.equal(buf.length, _storage_js_1.CLAN_CHAT_MAX_MESSAGES);
        node_assert_1.strict.equal(buf[0].ts, 11, 'first 10 messages dropped');
        node_assert_1.strict.equal(buf[buf.length - 1].ts, _storage_js_1.CLAN_CHAT_MAX_MESSAGES + 10);
    });
    (0, node_test_1.it)('appendChatMessage tolerates a null/undefined starting buffer', () => {
        node_assert_1.strict.deepEqual((0, _storage_js_1.appendChatMessage)(null, msg(1)).map(m => m.ts), [1]);
        node_assert_1.strict.deepEqual((0, _storage_js_1.appendChatMessage)(undefined, msg(2)).map(m => m.ts), [2]);
    });
    (0, node_test_1.it)('messagesSince returns only strictly-newer messages; since<=0 returns all', () => {
        const buf = [msg(10), msg(20), msg(30)];
        node_assert_1.strict.deepEqual((0, _storage_js_1.messagesSince)(buf, 15).map(m => m.ts), [20, 30]);
        node_assert_1.strict.deepEqual((0, _storage_js_1.messagesSince)(buf, 30).map(m => m.ts), []);
        node_assert_1.strict.deepEqual((0, _storage_js_1.messagesSince)(buf, 0).map(m => m.ts), [10, 20, 30]);
        node_assert_1.strict.deepEqual((0, _storage_js_1.messagesSince)(null, 5), []);
    });
    (0, node_test_1.it)('cleanChatText trims, rejects empty, and censors slur content', () => {
        node_assert_1.strict.equal((0, _storage_js_1.cleanChatText)('  hello team  '), 'hello team');
        node_assert_1.strict.equal((0, _storage_js_1.cleanChatText)('   '), null, 'whitespace-only rejected');
        node_assert_1.strict.equal((0, _storage_js_1.cleanChatText)(''), null);
        node_assert_1.strict.equal((0, _storage_js_1.cleanChatText)(undefined), null);
        const censored = (0, _storage_js_1.cleanChatText)('you nigger');
        node_assert_1.strict.ok(censored && !/nigger/i.test(censored), `slur should be censored, got "${censored}"`);
    });
    (0, node_test_1.it)('cleanChatText caps overly long input rather than rejecting it', () => {
        const long = 'a'.repeat(5000);
        const out = (0, _storage_js_1.cleanChatText)(long);
        node_assert_1.strict.ok(out && out.length <= 500, `expected <=500 chars, got ${out?.length}`);
    });
});
