import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { classifyBodyLimit, DEFAULT_JSON_LIMIT, isOversizedBodyError } from './_body-limits.js';

// Regression for #1D: the 50 MB JSON parser must be scoped to the exact
// image/import routes — NOT the whole /admin/* tree (an unauthenticated caller
// could otherwise force a 50 MB buffer + parse before a handler's auth check).
// Player saves get their own 1 MB parser, enforced at the boundary.

describe('classifyBodyLimit', () => {
    it('grants the big parser ONLY to image/import + specific admin content routes', () => {
        for (const p of [
            '/api/images', '/images',
            '/api/admin/bloodline-review', '/api/admin/item-review',
            '/api/admin/save-snapshot',
        ]) {
            assert.equal(classifyBodyLimit(p), 'big', `${p} should get the 50 MB parser`);
        }
    });

    it('does NOT grant the big parser to ordinary admin routes (the pre-auth 50 MB fix)', () => {
        for (const p of [
            '/api/admin/server-reset', '/api/admin/players', '/api/admin/economy',
            '/api/admin/audit-log', '/api/admin/moderation', '/api/admin/migrate-images-to-r2',
            '/admin/server-reset', '/api/admin-auth', '/api/kv-proxy', '/kv/get',
        ]) {
            assert.equal(classifyBodyLimit(p), 'default', `${p} must NOT get the 50 MB parser`);
        }
    });

    it('does NOT grant the big parser to generate-image (small prompt body) or img (GET-only)', () => {
        for (const p of ['/api/generate-image', '/generate-image', '/api/img', '/img', '/api/img/x']) {
            assert.equal(classifyBodyLimit(p), 'default', `${p} must NOT get the 50 MB parser`);
        }
    });

    it('routes player saves (bare + /api-prefixed) to the 1 MB save parser', () => {
        assert.equal(classifyBodyLimit('/api/save/rill'), 'save');
        assert.equal(classifyBodyLimit('/save/rill'), 'save');
        assert.equal(classifyBodyLimit('/api/save/clan-embers'), 'save');
    });

    it('does not confuse save-snapshot with the save route', () => {
        // save-snapshot is a big-body admin route, not a 1 MB save route.
        assert.equal(classifyBodyLimit('/api/admin/save-snapshot'), 'big');
    });

    it('leaves hot gameplay/poll routes on the default parser', () => {
        // `pvp/session-x` proves the pvp/session allowance stops at its own path.
        for (const p of ['/api/pvp/move', '/api/pvp/session-x', '/api/player/heartbeat', '/api/player/challenge-notice',
            '/api/village-guard/queue', '/api/admin/content-publish-status', '/api/game-stateful']) {
            assert.equal(classifyBodyLimit(p), 'default', p);
        }
    });

    it('names every route the 256 KB default would break (bare + /api-prefixed)', () => {
        const expected: Record<string, string> = {
            'admin/content-publish': 'admin-large',
            'game-state': 'admin-large',
            'player/challenge': 'large',
            'village-guard/challenge': 'large',
            // A client older than 2026-11-22 posts both whole characters here.
            'pvp/session': 'large',
            'avatar-model/profile-portrait': 'medium',
            'pet/choose-starter': 'medium',
        };
        for (const [route, cls] of Object.entries(expected)) {
            assert.equal(classifyBodyLimit(`/${route}`), cls, `/${route}`);
            assert.equal(classifyBodyLimit(`/api/${route}`), cls, `/api/${route}`);
        }
    });
});

// The parser wiring in server.ts, exercised through real express.json parsers
// at the same limits (server.ts itself starts a server on import).
describe('JSON body limits over HTTP', () => {
    const limits: Record<string, string> = { default: DEFAULT_JSON_LIMIT, save: '1mb', medium: '2mb', large: '5mb' };
    let base = '';
    let server: Server;

    before(async () => {
        const app = express();
        app.use((req, res, next) => {
            const cls = classifyBodyLimit(req.path);
            return express.json({ limit: limits[cls] ?? '5mb' })(req, res, next);
        });
        app.post(/.*/, (req, res) => { res.status(200).json({ bytes: JSON.stringify(req.body).length }); });
        app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
            if (isOversizedBodyError(err)) return void res.status(413).json({ error: 'Request body too large.' });
            next(err);
        });
        server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', () => resolve()));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const post = (path: string, bytes: number) => fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blob: 'x'.repeat(bytes) }),
    });

    it('refuses a 300 KB body on an ordinary route with a 413, not a 500', async () => {
        const res = await post('/api/pvp/move', 300 * 1024);
        assert.equal(res.status, 413);
        assert.deepEqual(await res.json(), { error: 'Request body too large.' });
    });

    it('still accepts an ordinary body just under the default', async () => {
        assert.equal((await post('/api/pvp/move', 200 * 1024)).status, 200);
    });

    it('keeps the larger parsers on the routes that need them', async () => {
        assert.equal((await post('/api/player/challenge', 450 * 1024)).status, 200, 'a challenge with an inline avatar');
        assert.equal((await post('/api/pvp/session', 450 * 1024)).status, 200, 'a PvP create from a client that still sends whole characters');
        assert.equal((await post('/api/avatar-model/profile-portrait', 1_400_000)).status, 200, 'a 1 MiB portrait as base64');
        assert.equal((await post('/api/save/rill', 900 * 1024)).status, 200);
        assert.equal((await post('/api/save/rill', 1_100_000)).status, 413);
    });
});

describe('server.ts parser wiring', () => {
    const src = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    it('parses the default under DEFAULT_JSON_LIMIT, not a hand-written size', () => {
        assert.match(src, /const jsonDefault = express\.json\(\{ limit: DEFAULT_JSON_LIMIT \}\)/);
        assert.equal(DEFAULT_JSON_LIMIT, '256kb');
    });
    it('gives each named class its parser, admin credentials gating the admin blobs', () => {
        assert.match(src, /case 'admin-large': return isAdmin\(req\) \? jsonLarge\(req, res, next\) : jsonSave\(req, res, next\);/);
        assert.match(src, /case 'large':\s+return jsonLarge\(req, res, next\);/);
        assert.match(src, /case 'medium': return jsonMedium\(req, res, next\);/);
        assert.match(src, /const jsonLarge = express\.json\(\{ limit: '5mb' \}\)/);
        assert.match(src, /const jsonMedium = express\.json\(\{ limit: '2mb' \}\)/);
    });
    it('answers an oversized body with a 413', () => {
        assert.match(src, /if \(isOversizedBodyError\(err\)\) \{\s*if \(!res\.headersSent\) \{\s*res\.status\(413\)/);
    });
});
