// Run after building: node --test scripts/check-http-security-browser.mjs
// Real Chromium/WebKit policy enforcement; external scripts are local fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, webkit } from '../shinobij.client/node_modules/@playwright/test/index.mjs';
import { contentSecurityPolicy } from '../dist/api/_http-security.js';

const canonical = 'https://static.cloudflareinsights.com/beacon.min.js';
const versioned = canonical + '/v-test-version';
const otherPath = 'https://static.cloudflareinsights.com/unrelated.js';
const otherOrigin = 'https://untrusted.invalid/beacon.min.js';

for (const engine of [chromium, webkit]) test(`${engine.name()}: beacon policy and script boundaries`, async () => {
    const browser = await engine.launch();
    const policies = {
        before: contentSecurityPolicy({}).replaceAll(' ' + canonical + '/', '').replaceAll(' ' + canonical, ''),
        after: contentSecurityPolicy({}),
    };
    const server = createServer((req, res) => {
        if (req.url === '/probe.js') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(`window.sameOriginRan = true;
                try { (0, eval)('window.evalRan = true'); } catch { window.evalBlocked = true; }
                WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]))
                    .then(() => window.wasmAllowed = true, () => window.wasmAllowed = false);`);
            return;
        }
        const policy = req.url === '/before' ? policies.before : policies.after;
        res.setHeader('Content-Security-Policy', policy);
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><script>window.inlineRan = true</script>
            <script src="/probe.js"></script>
            ${[canonical, versioned, otherPath, otherOrigin].map(url => `<script src="${url}"></script>`).join('')}`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address !== 'string');
    try {
        for (const phase of ['before', 'after']) {
            const context = await browser.newContext({ serviceWorkers: 'block' });
            try {
                const fetched = [];
                await context.route('https://**/*', async route => {
                    const url = route.request().url();
                    fetched.push(url);
                    await route.fulfill({ contentType: 'text/javascript', body:
                        `(window.externalRan ??= []).push(${JSON.stringify(url)})` });
                });
                const page = await context.newPage();
                await page.goto(`http://127.0.0.1:${address.port}/${phase}`);
                await page.waitForFunction(() => typeof window.wasmAllowed === 'boolean');
                const observed = await page.evaluate(() => {
                    const w = window;
                    return { sameOrigin: w.sameOriginRan, inline: Boolean(w.inlineRan), eval: Boolean(w.evalRan),
                        evalBlocked: w.evalBlocked, wasm: w.wasmAllowed, external: w.externalRan ?? [] };
                });
                assert.deepEqual(observed, { sameOrigin: true, inline: false, eval: false, evalBlocked: true,
                    wasm: true, external: phase === 'after' ? [canonical, versioned] : [] });
                assert.deepEqual(fetched.sort(), phase === 'after' ? [canonical, versioned].sort() : []);
            } finally { await context.close(); }
        }
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(() => resolve()));
    }
});
