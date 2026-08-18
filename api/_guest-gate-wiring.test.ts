/*
 * Contract test: every player-visible text channel actually runs the guest gate,
 * and runs it in the right place.
 *
 * The gate is one line per handler and trivially droppable in a merge, which is
 * exactly the sort of loss no unit test of the helper itself would notice — the
 * helper would keep passing while the endpoint quietly reopened. So this asserts
 * on the handler sources: the call is present, it sits AFTER the identity is
 * known (so it can never gate the wrong account), and it sits BEFORE the work it
 * is supposed to prevent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Repo-root-relative, matching the other api/ source-contract tests: this file
// builds to CommonJS, where `import.meta.url` is unavailable.
const source = (relative: string) => readFileSync(`api/${relative}`, 'utf8');

const GATE = 'if (await rejectUnclaimedGuest(res, identity)) return;';

function indexOf(text: string, needle: string, label: string): number {
    const at = text.indexOf(needle);
    assert.notEqual(at, -1, `missing in source: ${label}`);
    return at;
}

describe('guest social gate wiring', () => {
    it('shuts the tavern to unclaimed guests on both read and post', () => {
        const chat = source('village/chat.ts');
        assert.match(chat, /import \{ rejectUnclaimedGuest \} from '\.\.\/_guest-gate\.js';/);

        // Two call sites: one in the GET branch, one in the POST branch.
        const calls = chat.split(GATE).length - 1;
        assert.equal(calls, 2, 'expected the tavern gate on both GET and POST');

        const readGate = indexOf(chat, GATE, 'GET gate');
        const readIdentity = indexOf(chat, "You can only read your own village chat.", 'GET membership check');
        const readMessages = indexOf(chat, 'const allMessages = await kv.get<ChatMessage[]>(key)', 'GET transcript read');
        assert.ok(readIdentity < readGate, 'the GET gate must run after the identity is established');
        assert.ok(readGate < readMessages, 'a locked guest must not receive the transcript');

        const postGate = chat.indexOf(GATE, readGate + GATE.length);
        const postIdentity = indexOf(chat, 'You can only post in your own village chat.', 'POST membership check');
        const postWrite = indexOf(chat, 'const safeText =', 'POST message construction');
        assert.ok(postIdentity < postGate, 'the POST gate must run after the identity is established');
        assert.ok(postGate < postWrite, 'a locked guest must not reach message construction');
    });

    it('stops an unclaimed guest sending direct messages while leaving the inbox readable', () => {
        const messages = source('messages.ts');
        assert.match(messages, /import \{ rejectUnclaimedGuest \} from '\.\/_guest-gate\.js';/);
        assert.equal(messages.split(GATE).length - 1, 1, 'the DM gate belongs on POST only, not GET');

        const gate = indexOf(messages, GATE, 'DM gate');
        const post = indexOf(messages, "if (req.method === 'POST')", 'POST branch');
        const identity = indexOf(messages, 'const from = identity.name;', 'authed sender');
        const silence = indexOf(messages, 'const sil = await getActiveSilence(from);', 'silence check');
        assert.ok(post < gate, 'the DM gate must live inside the POST branch');
        assert.ok(identity < gate, 'the DM gate must run after the identity is established');
        assert.ok(gate < silence, 'the DM gate must run before the send path continues');
    });

    it('stops an unclaimed guest posting to clan chat', () => {
        const send = source('clan/chat/send.ts');
        assert.match(send, /import \{ rejectUnclaimedGuest \} from '\.\.\/\.\.\/_guest-gate\.js';/);
        assert.equal(send.split(GATE).length - 1, 1);

        const gate = indexOf(send, GATE, 'clan chat gate');
        const identity = indexOf(send, "You can only post as yourself.", 'identity match');
        const limiter = indexOf(send, "enforceRateLimitKv(req, res, 'clan-chat'", 'rate limiter');
        const write = indexOf(send, 'const text = cleanChatText(body.text);', 'message construction');
        assert.ok(identity < gate, 'the clan gate must run after the identity is established');
        // The gate does its own KV read, so it must sit behind the limiter that
        // protects this handler — every other chat handler limits first too.
        assert.ok(limiter < gate, 'the clan gate must run after the rate limiter');
        assert.ok(gate < write, 'a locked guest must not reach message construction');
    });

    it('stops an unclaimed guest posting to battle chat', () => {
        const chat = source('pvp/chat.ts');
        assert.match(chat, /import \{ rejectUnclaimedGuest \} from '\.\.\/_guest-gate\.js';/);
        assert.equal(chat.split(GATE).length - 1, 1, 'the battle-chat gate belongs on POST only, not GET');

        const gate = indexOf(chat, GATE, 'battle chat gate');
        const identity = indexOf(chat, 'Cannot post as another player.', 'identity match');
        const silence = indexOf(chat, 'const sil = await getActiveSilence(identity.name);', 'silence check');
        assert.ok(identity < gate, 'the battle-chat gate must run after the identity is established');
        assert.ok(gate < silence, 'the battle-chat gate must run before the send path continues');
    });

    it('reports the same lock to the client that the endpoints enforce', () => {
        // If account-status computed `socialLocked` from anything other than the
        // gate's own switch, a rollback would reopen the endpoints while the UI
        // stayed locked (or the reverse).
        const status = source('player/account-status.ts');
        assert.match(status, /import \{ guestSocialLockEnabled \} from '\.\.\/_guest-gate\.js';/);
        // Both halves matter: the kill switch, and the "either credential
        // releases you" rule that `isUnclaimedGuest` enforces on the endpoints.
        assert.match(status, /socialLocked: isCredentialLessGuest\(record\) && guestSocialLockEnabled\(\)/);
        assert.match(status, /const hasPassword = !!record && !isPasswordlessRecord\(record\);/);
        const gate = source('_guest-gate.ts');
        assert.match(gate, /return isCredentialLessGuest\(await kv\.get<AuthRecord>\(authKey\(slug\)\)\);/);
        // Player credentials only: authedPlayerOrAdmin would resolve an
        // admin-only request to `{admin:true}`, which has no account to report.
        assert.match(status, /const name = await authedPlayer\(req\);/);
        assert.doesNotMatch(status, /await authedPlayerOrAdmin\(/);
    });

    it('reclaims exactly the accounts it locks, and no others', () => {
        // The lock and the guest sweep answer the same question — "does this
        // character belong to anybody?" — with very different consequences.
        // They must read the SAME predicate: when they drifted, a player who
        // set a password could talk in the tavern and still be deleted for
        // inactivity two weeks later.
        const predicate = /isCredentialLessGuest/;
        const auth = source('player-auth.ts');
        // A plain boolean, NOT a `record is AuthRecord` type predicate: that
        // would narrow the FALSE branch to null|undefined, while the commonest
        // record reaching it is a real password account.
        assert.match(auth, /export function isCredentialLessGuest\(record: AuthRecord \| null \| undefined\): boolean \{/);
        assert.doesNotMatch(auth, /isCredentialLessGuest\([^)]*\): record is AuthRecord/);
        assert.match(auth, /return record\?\.guest === true && isPasswordlessRecord\(record\);/);

        const sweep = source('cron/_guest-sweep.ts');
        assert.match(sweep, predicate, 'the sweep must select on the shared predicate');
        // The explicit null test is what narrows before `record.createdAt`.
        assert.match(sweep, /if \(!record \|\| !isCredentialLessGuest\(record\)\) continue;/);
        // The old selector, which deleted password-holders. Never come back.
        assert.doesNotMatch(sweep, /if \(!record\?\.guest\) continue;/);

        for (const file of ['_guest-gate.ts', 'player/account-status.ts']) {
            assert.match(source(file), predicate, `${file} must share the predicate`);
        }
    });

    it('locks the world-visible trail signs but not the wordless spark', () => {
        const sign = source('sector/trail-sign.ts');
        assert.match(sign, /import \{ rejectUnclaimedGuest \} from '\.\.\/_guest-gate\.js';/);
        assert.equal(sign.split(GATE).length - 1, 1, 'one gate, on the text path only');

        const limiter = indexOf(sign, "enforceRateLimitKv(req, res, 'trail-sign'", 'rate limiter');
        const spark = indexOf(sign, "if (action === 'spark') {", 'spark branch');
        const gate = indexOf(sign, GATE, 'trail-sign gate');
        const write = indexOf(sign, 'const text =', 'sign text');
        assert.ok(limiter < gate, 'the gate must run after the rate limiter');
        // Sparking is a wordless thumbs-up: it returns before the gate, so a
        // guest can still cheer someone else's sign.
        assert.ok(spark < gate, 'the spark branch must return before the gate');
        assert.ok(gate < write, 'a locked guest must not reach the sign text');
    });
});
