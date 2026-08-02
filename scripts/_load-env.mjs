/*
 * Load the project's .env for ops scripts.
 *
 * The SERVER reads .env through app.js; standalone scripts never did, so every
 * invocation meant exporting credentials by hand at a shell prompt — easy to
 * get wrong (PowerShell has no inline `VAR=x cmd` form) and it puts secrets in
 * shell history. These tools read the same .env the app does. Env vars that
 * are ALREADY set win, so CI and the Railway shell are unaffected.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function loadProjectEnv() {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const envPath = join(root, '.env');
    if (!existsSync(envPath)) return false;
    try {
        const { config } = await import('dotenv');
        config({ path: envPath });   // does not override already-set vars
        return true;
    } catch {
        return false;
    }
}
