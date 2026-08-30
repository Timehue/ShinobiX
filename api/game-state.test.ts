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

describe('game-state arena tournament winner — authoritative settlement', () => {
    const src = read('game-state.ts');

    it('restricts winner declaration to full admins and settles under the tournament lock', () => {
        assert.match(src, /fullAdminOnlyKinds = new Set\(\[[^\]]*'arenaTournamentWinner'/);
        const branch = src.indexOf("if (kind === 'arenaTournamentWinner')");
        assert.ok(branch > 0, 'winner settlement branch exists');
        const branchEnd = src.indexOf("if (kind === 'arenaActiveFights')", branch);
        assert.ok(branchEnd > branch, 'winner settlement branch has a stable boundary');
        const tail = src.slice(branch, branchEnd);
        assert.match(tail, /withKvLock\(ARENA_TOURNAMENT_KEY/);
        assert.match(tail, /\{ failClosed: true \}/);
        assert.match(tail, /applyTournamentVictory\(character, id\)/);
        assert.match(tail, /winnerName:\s*canonicalWinner/);
    });

    it('validates that the winner is an advanced tournament participant', () => {
        const branch = src.indexOf("if (kind === 'arenaTournamentWinner')");
        const branchEnd = src.indexOf("if (kind === 'arenaActiveFights')", branch);
        const tail = src.slice(branch, branchEnd);
        assert.match(tail, /participants\.find\(\(name\) => safeName\(name\) === winnerSlug\)/);
        assert.match(tail, /advanced\.some\(\(name\) => safeName\(name\) === winnerSlug\)/);
    });

    it('shows tournament controls only to the client identity with full-admin authority', () => {
        const adminIdentity = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'admin-identity.ts'), 'utf8');
        const arena = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'Arena.tsx'), 'utf8');
        const lobby = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'features', 'arena', 'components', 'ArenaDistrictLobby.tsx'), 'utf8');
        assert.match(adminIdentity, /isFullAdminAccountName[\s\S]*?return name === "Admin 1"/);
        assert.match(arena, /isAdminTournamentManager=\{isFullAdminAccountName\(character\.name\)\}/);
        assert.doesNotMatch(lobby, /Admin 1 or Admin 2 can start/);
    });
});
