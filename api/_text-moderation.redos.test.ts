import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUserText, TEXT_LIMITS } from './_text-moderation.js';

/*
 * sanitizeUserText runs on DMs, chat lines, notices and titles straight from
 * request bodies of up to 5 MB. Its email pattern was `[\w.+-]+@…` with no
 * bound, which re-scans the whole word run from every start position: a 20k
 * character line with no '@' blocked the single Node process for ~0.9 s, and
 * a 1 MB DM would have frozen the game for tens of minutes.
 */

test('sanitizeUserText: a megabyte of word characters is handled in linear time', () => {
    const started = performance.now();
    const out = sanitizeUserText('a'.repeat(1_000_000), TEXT_LIMITS.chatMessage);
    const elapsed = performance.now() - started;
    assert.equal(out.length, TEXT_LIMITS.chatMessage);
    assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
});

test('sanitizeUserText: the old quadratic input is fast even within the scan window', () => {
    // 20k characters took ~900 ms on the unbounded pattern. With no maxLen cut
    // at all (a huge limit), the bounded pattern must still be linear.
    const started = performance.now();
    sanitizeUserText('a'.repeat(20_000), 1_000_000);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 250, `took ${elapsed.toFixed(0)} ms`);
});

test('sanitizeUserText: a repeated blocklist letter after a hit stays fast', () => {
    // The fuzzy mask regex (`w+\\W*h+…`) is also super-linear on a long run of
    // the first letter; the scan window bounds it.
    const started = performance.now();
    sanitizeUserText(`whore ${'w'.repeat(500_000)}`, TEXT_LIMITS.chatMessage);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
});

test('sanitizeUserText: emails, links and phone numbers are still redacted', () => {
    const out = sanitizeUserText('mail me at kai.storm+x@example.co.uk or www.example.com or +1 (555) 123-4567', TEXT_LIMITS.chatMessage);
    assert.ok(!out.includes('example.co.uk'), out);
    assert.match(out, /\[redacted email\]/);
    assert.match(out, /\[redacted link\]/);
    assert.match(out, /\[redacted #\]/);
});

test('sanitizeUserText: a message under the limit is unchanged by the scan window', () => {
    const line = 'Meet at the Sunscar gate after the raid. '.repeat(10).trim();
    assert.equal(sanitizeUserText(line, TEXT_LIMITS.chatMessage), line.slice(0, TEXT_LIMITS.chatMessage).trimEnd());
});
