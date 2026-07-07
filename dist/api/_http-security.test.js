"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const _http_security_js_1 = require("./_http-security.js");
(0, node_test_1.describe)('_http-security', () => {
    (0, node_test_1.it)('redacts raw 500 details in production while keeping the request id', () => {
        node_assert_1.strict.deepEqual((0, _http_security_js_1.publicErrorPayload)(new Error('secret path C:\\tmp\\token'), 'abc123', { NODE_ENV: 'production' }), { error: 'internal_server_error', requestId: 'abc123' });
    });
    (0, node_test_1.it)('keeps local 500 details outside production', () => {
        node_assert_1.strict.deepEqual((0, _http_security_js_1.publicErrorPayload)(new Error('local details'), 'dev1', { NODE_ENV: 'development' }), { error: 'internal_server_error', requestId: 'dev1', detail: 'Error: local details' });
    });
    (0, node_test_1.it)('builds practical production security headers', () => {
        const headers = (0, _http_security_js_1.securityHeaders)({ CSP_CONNECT_SRC_EXTRA: 'https://example.supabase.co,wss://realtime.example.com' });
        node_assert_1.strict.equal(headers['X-Content-Type-Options'], 'nosniff');
        node_assert_1.strict.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
        node_assert_1.strict.match(headers['Permissions-Policy'], /camera=\(\)/);
        node_assert_1.strict.match(headers['Content-Security-Policy'], /default-src 'self'/);
        node_assert_1.strict.match(headers['Content-Security-Policy'], /connect-src 'self' https: wss: ws: https:\/\/example\.supabase\.co wss:\/\/realtime\.example\.com/);
    });
    (0, node_test_1.it)('server keeps malformed JSON safe and sends generic production 500 bodies', () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'server.ts'), 'utf8');
        node_assert_1.strict.match(src, /MALFORMED_JSON_BODY_ERROR,\s*requestId:\s*reqId/, 'malformed JSON should keep the safe 400 response');
        node_assert_1.strict.match(src, /publicErrorPayload\(err,\s*reqId\)/, '500 handler should use the production-safe payload helper');
        node_assert_1.strict.doesNotMatch(src, /error:\s*String\(err\)/, '500 handler must not echo raw errors directly');
        node_assert_1.strict.match(src, /sendDefaultPii:\s*false/, 'Sentry must keep default PII collection disabled');
    });
    (0, node_test_1.it)('CSP includes the asset and realtime surfaces used by the app', () => {
        const csp = (0, _http_security_js_1.contentSecurityPolicy)();
        node_assert_1.strict.match(csp, /script-src 'self'/);
        node_assert_1.strict.match(csp, /style-src 'self' 'unsafe-inline'/);
        node_assert_1.strict.match(csp, /img-src 'self' data: blob: https:/);
        node_assert_1.strict.match(csp, /media-src 'self' data: blob: https:/);
        node_assert_1.strict.match(csp, /connect-src 'self' https: wss: ws:/);
        node_assert_1.strict.match(csp, /worker-src 'self' blob:/);
    });
});
