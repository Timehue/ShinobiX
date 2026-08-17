// The point of prerender-legal.mts is that /privacy and /terms answer with real
// policy text to a reader that never runs JavaScript. Google's OAuth brand
// verification is exactly such a reader, and it follows the privacy policy URL
// published on the consent screen. So this asserts on the extracted TEXT of the
// generated file, not on its markup: markup that renders correctly in a browser
// is what the pages already had, and it is not what was missing.
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LEGAL_PAGE_LINKS } from '../src/data/legal.ts';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(clientRoot, '..');

/** Strip tags and collapse whitespace — what a reader with no JS engine keeps. */
function visibleText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Run the prerenderer against a throwaway dist and return the files it wrote. */
function runPrerender(): { dir: string; files: string[] } {
    const dir = mkdtempSync(path.join(tmpdir(), 'prerender-legal-'));
    // The real shell comes from Vite; this keeps the anchors the script rewrites.
    writeFileSync(path.join(dir, 'index.html'), readFileSync(path.join(clientRoot, 'index.html'), 'utf8'), 'utf8');

    const result = spawnSync(
        process.execPath,
        [
            path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
            // Same tsconfig the build passes: the client's root tsconfig.json is a
            // references-only stub, so without this JSX takes the classic transform.
            '--tsconfig', path.join(clientRoot, 'tsconfig.app.json'),
            path.join(scriptsDir, 'prerender-legal.mts'),
        ],
        { cwd: clientRoot, env: { ...process.env, CLIENT_DIST_DIR: dir }, encoding: 'utf8', windowsHide: true },
    );
    strictEqual(result.status, 0, `prerender-legal exited ${result.status}:\n${result.stderr}`);

    return { dir, files: readdirSync(path.join(dir, 'prerendered')) };
}

test('prerenders a static file for every legal page', () => {
    const { dir, files } = runPrerender();
    try {
        deepStrictEqual(
            files.sort(),
            LEGAL_PAGE_LINKS.map(link => `${link.slug}.html`).sort(),
            'every legal route needs a static copy, or that route still answers crawlers with an empty shell',
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the privacy policy is readable without executing JavaScript', () => {
    const { dir } = runPrerender();
    try {
        const html = readFileSync(path.join(dir, 'prerendered', 'privacy.html'), 'utf8');
        const body = visibleText(html);

        // The regression: this file used to be byte-identical to the SPA shell,
        // whose entire visible text is the boot splash. Length alone catches it.
        ok(body.length > 2000, `privacy page carried only ${body.length} chars of text — it is still a shell`);
        ok(body.includes('Privacy Policy'), 'privacy page is missing its own heading');
        ok(/information collected|personal information/i.test(body), 'privacy page has no policy content in it');

        // The name and the page identity, for the two checks that rejected the app.
        ok(body.includes('Shinobi Journey'), 'privacy page never states the app name');
        ok(/<title>Privacy Policy &mdash; Shinobi Journey<\/title>/.test(html), 'privacy page kept the generic home-page title');
        ok(html.includes('<link rel="canonical" href="https://shinobijourney.com/privacy" />'), 'privacy page still points its canonical at the home page');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a reader with JavaScript disabled is not covered by the boot splash', () => {
    const { dir } = runPrerender();
    try {
        const html = readFileSync(path.join(dir, 'prerendered', 'terms.html'), 'utf8');
        // The splash is position:fixed over the whole viewport. React clears it by
        // replacing #root, which never happens when scripts do not run — so
        // without this rule the policy text is present but unreadable.
        ok(
            /<noscript><style>#boot-splash\{display:none !important;\}<\/style><\/noscript>/.test(html),
            'nothing hides the fixed boot splash when scripts are disabled',
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
