const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildHardcodedDnsMap, cleanDnsHost, cleanIpv4, makeCustomLookup } = require('./cpanel-dns.cjs');

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

    it('makeCustomLookup requires the pre-patch original lookup (no recursion by construction)', () => {
        assert.throws(() => makeCustomLookup({}, { resolve4() {}, setServers() {} }), /originalLookup/);
    });

    it('serves a hardcoded map hit without touching resolve4 or the fallback', () => {
        let resolve4Calls = 0, fallbackCalls = 0;
        const lookup = makeCustomLookup({ 'db.supabase.co': '203.0.113.7' }, {
            resolve4: () => { resolve4Calls += 1; },
            setServers: () => {},
            originalLookup: () => { fallbackCalls += 1; },
        });
        let result;
        lookup('db.supabase.co', {}, (err, addr, fam) => { result = { err, addr, fam }; });
        assert.deepEqual(result, { err: null, addr: '203.0.113.7', fam: 4 });
        assert.equal(resolve4Calls, 0);
        assert.equal(fallbackCalls, 0);
    });

    it('returns the first resolve4 address on success (no fallback)', () => {
        let fallbackCalls = 0;
        const lookup = makeCustomLookup({}, {
            resolve4: (_host, cb) => cb(null, ['198.51.100.9', '198.51.100.10']),
            setServers: () => {},
            originalLookup: () => { fallbackCalls += 1; },
        });
        let result;
        lookup('abc.supabase.co', {}, (err, addr, fam) => { result = { err, addr, fam }; });
        assert.deepEqual(result, { err: null, addr: '198.51.100.9', fam: 4 });
        assert.equal(fallbackCalls, 0);
    });

    it('falls back to the ORIGINAL lookup exactly once on a resolve4 error — never recurses', () => {
        let resolve4Calls = 0;
        const fallbackHosts = [];
        const lookup = makeCustomLookup({}, {
            resolve4: (_host, cb) => { resolve4Calls += 1; cb(new Error('ENOTFOUND')); },
            setServers: () => {},
            originalLookup: (host, _opts, cb) => { fallbackHosts.push(host); cb(null, '127.0.0.1', 4); },
        });
        let result;
        lookup('abc.supabase.co', {}, (err, addr, fam) => { result = { err, addr, fam }; });
        assert.deepEqual(result, { err: null, addr: '127.0.0.1', fam: 4 });
        assert.deepEqual(fallbackHosts, ['abc.supabase.co'], 'fell back exactly once to the original resolver');
        assert.equal(resolve4Calls, 1, 'resolve4 ran once and was not re-entered (no recursion)');
    });

    it('falls back exactly once when resolve4 throws synchronously', () => {
        let fallbackCalls = 0;
        const lookup = makeCustomLookup({}, {
            resolve4: () => { throw new Error('c-ares unavailable'); },
            setServers: () => {},
            originalLookup: (_host, _opts, cb) => { fallbackCalls += 1; cb(null, '10.0.0.1', 4); },
        });
        let result;
        lookup('abc.supabase.co', {}, (err, addr) => { result = { err, addr }; });
        assert.deepEqual(result, { err: null, addr: '10.0.0.1' });
        assert.equal(fallbackCalls, 1);
    });

    it('accepts the 2-arg (options-as-callback) lookup signature', () => {
        const lookup = makeCustomLookup({ 'db.supabase.co': '203.0.113.7' }, {
            resolve4: () => {}, setServers: () => {}, originalLookup: () => {},
        });
        let addr;
        lookup('db.supabase.co', (err, a) => { addr = a; });
        assert.equal(addr, '203.0.113.7');
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
