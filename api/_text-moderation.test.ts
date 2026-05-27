import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeUserText, isCleanText, TEXT_LIMITS } from './_text-moderation.js';

describe('sanitizeUserText', () => {
    it('returns empty string for non-strings', () => {
        assert.equal(sanitizeUserText(null, 10), '');
        assert.equal(sanitizeUserText(undefined, 10), '');
        assert.equal(sanitizeUserText(42 as unknown, 10), '');
    });

    it('preserves a clean string', () => {
        assert.equal(sanitizeUserText('hello world', 100), 'hello world');
    });

    it('caps length at maxLen', () => {
        const long = 'x'.repeat(500);
        assert.equal(sanitizeUserText(long, 50).length, 50);
    });

    it('redacts email addresses', () => {
        const out = sanitizeUserText('contact me at foo@bar.com please', 200);
        assert.ok(out.includes('[redacted email]'));
        assert.ok(!out.includes('foo@bar.com'));
    });

    it('redacts URLs', () => {
        const out = sanitizeUserText('check https://evil.example/foo', 200);
        assert.ok(out.includes('[redacted link]'));
        assert.ok(!out.includes('evil.example'));
    });

    it('redacts phone numbers', () => {
        const out = sanitizeUserText('call me at +1 555-123-4567', 200);
        assert.ok(out.includes('[redacted #]'));
    });

    it('masks profanity with asterisks', () => {
        const out = sanitizeUserText('you are a whore', 200);
        assert.ok(out.includes('*'), `expected mask in ${out}`);
        assert.ok(!out.toLowerCase().includes('whore'));
    });

    it('does NOT mask grey-area swears like ass in assassin', () => {
        const out = sanitizeUserText('I am an assassin', 200);
        assert.equal(out, 'I am an assassin');
    });

    it('catches leetspeak bypass attempts', () => {
        // "n!gger" with ! → i normalizes to "nigger" → blocked.
        assert.equal(isCleanText('n!gger'), false);
        assert.equal(isCleanText('n1gger'), false);
        assert.equal(isCleanText('n|gger'), false);
    });

    it('catches whitespace-separation bypass', () => {
        assert.equal(isCleanText('n i g g e r'), false);
    });

    it('catches repeat-char bypass', () => {
        // niiigger → collapse repeats → nigger → blocked.
        assert.equal(isCleanText('niiigger'), false);
    });

    it('passes innocent strings', () => {
        assert.equal(isCleanText('Hidden Leaf Village'), true);
        assert.equal(isCleanText('Crimson Dragons'), true);
        assert.equal(isCleanText('Title with numbers 123'), true);
    });
});

describe('TEXT_LIMITS', () => {
    it('clanName cap is sane', () => {
        // 32 chars covers any realistic clan name; longer would inflate the
        // KV keyspace via clan-<slug>.
        assert.ok(TEXT_LIMITS.clanName >= 16 && TEXT_LIMITS.clanName <= 64);
    });
    it('chatMessage cap is sane', () => {
        assert.ok(TEXT_LIMITS.chatMessage >= 100 && TEXT_LIMITS.chatMessage <= 1000);
    });
});
