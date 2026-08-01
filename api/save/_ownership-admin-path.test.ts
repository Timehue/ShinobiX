import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * P0-1 characterization of the ADMIN save paths in api/save/[name].ts — the
 * ownership boundaries that live in the handler rather than in the pure
 * sanitizer (source-shape tests, same style as _foreign-read-no-write.test.ts).
 *
 * Pins, without changing:
 *  1. The ordinary POST path sanitizes every non-admin save (`!isAdminSave`
 *     gate) and validates version + lock; admin saves bypass the sanitizer.
 *  2. The `?signal=1` admin path is reachable ONLY with admin auth, and only
 *     for the two content slots for non-full admins (adminSaveTargetAllowed).
 *     Phase 0 flagged its lack of lock/version-guard as P0-4 work; P0-1 only
 *     proves the AUTH boundary holds (no ordinary player can use it).
 *  3. The `?signal=1` path strips personal forged gear before publishing to a
 *     content slot (the admin-slot ownership rule applied on both paths).
 *  4. Stale-save protection: versionless player saves are rejected (426) and
 *     stale versions conflict (409) — the enforcement details live in
 *     _save-version.test.ts / _versioned-save-writes.test.ts.
 */

const src = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');

test('non-admin saves are sanitized; admin saves bypass the sanitizer (current behavior)', () => {
    assert.match(src, /if \(!isAdminSave\)/, 'the sanitizer gate must remain keyed on isAdminSave');
    assert.match(src, /sanitizeCharacterSave\(/, 'the ordinary path must sanitize');
});

test('the ?signal=1 admin path requires admin auth and an allowed target', () => {
    // The flag itself comes from the query string, so the very next thing the
    // handler must do for an admin-flagged write is reject the request unless
    // real admin auth is present (adminSaveTargetAllowed(name, isFullAdmin(req),
    // isAdmin(req)) → 401). VERIFIED during P0-1: an unauthenticated or ordinary
    // player cannot reach the admin write branch — the residual `?signal=1`
    // risk is locking/version consistency, which is P0-4 scope.
    assert.match(
        src,
        /if \(isAdminSave\) \{\s*if \(!adminSaveTargetAllowed\(name, isFullAdmin\(req\), isAdmin\(req\)\)\) \{\s*return res\.status\(401\)/s,
        'an admin-flagged save must 401 without admin auth',
    );
});

test('the ?signal=1 path strips forged gear before writing a content slot', () => {
    // The admin path skips sanitizeCharacterSave entirely, so it must apply the
    // admin-slot forged-item rule itself.
    const adminBranch = src.slice(src.indexOf('adminStoredVersion'));
    assert.ok(adminBranch.length > 0, 'admin write branch present');
    assert.match(
        adminBranch.slice(0, 2500),
        /stripForgedItems\(/,
        'admin ?signal=1 writes must strip personal forged items from creatorItems',
    );
});

test('stale-save guards remain on the ordinary path (426 versionless, 409 stale)', () => {
    assert.match(src, /isVersionlessPlayerSave\(/, 'versionless player saves must be rejected');
    assert.match(src, /status\(426\)/, 'the versionless rejection must stay a 426');
    assert.match(src, /status\(409\)/, 'the stale-version rejection must stay a 409');
});
