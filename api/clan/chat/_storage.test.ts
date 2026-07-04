import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { appendChatMessage, messagesSince, cleanChatText, CLAN_CHAT_MAX_MESSAGES, type ClanChatMessage } from './_storage.js';

function msg(ts: number, text = 'hi'): ClanChatMessage {
    return { id: `${ts}`, name: 'A', text, ts };
}

describe('clan chat storage', () => {
    it('appendChatMessage caps the ring buffer at CLAN_CHAT_MAX_MESSAGES (oldest dropped)', () => {
        let buf: ClanChatMessage[] = [];
        for (let i = 1; i <= CLAN_CHAT_MAX_MESSAGES + 10; i++) buf = appendChatMessage(buf, msg(i));
        assert.equal(buf.length, CLAN_CHAT_MAX_MESSAGES);
        assert.equal(buf[0].ts, 11, 'first 10 messages dropped');
        assert.equal(buf[buf.length - 1].ts, CLAN_CHAT_MAX_MESSAGES + 10);
    });

    it('appendChatMessage tolerates a null/undefined starting buffer', () => {
        assert.deepEqual(appendChatMessage(null, msg(1)).map(m => m.ts), [1]);
        assert.deepEqual(appendChatMessage(undefined, msg(2)).map(m => m.ts), [2]);
    });

    it('messagesSince returns only strictly-newer messages; since<=0 returns all', () => {
        const buf = [msg(10), msg(20), msg(30)];
        assert.deepEqual(messagesSince(buf, 15).map(m => m.ts), [20, 30]);
        assert.deepEqual(messagesSince(buf, 30).map(m => m.ts), []);
        assert.deepEqual(messagesSince(buf, 0).map(m => m.ts), [10, 20, 30]);
        assert.deepEqual(messagesSince(null, 5), []);
    });

    it('cleanChatText trims, rejects empty, and censors slur content', () => {
        assert.equal(cleanChatText('  hello team  '), 'hello team');
        assert.equal(cleanChatText('   '), null, 'whitespace-only rejected');
        assert.equal(cleanChatText(''), null);
        assert.equal(cleanChatText(undefined), null);
        const censored = cleanChatText('you nigger');
        assert.ok(censored && !/nigger/i.test(censored), `slur should be censored, got "${censored}"`);
    });

    it('cleanChatText caps overly long input rather than rejecting it', () => {
        const long = 'a'.repeat(5000);
        const out = cleanChatText(long);
        assert.ok(out && out.length <= 500, `expected <=500 chars, got ${out?.length}`);
    });
});
