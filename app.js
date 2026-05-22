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

// Force IPv4 for all outbound fetch connections.
// CloudLinux shared hosting has no IPv6 routing, so DNS AAAA records cause
// "ENETUNREACH" errors. Setting family:4 on the global undici dispatcher
// makes every fetch() prefer A records instead.
try {
    const { Agent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
    console.log('[app] IPv4-only dispatcher set for all fetch connections.');
} catch (e) {
    console.warn('[app] Could not set IPv4 dispatcher:', e.message);
}

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Start the compiled Express server.
require('./dist/server.js');
