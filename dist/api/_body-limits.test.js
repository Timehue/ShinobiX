"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _body_limits_js_1 = require("./_body-limits.js");
// Regression for #1D: the 50 MB JSON parser must be scoped to the exact
// image/import routes — NOT the whole /admin/* tree (an unauthenticated caller
// could otherwise force a 50 MB buffer + parse before a handler's auth check).
// Player saves get their own 1 MB parser, enforced at the boundary.
(0, node_test_1.describe)('classifyBodyLimit', () => {
    (0, node_test_1.it)('grants the big parser ONLY to image/import + specific admin content routes', () => {
        for (const p of [
            '/api/images', '/images', '/api/img/upload', '/api/generate-image',
            '/api/kv-proxy', '/api/admin/bloodline-review', '/api/admin/item-review',
            '/api/admin/save-snapshot',
        ]) {
            strict_1.default.equal((0, _body_limits_js_1.classifyBodyLimit)(p), 'big', `${p} should get the 50 MB parser`);
        }
    });
    (0, node_test_1.it)('does NOT grant the big parser to ordinary admin routes (the pre-auth 50 MB fix)', () => {
        for (const p of [
            '/api/admin/server-reset', '/api/admin/players', '/api/admin/economy',
            '/api/admin/audit-log', '/api/admin/moderation', '/api/admin/migrate-kv',
            '/admin/server-reset', '/api/admin-auth',
        ]) {
            strict_1.default.equal((0, _body_limits_js_1.classifyBodyLimit)(p), 'default', `${p} must NOT get the 50 MB parser`);
        }
    });
    (0, node_test_1.it)('routes player saves (bare + /api-prefixed) to the 1 MB save parser', () => {
        strict_1.default.equal((0, _body_limits_js_1.classifyBodyLimit)('/api/save/rill'), 'save');
        strict_1.default.equal((0, _body_limits_js_1.classifyBodyLimit)('/save/rill'), 'save');
        strict_1.default.equal((0, _body_limits_js_1.classifyBodyLimit)('/api/save/clan-embers'), 'save');
    });
    (0, node_test_1.it)('does not confuse save-snapshot with the save route', () => {
        // save-snapshot is a big-body admin route, not a 1 MB save route.
        strict_1.default.equal((0, _body_limits_js_1.classifyBodyLimit)('/api/admin/save-snapshot'), 'big');
    });
    (0, node_test_1.it)('leaves hot gameplay/poll routes on the default parser', () => {
        for (const p of ['/api/pvp/move', '/api/pvp/session', '/api/player/heartbeat', '/api/game-state']) {
            strict_1.default.equal((0, _body_limits_js_1.classifyBodyLimit)(p), 'default');
        }
    });
});
