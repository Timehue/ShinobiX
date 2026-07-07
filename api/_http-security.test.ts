import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentSecurityPolicy, publicErrorPayload, securityHeaders } from './_http-security.js';

describe('_http-security', () => {
    it('redacts raw 500 details in production while keeping the request id', () => {
        assert.deepEqual(
            publicErrorPayload(new Error('secret path C:\\tmp\\token'), 'abc123', { NODE_ENV: 'production' }),
            { error: 'internal_server_error', requestId: 'abc123' },
        );
    });

    it('keeps local 500 details outside production', () => {
        assert.deepEqual(
            publicErrorPayload(new Error('local details'), 'dev1', { NODE_ENV: 'development' }),
            { error: 'internal_server_error', requestId: 'dev1', detail: 'Error: local details' },
        );
    });

    it('builds practical production security headers', () => {
        const headers = securityHeaders({ CSP_CONNECT_SRC_EXTRA: 'https://example.supabase.co,wss://realtime.example.com' });
        assert.equal(headers['X-Content-Type-Options'], 'nosniff');
        assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
        assert.match(headers['Permissions-Policy'], /camera=\(\)/);
        assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
        assert.match(headers['Content-Security-Policy'], /connect-src 'self' https: wss: ws: https:\/\/example\.supabase\.co wss:\/\/realtime\.example\.com/);
    });

    it('server keeps malformed JSON safe and sends generic production 500 bodies', () => {
        const src = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
        assert.match(src, /MALFORMED_JSON_BODY_ERROR,\s*requestId:\s*reqId/, 'malformed JSON should keep the safe 400 response');
        assert.match(src, /publicErrorPayload\(err,\s*reqId\)/, '500 handler should use the production-safe payload helper');
        assert.doesNotMatch(src, /error:\s*String\(err\)/, '500 handler must not echo raw errors directly');
        assert.match(src, /sendDefaultPii:\s*false/, 'Sentry must keep default PII collection disabled');
    });

    it('CSP includes the asset and realtime surfaces used by the app', () => {
        const csp = contentSecurityPolicy();
        assert.match(csp, /script-src 'self'/);
        assert.match(csp, /style-src 'self' 'unsafe-inline'/);
        assert.match(csp, /img-src 'self' data: blob: https:/);
        assert.match(csp, /media-src 'self' data: blob: https:/);
        assert.match(csp, /connect-src 'self' https: wss: ws:/);
        assert.match(csp, /worker-src 'self' blob:/);
    });
});
