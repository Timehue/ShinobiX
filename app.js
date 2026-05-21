/**
 * cPanel / Phusion Passenger entry point.
 *
 * 1. Loads .env from the same directory as this file (so env vars are
 *    available before any module imports them).
 * 2. Starts the compiled Express server from dist/server.js.
 *
 * Passenger sets process.env.PORT automatically.
 * Node 18+ required (native ESM, top-level await).
 */

import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(appDir, '.env') });

// Import the compiled server — this starts the HTTP listener.
await import('./dist/server.js');
