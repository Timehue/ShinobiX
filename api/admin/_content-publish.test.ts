import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * P0-4 publish-path contract (api/admin/content-publish.ts).
 *
 * The whole point of the endpoint is that it has the three guarantees the
 * legacy ?signal=1 path lacks — auth, a lock, and a version check — plus the
 * forged-gear strip and the compatibility mirror. Source-shape pins, matching
 * the repo's convention for handler-ordering contracts (behavior for the
 * store itself lives in api/_content-store.test.ts).
 */

const src = readFileSync(join(process.cwd(), 'api', 'admin', 'content-publish.ts'), 'utf8');
const serverSrc = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');

describe('content-publish endpoint contract', () => {
    it('is registered (an unregistered handler is unreachable)', () => {
        assert.match(serverSrc, /route\('\/admin\/content-publish', adminContentPublishHandler\)/);
        assert.match(serverSrc, /import adminContentPublishHandler from '\.\/api\/admin\/content-publish\.js'/);
    });

    it('rejects non-admin callers before doing anything', () => {
        const authIdx = src.indexOf("res.status(401).json({ error: 'Admin authentication required.' })");
        const publishIdx = src.indexOf('publishContent(');
        assert.ok(authIdx > 0 && authIdx < publishIdx, 'the auth gate must precede any publish');
        assert.match(src, /adminSaveTargetAllowed\(slot, fullAdmin, anyAdmin\)/, 'slot targeting must reuse the admin-save rule');
    });

    it('serializes each field on the CONTENT key, failClosed', () => {
        assert.match(
            src,
            /withKvLock\(contentKey\(field\), async \(\) =>\s*publishContent\(field, value, \{ actor, baseVersion \}\),\s*\{ failClosed: true \}\)/s,
            'publishes must run inside a failClosed lock on the contended field',
        );
    });

    it('surfaces a stale editor as a conflict instead of overwriting', () => {
        assert.match(src, /ContentVersionConflictError/);
        assert.match(src, /conflicts\.push/);
        assert.match(src, /status\(status\)/);
        assert.match(src, /Reload before saving/);
    });

    it('strips personal forged gear on the publish AND the mirror', () => {
        const matches = src.match(/stripForgedItems\(/g) ?? [];
        assert.ok(matches.length >= 2, 'forged gear must be stripped on both the canonical write and the slot mirror');
    });

    it('mirrors to the admin slot under the save lock, versioned', () => {
        assert.match(src, /withKvLock\(saveKey,/);
        assert.match(src, /bumpSaveVersion\(\{ \.\.\.existing, \.\.\.patch \}\)/);
        assert.match(src, /mergePreservingImages\(next, existing\)/);
    });

    it('never fails the request because the compatibility mirror failed', () => {
        const mirrorBlock = src.slice(src.indexOf('let mirrored = false;'));
        assert.match(mirrorBlock, /catch \(err\) \{[\s\S]*?console\.error\('\[admin\/content-publish\] slot mirror failed'/);
    });
});
