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

    it('checks the persistent deletion generation INSIDE the lock before establishing its own admin signal', () => {
        const lockIdx = adminBranch.indexOf('withKvLock(');
        const fenceKeyIdx = adminBranch.indexOf('playerSaveDeletionFenceKey(');
        const readIdx = adminBranch.indexOf('const [existing, deletionFence]');
        const storedVersionIdx = adminBranch.indexOf('storedSaveVersion(deletionFence)');
        const signalIdx = adminBranch.indexOf('kv.set(adminLockKey');
        assert.ok(lockIdx >= 0 && lockIdx < fenceKeyIdx && fenceKeyIdx < readIdx
            && readIdx < storedVersionIdx && storedVersionIdx < signalIdx,
        'the locked live/floor read and version rejection must happen before this POST establishes its own signal');
    });

    it('serializes DELETE through the same fail-closed save lock', () => {
        const deleteBranch = src.slice(src.indexOf("if (req.method === 'DELETE')"));
        assert.match(deleteBranch, /if \(isAdmin\(req\) && !fullAdminAuth\) \{\s*return res\.status\(403\)/s,
            'content-admin credentials must not bypass the full-admin player-reset boundary');
        assert.match(deleteBranch, /withKvLock\(`save:\$\{lowered\}`/);
        assert.match(deleteBranch, /\{ failClosed: true \}/);
        assert.match(deleteBranch, /LockContendedError/);
        assert.match(deleteBranch, /status\(429\)/);
        const floorSetIdx = deleteBranch.indexOf('await kv.set(deletionFenceKey, deletionVersion)');
        const deleteIdx = deleteBranch.indexOf('kv.del(key)');
        assert.ok(floorSetIdx >= 0 && floorSetIdx < deleteIdx,
            'DELETE must persist the next generation before removing the save');
    });

    it('seeds ordinary same-name recreation above the persistent deletion generation', () => {
        const ordinaryBranch = src.slice(
            src.indexOf('if (!isAdminSave) {'),
            src.indexOf('// ── Admin save path (?signal=1)'),
        );
        assert.match(ordinaryBranch, /kv\.get\(deletionFenceKey\)/);
        assert.match(ordinaryBranch, /nextSaveVersion\(storedVersion, deletionFence\)/);
    });

    it('rejects a stale admin write instead of reverting newer content', () => {
        assert.match(adminBranch, /incomingVersion < adminStoredVersion/, 'a stale base version must be detected');
        assert.match(adminBranch, /status\(409\)/);
        assert.match(adminBranch, /Reload before saving/);
    });

    it('allows versionless trusted creation only before any deletion generation exists', () => {
        assert.match(adminBranch, /deletedGenerationWithoutLiveSave = existing === null && deletionFenceVersion > 0/);
        assert.match(
            adminBranch,
            /missingDeletedGenerationAuthority[\s\S]*incomingVersionRaw === undefined[\s\S]*!Number\.isFinite\(incomingVersion\)/,
            'a deleted generation must reject missing and non-finite admin snapshot versions',
        );
        assert.match(adminBranch, /staleVersionedSnapshot/,
            'ordinary stale-version checks remain independent of the deleted-generation fail-closed rule');
    });

    it('keeps the canonical content store in step with a legacy publish', () => {
        assert.match(adminBranch, /isAdminContentSlot\(name\)\)\s*\{\s*await mirrorSlotContent\(/s);
    });

    it('still strips personal forged gear on this path', () => {
        assert.match(adminBranch, /stripForgedItems\(/);
    });
});
