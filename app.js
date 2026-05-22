/**
 * cPanel / Phusion Passenger entry point (CommonJS).
 *
 * Passenger's node-loader uses require() to load this file.
 * This is plain CommonJS — no ESM import/export.
 *
 * 1. Forces IPv4 for all outbound fetch connections (CloudLinux has no IPv6 routing).
 * 2. Loads .env from the same directory.
 * 3. Requires the compiled Express server from dist/server.js.
 */

// Override dns.lookup to use c-ares (dns.resolve4) with explicit DNS servers
// instead of getaddrinfo, which is broken inside CloudLinux CageFS jails.
try {
    const dns = require('dns');
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
    const _lookup = dns.lookup.bind(dns);
    dns.lookup = function (hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        dns.resolve4(hostname, (err, addresses) => {
            if (err) return _lookup(hostname, options, callback);
            callback(null, addresses[0], 4);
        });
    };
    console.log('[app] DNS override applied: using 8.8.8.8 via c-ares.');
} catch (e) {
    console.warn('[app] Could not apply DNS override:', e.message);
}

// Force IPv4 for all outbound fetch connections.
// CloudLinux shared hosting has no IPv6 routing. We use node:undici (the
// built-in module powering Node 22's fetch) so setGlobalDispatcher actually
// affects the native fetch used by @supabase/supabase-js.
try {
    const { Agent, setGlobalDispatcher } = require('node:undici');
    setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
    console.log('[app] IPv4-only dispatcher set via node:undici.');
} catch (e) {
    // Fallback: try the npm undici package (older Node versions).
    try {
        const { Agent, setGlobalDispatcher } = require('undici');
        setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
        console.log('[app] IPv4-only dispatcher set via npm undici.');
    } catch (e2) {
        console.warn('[app] Could not set IPv4 dispatcher:', e2.message);
    }
}

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Start the compiled Express server.
require('./dist/server.js');
