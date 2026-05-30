"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _text_moderation_js_1 = require("./_text-moderation.js");
(0, node_test_1.describe)('sanitizeUserText', () => {
    (0, node_test_1.it)('returns empty string for non-strings', () => {
        node_assert_1.strict.equal((0, _text_moderation_js_1.sanitizeUserText)(null, 10), '');
        node_assert_1.strict.equal((0, _text_moderation_js_1.sanitizeUserText)(undefined, 10), '');
        node_assert_1.strict.equal((0, _text_moderation_js_1.sanitizeUserText)(42, 10), '');
    });
    (0, node_test_1.it)('preserves a clean string', () => {
        node_assert_1.strict.equal((0, _text_moderation_js_1.sanitizeUserText)('hello world', 100), 'hello world');
    });
    (0, node_test_1.it)('caps length at maxLen', () => {
        const long = 'x'.repeat(500);
        node_assert_1.strict.equal((0, _text_moderation_js_1.sanitizeUserText)(long, 50).length, 50);
    });
    (0, node_test_1.it)('redacts email addresses', () => {
        const out = (0, _text_moderation_js_1.sanitizeUserText)('contact me at foo@bar.com please', 200);
        node_assert_1.strict.ok(out.includes('[redacted email]'));
        node_assert_1.strict.ok(!out.includes('foo@bar.com'));
    });
    (0, node_test_1.it)('redacts URLs', () => {
        const out = (0, _text_moderation_js_1.sanitizeUserText)('check https://evil.example/foo', 200);
        node_assert_1.strict.ok(out.includes('[redacted link]'));
        node_assert_1.strict.ok(!out.includes('evil.example'));
    });
    (0, node_test_1.it)('redacts phone numbers', () => {
        const out = (0, _text_moderation_js_1.sanitizeUserText)('call me at +1 555-123-4567', 200);
        node_assert_1.strict.ok(out.includes('[redacted #]'));
    });
    (0, node_test_1.it)('masks profanity with asterisks', () => {
        const out = (0, _text_moderation_js_1.sanitizeUserText)('you are a whore', 200);
        node_assert_1.strict.ok(out.includes('*'), `expected mask in ${out}`);
        node_assert_1.strict.ok(!out.toLowerCase().includes('whore'));
    });
    (0, node_test_1.it)('does NOT mask grey-area swears like ass in assassin', () => {
        const out = (0, _text_moderation_js_1.sanitizeUserText)('I am an assassin', 200);
        node_assert_1.strict.equal(out, 'I am an assassin');
    });
    (0, node_test_1.it)('catches leetspeak bypass attempts', () => {
        // "n!gger" with ! → i normalizes to "nigger" → blocked.
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('n!gger'), false);
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('n1gger'), false);
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('n|gger'), false);
    });
    (0, node_test_1.it)('catches whitespace-separation bypass', () => {
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('n i g g e r'), false);
    });
    (0, node_test_1.it)('catches repeat-char bypass', () => {
        // niiigger → collapse repeats → nigger → blocked.
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('niiigger'), false);
    });
    (0, node_test_1.it)('passes innocent strings', () => {
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('Hidden Leaf Village'), true);
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('Crimson Dragons'), true);
        node_assert_1.strict.equal((0, _text_moderation_js_1.isCleanText)('Title with numbers 123'), true);
    });
});
(0, node_test_1.describe)('TEXT_LIMITS', () => {
    (0, node_test_1.it)('clanName cap is sane', () => {
        // 32 chars covers any realistic clan name; longer would inflate the
        // KV keyspace via clan-<slug>.
        node_assert_1.strict.ok(_text_moderation_js_1.TEXT_LIMITS.clanName >= 16 && _text_moderation_js_1.TEXT_LIMITS.clanName <= 64);
    });
    (0, node_test_1.it)('chatMessage cap is sane', () => {
        node_assert_1.strict.ok(_text_moderation_js_1.TEXT_LIMITS.chatMessage >= 100 && _text_moderation_js_1.TEXT_LIMITS.chatMessage <= 1000);
    });
});
