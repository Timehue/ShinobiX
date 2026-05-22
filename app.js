/**
 * cPanel / Phusion Passenger entry point (CommonJS).
 *
 * Passenger's node-loader uses require() to load this file.
 * This is plain CommonJS — no ESM import/export.
 *
 * 1. Hardcodes DNS for Supabase (CageFS blocks outbound port 53).
 * 2. Forces IPv4 for all outbound fetch/undici connections.
 * 3. Loads .env from the same directory.
 * 4. Requires the compiled Express server from dist/server.js.
 */

// Hardcoded IPv4 addresses for hostnames that CageFS cannot resolve via DNS.
// Resolved externally: nslookup soaychxshtbgwujhytsf.supabase.co 8.8.8.8
// These are Cloudflare CDN IPs — update if Supabase changes their CDN.
const HARDCODED_DNS = {
    'soaychxshtbgwujhytsf.supabase.co': '172.64.149.246',
};

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

// Patch dns.lookup globally so Node's https module uses hardcoded IPs.
try {
    const dns = require('dns');
    dns.lookup = customLookup;
    console.log('[app] dns.lookup patched with hardcoded IPs.');
} catch (e) {
    console.warn('[app] Could not patch dns.lookup:', e.message);
}

// Set global undici dispatcher so native fetch / Supabase client uses
// hardcoded IPs + IPv4 only (CloudLinux has no IPv6 routing).
const undiciAgentOptions = {
    connect: {
        lookup: customLookup,
        family: 4,
    },
};

try {
    const { Agent, setGlobalDispatcher } = require('node:undici');
    setGlobalDispatcher(new Agent(undiciAgentOptions));
    console.log('[app] undici dispatcher set (node:undici) with hardcoded DNS.');
} catch (e) {
    try {
        const { Agent, setGlobalDispatcher } = require('undici');
        setGlobalDispatcher(new Agent(undiciAgentOptions));
        console.log('[app] undici dispatcher set (npm undici) with hardcoded DNS.');
    } catch (e2) {
        console.warn('[app] Could not set undici dispatcher:', e2.message);
    }
}

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Diagnostic: log the size, mtime, and v: marker of dist/server.js so we can
// verify what version is actually on disk (separate from any module cache).
try {
    const fs = require('fs');
    const path = require('path');
    const serverPath = path.join(__dirname, 'dist', 'server.js');
    const stat = fs.statSync(serverPath);
    const content = fs.readFileSync(serverPath, 'utf8');
    const vMatch = content.match(/v:\s*(\d+)/);
    const vMarker = vMatch ? `v:${vMatch[1]}` : 'NO v: marker';
    const hasTcpTest = content.includes('tcpTest');
    console.log('[app] dist/server.js size=' + stat.size + ' mtime=' + stat.mtime.toISOString() + ' ' + vMarker + ' tcpTest=' + hasTcpTest);
} catch (e) {
    console.warn('[app] Could not stat dist/server.js:', e.message);
}

// Start the compiled Express server.
require('./dist/server.js');
