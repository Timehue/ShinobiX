/**
 * Route parity smoke test (Express: Railway + cPanel).
 *
 * The api/** handlers are served by the single Express server (server.ts →
 * dist/server.js) on both Railway and cPanel. Unlike the retired Vercel target,
 * there is NO folder-convention auto-routing: a handler is reachable ONLY if
 * server.ts imports and route()s it. Two ways that breaks, both caught here:
 *   1. The client calls an /api path that server.ts never registered  → 404.
 *   2. A handler file exists but nobody wired it in server.ts          → dead.
 *
 * This test closes both gaps statically: it scans the client for every
 * `/api/...` call site (asserting each is registered) and inventories every
 * api/ handler file (asserting each is imported in server.ts). Drift in either
 * direction fails `npm test`.
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

// ─── Handler inventory: every HTTP handler file under api/ ──────────────────────
//
// Express (Railway + cPanel) has NO folder-convention auto-routing — that was
// Vercel, now retired. A handler is reachable ONLY if server.ts imports and
// route()s it, so a handler file nobody wired in server.ts is dead code that
// 404s everywhere (it used to be reachable via Vercel's folder convention).
// This inventory drives the "no orphaned endpoints" check below.
//
// HTTP handlers only: skip *.test.ts and anything whose file OR directory name
// starts with `_` — that covers shared helpers (api/_utils.ts, api/_auth.ts, …)
// and the api/_realtime/* Socket.IO internals, which are wired via
// attachSocketServer(), not route().

const API_DIR = join(HERE, 'api');

function httpHandlerFiles(dir = API_DIR, prefix = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith('_')) continue;             // helper file or _realtime/ dir
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...httpHandlerFiles(full, `${prefix}${entry}/`));
            continue;
        }
        if (!/\.ts$/.test(entry) || entry.endsWith('.test.ts')) continue;
        out.push(`${prefix}${entry.replace(/\.ts$/, '')}`);  // e.g. 'save/[name]', 'kv-proxy'
    }
    return out;
}

const handlerFiles = httpHandlerFiles();

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

describe('Express route parity (Railway + cPanel)', () => {
    it('registers every /api endpoint the client calls', () => {
        const client = clientApiPaths();
        const missing: string[] = [];
        for (const [path, file] of client) {
            if (!isCovered(path)) missing.push(`${path}  (first used in ${file})`);
        }
        assert.equal(
            missing.length,
            0,
            `Client calls /api endpoints that server.ts does NOT register.\n` +
            `Express (Railway + cPanel) serves only what server.ts route()s — add a ` +
            `route() (and the matching import) in server.ts:\n  - ` +
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

describe('handler wiring (no orphaned endpoints)', () => {
    it('imports every api/ HTTP handler file in server.ts', () => {
        // server.ts imports each handler as `from './api/<relpath>.js'` (the
        // dynamic ones keep their literal filename, e.g. './api/save/[name].js'),
        // so the import specifier is the reliable "is it wired?" signal — more
        // robust than matching route paths against file names.
        const missing = handlerFiles.filter((rel) => !serverSrc.includes(`./api/${rel}.js`));
        assert.equal(
            missing.length,
            0,
            `These api/ HTTP handler files are not imported in server.ts, so they ` +
            `are unreachable on Express (Railway + cPanel) — Vercel's folder-convention ` +
            `auto-routing is retired. Wire each with an import + route() in server.ts:\n  - ` +
            missing.map((r) => `api/${r}.ts`).join('\n  - '),
        );
    });

    it('enumerated the api/ handler files (filesystem scan did not silently break)', () => {
        assert.ok(
            handlerFiles.length >= 20,
            `Only found ${handlerFiles.length} api/ handler files — the scan looks broken.`,
        );
    });
});
