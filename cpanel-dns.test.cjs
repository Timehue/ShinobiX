const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildHardcodedDnsMap, cleanDnsHost, cleanIpv4 } = require('./cpanel-dns.cjs');

describe('cpanel-dns', () => {
    it('stays disabled when no cPanel DNS env is configured', () => {
        assert.deepEqual(buildHardcodedDnsMap({}), {});
    });

    it('builds a DNS map from env only', () => {
        assert.deepEqual(buildHardcodedDnsMap({
            SUPABASE_DNS_HOST: 'ProjectRef.Supabase.Co',
            SUPABASE_HARDCODED_IP: '203.0.113.10',
        }), { 'projectref.supabase.co': '203.0.113.10' });
    });

    it('fails clearly when explicitly enabled without complete values', () => {
        assert.throws(
            () => buildHardcodedDnsMap({ SUPABASE_DNS_BYPASS: '1', SUPABASE_DNS_HOST: 'project.supabase.co' }),
            /requires both SUPABASE_DNS_HOST and SUPABASE_HARDCODED_IP/,
        );
    });

    it('validates hostnames and IPv4 addresses', () => {
        assert.equal(cleanDnsHost('abc.supabase.co'), 'abc.supabase.co');
        assert.equal(cleanIpv4('192.0.2.44'), '192.0.2.44');
        assert.throws(() => cleanDnsHost('https://abc.supabase.co'), /hostname/);
        assert.throws(() => cleanIpv4('999.0.2.44'), /IPv4/);
    });

    it('does not hardcode a Supabase project hostname or fallback IP in bootstrap code', () => {
        for (const file of ['app.js', 'api/_storage.ts']) {
            const src = readFileSync(join(process.cwd(), file), 'utf8');
            assert.doesNotMatch(src, /[a-z0-9]{20}\.supabase\.co/i, file);
            assert.doesNotMatch(src, /172\.64\.149\.246/, file);
            assert.match(src, /SUPABASE_DNS_HOST/, file);
            assert.match(src, /SUPABASE_HARDCODED_IP/, file);
        }
    });
});
