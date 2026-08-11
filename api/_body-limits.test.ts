import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBodyLimit } from './_body-limits.js';

// Regression for #1D: the 50 MB JSON parser must be scoped to the exact
// image/import routes — NOT the whole /admin/* tree (an unauthenticated caller
// could otherwise force a 50 MB buffer + parse before a handler's auth check).
// Player saves get their own 1 MB parser, enforced at the boundary.

describe('classifyBodyLimit', () => {
    it('grants the big parser ONLY to image/import + specific admin content routes', () => {
        for (const p of [
            '/api/images', '/images', '/api/img/upload', '/api/generate-image',
            '/api/kv-proxy', '/api/admin/bloodline-review', '/api/admin/item-review',
            '/api/admin/save-snapshot',
        ]) {
            assert.equal(classifyBodyLimit(p), 'big', `${p} should get the 50 MB parser`);
        }
    });

    it('does NOT grant the big parser to ordinary admin routes (the pre-auth 50 MB fix)', () => {
        for (const p of [
            '/api/admin/server-reset', '/api/admin/players', '/api/admin/economy',
            '/api/admin/audit-log', '/api/admin/moderation', '/api/admin/migrate-kv',
            '/admin/server-reset', '/api/admin-auth',
        ]) {
            assert.equal(classifyBodyLimit(p), 'default', `${p} must NOT get the 50 MB parser`);
        }
    });

    it('routes player saves (bare + /api-prefixed) to the 1 MB save parser', () => {
        assert.equal(classifyBodyLimit('/api/save/rill'), 'save');
        assert.equal(classifyBodyLimit('/save/rill'), 'save');
        assert.equal(classifyBodyLimit('/api/save/clan-embers'), 'save');
    });

    it('gives player challenges their bounded pre-auth parser', () => {
        assert.equal(classifyBodyLimit('/api/player/challenge'), 'challenge');
        assert.equal(classifyBodyLimit('/player/challenge'), 'challenge');
    });

    it('does not confuse save-snapshot with the save route', () => {
        // save-snapshot is a big-body admin route, not a 1 MB save route.
        assert.equal(classifyBodyLimit('/api/admin/save-snapshot'), 'big');
    });

    it('leaves hot gameplay/poll routes on the default parser', () => {
        for (const p of ['/api/pvp/move', '/api/pvp/session', '/api/player/heartbeat', '/api/game-state']) {
            assert.equal(classifyBodyLimit(p), 'default');
        }
    });
});
