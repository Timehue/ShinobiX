import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Playwright Test has no `reducedMotion` option. It reads that setting only
// from `use.contextOptions` (or from an explicit browser.newContext /
// page.emulateMedia call). Written anywhere else it is accepted and ignored,
// with no warning. Until 2026-09-10 all nine configs set it at the top level
// of `use`, and every e2e suite, CI included, ran with full motion while
// claiming reduced motion. This scan keeps the key where Playwright reads it.

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Every e2e directory, found rather than listed, so a new suite (e2e-warfront
// was nearly missed) is covered the day it is added.
const SPEC_DIRS = readdirSync(clientRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^e2e(?:-|$)/.test(entry.name))
    .map((entry) => entry.name);

// Blank out comments and the CONTENTS of string literals, keeping every
// newline, so braces and keys can be scanned structurally and line numbers
// stay true. Template literals are treated as opaque strings.
export function blankCommentsAndStrings(source) {
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

const ALLOWED_OWNER = [
    /\bcontextOptions\s*:\s*$/,
    /\b(?:emulateMedia|newContext|newPage|launchPersistentContext)\s*\(\s*$/,
];

/**
 * Every `reducedMotion` object key, including the `{ reducedMotion }`
 * shorthand, whose enclosing object is not one Playwright reads. A
 * destructuring pattern (`const { reducedMotion } = x`) is not configuration.
 */
export function findIgnoredReducedMotion(source) {
    const text = blankCommentsAndStrings(source);
    const problems = [];
    for (const match of text.matchAll(/(?<=[{,]\s*)\breducedMotion\b(?=\s*[:,}])/g)) {
        let depth = 0;
        let open = -1;
        for (let i = match.index - 1; i >= 0; i--) {
            if (text[i] === '}') depth++;
            else if (text[i] === '{') {
                if (depth === 0) { open = i; break; }
                depth--;
            }
        }
        let close = -1;
        for (let i = match.index, d = 0; i < text.length; i++) {
            if (text[i] === '{') d++;
            else if (text[i] === '}') {
                if (d === 0) { close = i; break; }
                d--;
            }
        }
        if (close >= 0 && /^\s*=(?![=>])/.test(text.slice(close + 1))) continue;
        const owner = open < 0 ? '' : text.slice(0, open);
        if (!ALLOWED_OWNER.some((pattern) => pattern.test(owner))) {
            problems.push(text.slice(0, match.index).split('\n').length);
        }
    }
    return problems;
}

function specFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '__snapshots__') found.push(...specFiles(path));
        } else if (/\.(?:ts|mts|js|mjs)$/.test(entry.name)) {
            found.push(path);
        }
    }
    return found;
}

test('the scanner flags the ignored placements and accepts the read ones', () => {
    assert.deepEqual(findIgnoredReducedMotion("export default { use: {\n  reducedMotion: 'reduce',\n} };"), [2]);
    assert.deepEqual(findIgnoredReducedMotion("test.use({ reducedMotion: 'no-preference' });"), [1]);
    assert.deepEqual(findIgnoredReducedMotion("{ name: 'x', use: { browserName: 'webkit', reducedMotion: 'reduce' } }"), [1]);
    assert.deepEqual(findIgnoredReducedMotion("use: { contextOptions: { reducedMotion: 'reduce' } }"), []);
    assert.deepEqual(findIgnoredReducedMotion("test.use({ contextOptions: { reducedMotion: 'no-preference' } });"), []);
    assert.deepEqual(findIgnoredReducedMotion("await page.emulateMedia({ reducedMotion: 'reduce' });"), []);
    assert.deepEqual(findIgnoredReducedMotion("await browser.newContext({ viewport, reducedMotion: 'reduce' });"), []);
    // Shorthand properties are keys too; destructuring and member access are not.
    assert.deepEqual(findIgnoredReducedMotion("const reducedMotion = 'reduce';\nexport default { use: { baseURL, reducedMotion } };"), [2]);
    assert.deepEqual(findIgnoredReducedMotion("await browser.newContext({ viewport, reducedMotion });"), []);
    assert.deepEqual(findIgnoredReducedMotion("const { reducedMotion } = testInfo.project.use;\nconst x = options.reducedMotion;"), []);
    // Prose in comments and strings is not configuration.
    assert.deepEqual(findIgnoredReducedMotion("// use: { reducedMotion: 'reduce' }\n/* reducedMotion: 'reduce' */\nconst s = \"reducedMotion: 'reduce'\";"), []);
});

test('every Playwright config and e2e file puts reducedMotion where Playwright reads it', () => {
    const files = [
        ...readdirSync(clientRoot).filter((name) => /^playwright\..*config\.[cm]?[jt]s$/.test(name)).map((name) => join(clientRoot, name)),
        ...SPEC_DIRS.flatMap((dir) => specFiles(join(clientRoot, dir))),
    ];
    assert.ok(files.some((file) => file.endsWith('playwright.config.ts')), 'the scan must include the gating smoke config');
    for (const dir of ['e2e', 'e2e-live', 'e2e-visual', 'e2e-warfront']) {
        assert.ok(SPEC_DIRS.includes(dir), `the scan must include ${dir}/`);
    }
    const offenders = files.flatMap((file) => findIgnoredReducedMotion(readFileSync(file, 'utf8'))
        .map((line) => `${relative(clientRoot, file)}:${line}`));
    assert.deepEqual(
        offenders,
        [],
        'reducedMotion is not a Playwright Test option. Move it into `contextOptions: { reducedMotion }` '
            + '(or pass it to browser.newContext / page.emulateMedia); anywhere else it is silently ignored.',
    );
});
