/**
 * Route parity smoke test (Vercel ⇄ cPanel).
 *
 * The same api/** handlers run two ways:
 *   • Vercel — every file under api/ is auto-exposed by the folder convention.
 *   • cPanel — server.ts must register each handler EXPLICITLY.
 *
 * It is therefore easy to ship a client feature that works on Vercel but 404s
 * on cPanel because nobody added the route to server.ts. This test closes that
 * gap: it scans the client for every `/api/...` call site and asserts each one
 * is registered in server.ts. A new unregistered endpoint fails `npm test`.
 *
 * It is intentionally a STATIC analysis (reads source text only): it boots no
 * server, opens no DB connection, and touches none of the PvP/realtime paths,
 * so it stays fast and can never destabilise a live endpoint.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_TS = join(HERE, 'server.ts');
const CLIENT_SRC = join(HERE, 'shinobij.client', 'src');

// ─── Server side: what cPanel actually registers ───────────────────────────────

const serverSrc = readFileSync(SERVER_TS, 'utf8');

// Every `route('/x/y', handler)` call. route() mounts BOTH '/x/y' and
// '/api/x/y', so the client-facing path is '/api' + the bare path.
function registeredApiPaths(src: string): string[] {
    const out: string[] = [];
    const re = /\broute\(\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push('/api' + m[1]);
    // Plus any explicit app.get/app.post(['/x','/api/x']) array literals.
    const reArr = /\bapp\.(?:get|post)\(\s*\[([^\]]+)\]/g;
    while ((m = reArr.exec(src)) !== null) {
        for (const lit of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
            if (lit[1].startsWith('/api/')) out.push(lit[1]);
        }
    }
    return out;
}

// Strip Express `:param` segments so '/api/save/:name' → '/api/save'.
const stripParams = (p: string) => p.replace(/\/:[^/]+/g, '');

const registeredFull = registeredApiPaths(serverSrc);
const registeredStripped = registeredFull.map(stripParams);

/** A client path is covered if a registration matches it exactly, matches it
 *  after param-stripping, or is a deeper route under it (prefix match — handles
 *  base-prefix constants like '/api/pvp' that front '/api/pvp/session'). */
function isCovered(clientPath: string): boolean {
    const all = [...registeredFull, ...registeredStripped];
    return all.some(
        (r) => r === clientPath || r.startsWith(clientPath + '/'),
    );
}

// ─── Vercel side: what the api/ folder convention actually serves ──────────────
//
// On Vercel every file under api/ is exposed at its path: api/foo/bar.ts →
// /api/foo/bar, api/save/[name].ts → /api/save/:name. server.ts can paper over a
// path↔file mismatch (it maps each route explicitly), so a handler can work on
// cPanel yet 404 on Vercel — exactly the treasury-transfer bug (client called
// /api/village/treasury/transfer but the file was api/village/treasury-transfer.ts,
// which Vercel exposes at /api/village/treasury-transfer). Derive the
// Vercel-served paths straight from the filesystem.

const API_DIR = join(HERE, 'api');

function vercelApiPaths(dir = API_DIR, prefix = '/api'): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...vercelApiPaths(full, `${prefix}/${entry}`));
            continue;
        }
        if (!/\.ts$/.test(entry) || entry.endsWith('.test.ts')) continue; // handlers only
        if (entry.startsWith('_')) continue;                              // shared helper, not a route
        // Vercel dynamic segments: [name] → :name, [...rest] → :rest* (so
        // stripParams() treats them the same as the cPanel side).
        const base = entry
            .replace(/\.ts$/, '')
            .replace(/\[\.\.\.(.+?)\]/g, ':$1*')
            .replace(/\[(.+?)\]/g, ':$1');
        out.push(base === 'index' ? prefix : `${prefix}/${base}`);
    }
    return out;
}

const vercelFull = vercelApiPaths();
const vercelStripped = vercelFull.map(stripParams);

/** A client path is served by Vercel if a handler file's folder-convention path
 *  matches it (same exact / param-stripped / prefix logic as the cPanel side). */
function isVercelServed(clientPath: string): boolean {
    const all = [...vercelFull, ...vercelStripped];
    return all.some((r) => r === clientPath || r.startsWith(clientPath + '/'));
}

// ─── Client side: every /api call site ─────────────────────────────────────────

function walk(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) files.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
    return files;
}

// Match a quote/backtick immediately followed by /api/ and the static run of
// path chars. Requiring the leading quote excludes prose mentions in comments
// (e.g. "// references /api/village/war/declare") while still catching string
// and template-literal call sites. The char class stops at `$`/`{`/quote, so a
// template like `/api/save/${id}` yields the static prefix '/api/save/'.
const CLIENT_API_RE = /['"`](\/api\/[A-Za-z0-9_\-/]*)/g;

function clientApiPaths(): Map<string, string> {
    const found = new Map<string, string>();   // normalized path → first file seen
    for (const file of walk(CLIENT_SRC)) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(CLIENT_API_RE)) {
            const normalized = m[1].replace(/\/+$/, '');   // drop trailing slash
            if (normalized === '/api') continue;            // bare prefix, ignore
            if (!found.has(normalized)) {
                found.set(normalized, file.slice(CLIENT_SRC.length + 1));
            }
        }
    }
    return found;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('cPanel route parity', () => {
    it('registers every /api endpoint the client calls', () => {
        const client = clientApiPaths();
        const missing: string[] = [];
        for (const [path, file] of client) {
            if (!isCovered(path)) missing.push(`${path}  (first used in ${file})`);
        }
        assert.equal(
            missing.length,
            0,
            `Client calls /api endpoints that server.ts does NOT register for ` +
            `cPanel.\nAdd a route() (and the matching import) in server.ts:\n  - ` +
            missing.join('\n  - '),
        );
    });

    it('parsed a sane number of client endpoints (scan did not silently break)', () => {
        // Guard against the regex/path resolution silently matching nothing and
        // turning this whole test into a no-op.
        assert.ok(
            clientApiPaths().size >= 20,
            `Only found ${clientApiPaths().size} client /api paths — the scan ` +
            `looks broken (expected dozens).`,
        );
    });

    it('mounts the dynamic param routes with all HTTP methods', () => {
        // Finding #6: method/param sanity for the dynamic endpoints. route()
        // registers via app.all(), so GET/POST/DELETE are all covered — assert
        // both the param routes and the app.all() wiring are present.
        assert.match(serverSrc, /route\(\s*['"]\/save\/:name['"]/, 'missing /save/:name route');
        assert.match(serverSrc, /route\(\s*['"]\/kv\/:op['"]/, 'missing /kv/:op route');
        assert.match(serverSrc, /app\.all\(\s*paths/, 'route() should mount via app.all() so every method is served');
    });
});

describe('Vercel route parity (folder convention)', () => {
    it('serves every /api endpoint the client calls via a file under api/', () => {
        const client = clientApiPaths();
        const missing: string[] = [];
        for (const [path, file] of client) {
            if (!isVercelServed(path)) missing.push(`${path}  (first used in ${file})`);
        }
        assert.equal(
            missing.length,
            0,
            `Client calls /api endpoints with NO matching handler file under api/ — ` +
            `these 404 on Vercel even if server.ts maps them for cPanel.\n` +
            `Create api/<path>.ts (folder convention) or fix the call path:\n  - ` +
            missing.join('\n  - '),
        );
    });

    it('enumerated the api/ handler files (filesystem scan did not silently break)', () => {
        assert.ok(
            vercelFull.length >= 20,
            `Only found ${vercelFull.length} api/ routes — the filesystem scan looks broken.`,
        );
    });
});
