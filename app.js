/**
 * cPanel / Phusion Passenger entry point (CommonJS).
 *
 * Passenger's node-loader uses require() to load this file.
 * This is plain CommonJS — no ESM import/export.
 *
 * 1. Loads .env from the same directory.
 * 2. Requires the compiled Express server from dist/server.js.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Start the compiled Express server.
require('./dist/server.js');
