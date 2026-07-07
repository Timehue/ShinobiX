/**
 * cPanel / Phusion Passenger entry point (CommonJS).
 *
 * Passenger's node-loader uses require() to load this file.
 * This is plain CommonJS — no ESM import/export.
 *
 * 1. Optionally maps cPanel-only Supabase DNS via env (CageFS can block port 53).
 * 2. Forces IPv4 for all outbound fetch/undici connections.
 * 3. Loads .env from the same directory.
 * 4. Requires the compiled Express server from dist/server.js.
 */

// Load .env FIRST so cPanel DNS bypass env (and other vars) are available when
// the DNS map below is built at module load.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Optional cPanel-only DNS bypass. Configure BOTH SUPABASE_DNS_HOST and
// SUPABASE_HARDCODED_IP when CageFS cannot resolve the Supabase hostname;
// source code deliberately contains no project hostname or fallback IP because
// those are host-specific and can rotate.
const { buildHardcodedDnsMap } = require('./cpanel-dns.cjs');
const HARDCODED_DNS = buildHardcodedDnsMap(process.env);
const HARDCODED_DNS_ENABLED = Object.keys(HARDCODED_DNS).length > 0;

// Custom lookup function shared by dns.lookup patch and undici Agent.
function customLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (HARDCODED_DNS[hostname]) {
        console.log('[app] DNS hardcode hit:', hostname, '->', HARDCODED_DNS[hostname]);
        return callback(null, HARDCODED_DNS[hostname], 4);
    }
    // Fallback: try c-ares with explicit public DNS servers.
    try {
        const dns = require('dns');
        dns.setServers(['8.8.8.8', '1.1.1.1']);
        dns.resolve4(hostname, (err, addresses) => {
            if (err || !addresses || !addresses.length) {
                require('dns').lookup(hostname, options, callback);
            } else {
                callback(null, addresses[0], 4);
            }
        });
    } catch (_) {
        require('dns').lookup(hostname, options, callback);
    }
}

// Patch dns.lookup globally so Node's https module uses the env DNS map.
try {
    const dns = require('dns');
    dns.lookup = customLookup;
    console.log(HARDCODED_DNS_ENABLED
        ? '[app] dns.lookup patched with env-driven hardcoded DNS.'
        : '[app] dns.lookup patched for IPv4/public-resolver fallback; no hardcoded DNS entries configured.');
} catch (e) {
    console.warn('[app] Could not patch dns.lookup:', e.message);
}

// Set global undici dispatcher so native fetch / Supabase client uses the same
// env DNS map + IPv4 only (CloudLinux has no IPv6 routing).
const undiciAgentOptions = {
    connect: {
        lookup: customLookup,
        family: 4,
    },
};

try {
    const { Agent, setGlobalDispatcher } = require('node:undici');
    setGlobalDispatcher(new Agent(undiciAgentOptions));
    console.log('[app] undici dispatcher set (node:undici) with cPanel DNS lookup.');
} catch (e) {
    try {
        const { Agent, setGlobalDispatcher } = require('undici');
        setGlobalDispatcher(new Agent(undiciAgentOptions));
        console.log('[app] undici dispatcher set (npm undici) with cPanel DNS lookup.');
    } catch (e2) {
        console.warn('[app] Could not set undici dispatcher:', e2.message);
    }
}

// Start the compiled Express server.
require('./dist/server.js');
