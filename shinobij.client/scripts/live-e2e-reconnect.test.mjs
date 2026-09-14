import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Live specs talk to the real Express server through Playwright's API client,
// whose pooled keep-alive sockets can be reset at the instant Node closes them
// (measured and explained in e2e-live/helpers/reconnecting-request.ts). That
// helper's `test` gives the `request` fixture Playwright's own reconnect;
// `page.request` and `route.fetch` are not that fixture and must pass
// `maxRetries` themselves. This scan keeps a new live spec, or a new call in an
// old one, from silently losing the guard.

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const liveRoot = join(clientRoot, 'e2e-live');
const HELPER_TEST_IMPORT = /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'\.\/helpers\/reconnecting-request'/;

function specFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return specFiles(path);
        return /\.spec\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

// Blank out comments and the contents of string literals, keeping newlines,
// so calls and parentheses can be scanned structurally with true line numbers.
function blankCommentsAndStrings(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') { out += ' '; i++; }
        } else if (ch === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end < 0 ? source.length : end + 2;
            for (; i < stop; i++) out += source[i] === '\n' ? '\n' : ' ';
        } else if (ch === '\'' || ch === '"' || ch === '`') {
            out += ch;
            i++;
            while (i < source.length && source[i] !== ch) {
                if (source[i] === '\\') { out += '  '; i += 2; continue; }
                out += source[i] === '\n' ? '\n' : ' ';
                i++;
            }
            if (i < source.length) { out += ch; i++; }
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/** Every `route.fetch(...)` or `page.request.<method>(...)` call whose arguments lack `maxRetries`. */
export function unguardedServerCalls(source) {
    const code = blankCommentsAndStrings(source);
    const offenders = [];
    for (const match of code.matchAll(/\b(route\.fetch|page\.request\.(?:fetch|get|post|put|patch|delete|head))\s*\(/g)) {
        const start = match.index + match[0].length;
        let depth = 1;
        let i = start;
        while (i < code.length && depth > 0) {
            if (code[i] === '(') depth++;
            else if (code[i] === ')') depth--;
            i++;
        }
        if (!/\bmaxRetries\b/.test(code.slice(start, i - 1))) {
            offenders.push({ line: code.slice(0, match.index).split('\n').length, call: match[1] });
        }
    }
    return offenders;
}

/** Whether a test or hook callback destructures Playwright's `request` fixture. */
export function usesRequestFixture(source) {
    return /\(\s*\{[^}]*\brequest\b[^}]*\}[^)]*\)\s*=>/.test(blankCommentsAndStrings(source));
}

test('the scan finds unguarded server calls and the request fixture', () => {
    assert.deepEqual(unguardedServerCalls('await route.fetch();').map((o) => o.call), ['route.fetch']);
    assert.deepEqual(unguardedServerCalls('await page.request.get(`/api/x`, { headers });').map((o) => o.call), ['page.request.get']);
    assert.deepEqual(unguardedServerCalls('await route.fetch({ headers, maxRetries: API_CONNECTION_RETRIES });'), []);
    assert.deepEqual(unguardedServerCalls('await page.request.get(url, {\n    headers: h,\n    maxRetries: 2,\n});'), []);
    assert.deepEqual(unguardedServerCalls('// await route.fetch();\nconst s = "route.fetch()";'), []);
    assert.equal(usesRequestFixture("test('x', async ({ page, request }, testInfo) => {});"), true);
    assert.equal(usesRequestFixture("test.afterEach(async ({ request }) => {});"), true);
    assert.equal(usesRequestFixture("test('x', async ({ page }) => {});"), false);
});

test('every live spec reaches the Express server through the reconnect guard', () => {
    const files = specFiles(liveRoot);
    // A vacuous pass is worse than none: the corpus must include the suites the
    // guard exists for.
    for (const name of ['combat-layout-matrix.spec.ts', 'village-stores-express.spec.ts']) {
        assert.ok(files.some((file) => file.endsWith(name)), `the scan must include e2e-live/${name}`);
    }
    const offenders = files.flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        const where = relative(clientRoot, file);
        const fixture = usesRequestFixture(source) && !HELPER_TEST_IMPORT.test(source)
            ? [`${where}: uses the \`request\` fixture; import \`test\` from './helpers/reconnecting-request'`]
            : [];
        const calls = unguardedServerCalls(source)
            .map(({ line, call }) => `${where}:${line}: ${call}(...) without maxRetries (use API_CONNECTION_RETRIES)`);
        return [...fixture, ...calls];
    });
    assert.deepEqual(offenders, [], 'A live spec call can hit the keep-alive reset race; see e2e-live/helpers/reconnecting-request.ts.');
});
