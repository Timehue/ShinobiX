/**
 * cPanel / Phusion Passenger entry point (CommonJS).
 *
 * Passenger's node-loader uses require() to load this file.
 * This is plain CommonJS — no ESM import/export.
 *
 * 1. Polyfills fetch globals for Node.js < 18.
 * 2. Loads .env from the same directory.
 * 3. Requires the compiled Express server from dist/server.js.
 */

// Polyfill fetch globals (Headers, Request, Response, fetch) for Node < 18.
// undici is bundled with Node 18+; on older versions install it via npm.
if (typeof globalThis.Headers === 'undefined') {
    try {
        const undici = require('undici');
        globalThis.fetch    = undici.fetch;
        globalThis.Headers  = undici.Headers;
        globalThis.Request  = undici.Request;
        globalThis.Response = undici.Response;
    } catch (e) {
        console.warn('[app] undici not available — fetch polyfill skipped:', e.message);
    }
}

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Start the compiled Express server.
require('./dist/server.js');
