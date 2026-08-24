import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source contract, in the shape of api/towers/entry-authority-contract.test.ts:
// these are ORDERING and OPTION guarantees on a currency path, and the handlers
// need live auth + KV to exercise end-to-end. Asserting them on the source keeps
// the guarantee from being silently dropped in a later edit.

// Resolved from the repo root, like api/towers/entry-authority-contract.test.ts.
const read = (rel: string) => readFileSync(join(process.cwd(), 'api', rel), 'utf8');

describe('game-state villageState — the treasury write is fail-closed', () => {
    const src = read('game-state.ts');

    it('takes the village-state lock with failClosed', () => {
        const lockAt = src.indexOf('const suppressedLog = await withKvLock(key, async () => {');
        assert.ok(lockAt > 0, 'the read-validate-write still runs under withKvLock');
        const tail = src.slice(lockAt, lockAt + 1400);
        assert.match(
            tail,
            /\}, \{ failClosed: true \}\);/,
            'the validator pins treasury keys to the value it just read, so an unlocked run '
            + 'racing the daily Village Stores pass would RESTORE the pre-debit provisions / materialPoints',
        );
    });

    it('surfaces a refused lock as a retryable 503, never a silent overwrite or a bare 500', () => {
        assert.match(src, /import \{ withKvLock, LockContendedError \} from '\.\/_lock\.js';/);
        const branch = src.indexOf('if (err instanceof LockContendedError)');
        const generic = src.lastIndexOf("console.error('[game-state]', safeLogValue(err));");
        assert.ok(branch > 0 && generic > branch, 'the contention branch precedes the generic 500');
        assert.match(src.slice(branch, generic), /res\.status\(503\)[\s\S]*retryable: true/);
    });
});

describe('heartbeat — contention and the offline-notice inbox', () => {
    const src = read('player/heartbeat.ts');

    it('translates lock contention into a retryable 503', () => {
        const branch = src.indexOf('if (err instanceof LockContendedError)');
        const generic = src.indexOf("console.error('[heartbeat]', err);");
        assert.ok(branch > 0 && generic > branch, 'the contention branch precedes the generic 500');
        assert.match(src.slice(branch, generic), /res\.status\(503\)[\s\S]*retryable: true/);
    });

    it('never blind-deletes the inbox key', () => {
        assert.equal(
            src.includes('rawNotices != null ? kv.del(noticesKey)'),
            false,
            'the unlocked unconditional delete destroyed any notice pushed between the mget and the del',
        );
        assert.match(src, /consumeDeliveredNotices\(noticesKey, pendingNotices\)/);
        assert.match(src, /withKvLock\(key, async \(\) => \{[\s\S]*?seen\.has\(noticeStamp\(n\)\)/, 'the clear compares against exactly what was read, under the key lock');
    });

    it('omits pendingNotices when there is nothing to deliver', () => {
        assert.match(src, /\.\.\.\(pendingNotices\.length > 0 \? \{ pendingNotices \} : \{\}\)/);
    });
});
