import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * P0-4: the legacy admin publish path (`POST /api/save/<slot>?signal=1`).
 *
 * Phase 0's High finding: it read-modify-wrote with NO lock and NO version
 * check, so two admin tabs raced and a stale tab silently reverted newer
 * shared content. P0-1 verified the AUTH boundary was sound; this pins the
 * concurrency half now that it is fixed.
 *
 * Source-shape assertions (the surrounding handler is not unit-invocable —
 * same convention as _foreign-read-no-write.test.ts).
 */

const src = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');
const adminBranch = src.slice(src.indexOf('// ── Admin save path (?signal=1)'));

describe('legacy ?signal=1 publish path', () => {
    it('still requires admin auth (unchanged P0-1 boundary)', () => {
        assert.match(
            src,
            /if \(isAdminSave\) \{\s*if \(!adminSaveTargetAllowed\(name, isFullAdmin\(req\), isAdmin\(req\)\)\) \{\s*return res\.status\(401\)/s,
        );
    });

    it('runs its read-modify-write inside the save lock, failClosed', () => {
        assert.ok(adminBranch.length > 0, 'admin branch present');
        assert.match(adminBranch, /withKvLock\(`save:\$\{name\.toLowerCase\(\)\}`/, 'the admin RMW must hold the save lock');
        assert.match(adminBranch, /\{ failClosed: true \}/);
        assert.match(adminBranch, /LockContendedError/);
        assert.match(adminBranch, /status\(429\)/, 'contention returns the same 429 the player path does');
    });

    it('takes the admin-edit signal INSIDE the lock, before its own read', () => {
        const lockIdx = adminBranch.indexOf('withKvLock(');
        const signalIdx = adminBranch.indexOf('kv.set(adminLockKey');
        const readIdx = adminBranch.indexOf('await kv.get(key)');
        assert.ok(lockIdx >= 0 && lockIdx < signalIdx && signalIdx < readIdx,
            'the edit signal must be set inside the lock and before the read, or a player write can interleave');
    });

    it('rejects a stale admin write instead of reverting newer content', () => {
        assert.match(adminBranch, /incomingVersion < adminStoredVersion/, 'a stale base version must be detected');
        assert.match(adminBranch, /status\(409\)/);
        assert.match(adminBranch, /Reload before saving/);
    });

    it('still accepts a version-less body (scripts / older tooling)', () => {
        assert.match(
            adminBranch,
            /incomingVersionRaw !== undefined\s*&& Number\.isFinite\(incomingVersion\)/s,
            'the version check must only apply when the body carries a version',
        );
    });

    it('keeps the canonical content store in step with a legacy publish', () => {
        assert.match(adminBranch, /isAdminContentSlot\(name\)\)\s*\{\s*await mirrorSlotContent\(/s);
    });

    it('still strips personal forged gear on this path', () => {
        assert.match(adminBranch, /stripForgedItems\(/);
    });
});
