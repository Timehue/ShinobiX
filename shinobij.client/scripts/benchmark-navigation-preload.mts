/** Local production-build navigation benchmark. APIs are deterministic fixtures;
 * this measures client loading/rendering, never server/database performance.
 * Run from the repo root with node --import tsx and pass --label / --output.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium, expect as baseExpect, type Page, type CDPSession } from '@playwright/test';
import { installUiAuditRuntime } from '../e2e/helpers/ui-audit-runtime';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Match the bounded slow-network action timeout; Playwright's standalone
// expect otherwise keeps a separate 5s default from page.setDefaultTimeout.
const expect = baseExpect.configure({ timeout: 30_000 });
const args = process.argv.slice(2);
function option(name: string, fallback: string) {
    const index = args.indexOf(`--${name}`);
    return index < 0 ? fallback : args[index + 1];
}
const label = option('label', 'local');
const output = resolve(repo, option('output', `test-results/performance-gauntlet-2026-09-16/navigation-${label}`));
const staticDir = resolve(repo, option('static-dir', 'shinobij.client/dist'));
const samples = Number(option('samples', '5'));
if (!Number.isInteger(samples) || samples < 5 || samples > 20) throw new Error('--samples must be between 5 and 20');
await readFile(resolve(staticDir, 'index.html'));
await mkdir(output, { recursive: true });

const port = await new Promise<number>((yes, no) => {
    const probe = createServer();
    probe.once('error', no);
    probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        if (!address || typeof address === 'string') return no(new Error('No local port'));
        probe.close(() => yes(address.port));
    });
});
const baseURL = `http://127.0.0.1:${port}`;
const env: NodeJS.ProcessEnv = {};
for (const [name, value] of Object.entries(process.env)) {
    if (/^(path|systemroot|windir|temp|tmp|userprofile|localappdata|programfiles|programfiles\(x86\)|comspec|pathext)$/i.test(name)) env[name] = value;
}
Object.assign(env, {
    NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', PORT: String(port), STATIC_DIR: staticDir,
    SESSION_SECRET: 'performance-local-only-32-byte-secret', ADMIN_PASSWORD: 'performance-local-only-admin',
    DISABLE_SCHEDULED_JOBS: '1', DISABLE_PRESENCE_STATE_JOBS: '1', DISABLE_REALTIME: '1', DISABLE_SNAPSHOT_CRON: '1', SENTRY_DSN: '',
});
const server = spawn(process.execPath, [resolve(repo, 'dist/server.js')], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-20_000); });
server.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-20_000); });

const profiles = [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, cpu: 1, saveData: false },
    { name: 'constrained-mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, cpu: 4, saveData: true },
];
const results: Record<string, unknown>[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pendingAssets = new WeakMap<Page, Set<string>>();

async function settledAssets(page: Page) {
    // Exclude recurring API polling. Every requested static asset must complete,
    // followed by two unchanged resource counts and a paint/task boundary.
    let previous = -1;
    let stable = 0;
    for (let attempts = 0; attempts < 120; attempts++) {
        const count = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /\.(?:js|css)(?:\?|$)/.test(e.name)).length);
        if (count === previous && pendingAssets.get(page)?.size === 0) stable++; else stable = 0;
        previous = count;
        if (stable >= 3) break;
        await page.waitForTimeout(200);
        if (attempts === 119) throw new Error('Static-asset loading did not settle in 24 seconds');
    }
    await page.evaluate(() => new Promise<void>(yes => requestAnimationFrame(() => setTimeout(yes, 0))));
}

async function snapshot(page: Page, session: CDPSession) {
    const [resources, metrics] = await Promise.all([
        page.evaluate(() => ({
            at: performance.now(),
            resources: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map(e => ({
                path: new URL(e.name).pathname, start: e.startTime, duration: e.duration,
                transferBytes: e.transferSize, encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize,
            })),
            longTasks: (window as unknown as { __longTasks?: unknown[] }).__longTasks ?? [],
            transitions: (window as unknown as { __screenTransitions?: unknown[] }).__screenTransitions ?? [],
        })),
        session.send('Performance.getMetrics'),
    ]);
    return { ...resources, cpu: Object.fromEntries(metrics.metrics.filter(m => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(m.name)).map(m => [m.name, m.value])) };
}

function resourceDelta(before: Awaited<ReturnType<typeof snapshot>> | null, after: Awaited<ReturnType<typeof snapshot>>) {
    const resources = after.resources.slice(before?.resources.length ?? 0);
    const code = resources.filter(resource => /\.(js|css)$/.test(resource.path));
    return {
        jsCssRequests: code.length,
        jsCssTransferBytes: code.reduce((sum, resource) => sum + resource.transferBytes, 0),
        jsCssEncodedBytes: code.reduce((sum, resource) => sum + resource.encodedBytes, 0),
        jsCssDecodedBytes: code.reduce((sum, resource) => sum + resource.decodedBytes, 0),
        requests: resources.length,
        transferBytes: resources.reduce((sum, resource) => sum + resource.transferBytes, 0),
        scriptMs: (after.cpu.ScriptDuration - (before?.cpu.ScriptDuration ?? 0)) * 1000,
        taskMs: (after.cpu.TaskDuration - (before?.cpu.TaskDuration ?? 0)) * 1000,
    };
}

async function enterBank(page: Page, activation: 'pointer' | 'keyboard') {
    const button = page.getByRole('button', { name: 'Enter Bank', exact: true });
    // Focus alone may request the module in the baseline, so begin timing first.
    const started = await page.evaluate(() => performance.now());
    if (activation === 'keyboard') { await button.focus(); await button.press('Enter'); }
    else await button.click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'bank');
    const input = page.locator('#bank-transfer-amount');
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
    await input.fill('10');
    await expect(input).toHaveValue('10');
    await expect(page.getByRole('button', { name: /deposit/i, exact: false }).first()).toBeEnabled();
    // Interaction feedback and the next paint are included; no money is moved.
    await page.evaluate(() => new Promise<void>(yes => requestAnimationFrame(() => yes())));
    return (await page.evaluate(() => performance.now())) - started;
}

async function returnVillage(page: Page) {
    await page.getByRole('button', { name: '← Village', exact: true }).first().click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
    await expect(page.getByRole('button', { name: 'Enter Bank', exact: true })).toBeEnabled();
}

try {
    for (let attempt = 0; attempt < 240; attempt++) {
        if (server.exitCode !== null) throw new Error(`Local Express exited ${server.exitCode}: ${serverOutput}`);
        const alive = await fetch(`${baseURL}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);
        if (alive) break;
        if (attempt === 239) throw new Error('Local Express startup exceeded 60 seconds');
        await new Promise(yes => setTimeout(yes, 250));
    }
    browser = await chromium.launch({ headless: true });
    const metadata = {
        label, samples, staticDir, servingPath: 'compiled dist/server.js Express',
        manifestSha256: createHash('sha256').update(await readFile(resolve(staticDir, '.vite/manifest.json'))).digest('hex'),
        runtime: process.version, browser: browser.version(), os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length, profiles,
        api: 'installUiAuditRuntime deterministic authenticated AuditNinja fixture; all API responses intercepted',
        cache: 'fresh browser context per sample; HTTP cache disabled by Playwright routing; service workers blocked; warm reentry means same-document module cache only',
        mobileNetwork: { latencyMs: 40, downloadBytesPerSecond: 200_000, uploadBytesPerSecond: 93_750 },
        limitations: 'Emulation is not real Android/WebView/GPU/battery evidence. Timings include browser automation actionability waits. No backend latency claim.',
    };
    await writeFile(resolve(output, 'metadata.json'), JSON.stringify(metadata, null, 2));
    for (const profile of profiles) {
        for (const journey of ['sweep', 'cold-first-entry'] as const) {
            for (let sample = 0; sample < samples; sample++) {
                const context = await browser.newContext({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: 'dark', locale: 'en-US' });
                const page = await context.newPage();
                page.setDefaultTimeout(30_000);
                const errors: string[] = [];
                const contentEncoding: Record<string, string> = {};
                const pending = new Set<string>();
                pendingAssets.set(page, pending);
                page.on('request', request => { if (['script', 'stylesheet', 'image', 'font'].includes(request.resourceType())) pending.add(request.url()); });
                page.on('requestfinished', request => pending.delete(request.url()));
                page.on('requestfailed', request => pending.delete(request.url()));
                page.on('pageerror', error => errors.push(error.message));
                page.on('response', response => {
                    const path = new URL(response.url()).pathname;
                    if (/\.(js|css)$/.test(path)) contentEncoding[path] = response.headers()['content-encoding'] ?? 'identity';
                });
                await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
                await context.routeWebSocket('**/*', socket => socket.close());
                await installUiAuditRuntime(page);
                // Raw script avoids tsx's keepNames helper being captured by the
                // browser-only getter when Playwright serializes this callback.
                await page.addInitScript({ content: `
                    if (navigator.connection) Object.defineProperty(navigator.connection, 'saveData', { configurable: true, get() { return ${profile.saveData}; } });
                    performance.setResourceTimingBufferSize(5000);
                ` });
                const session = await context.newCDPSession(page);
                await session.send('Performance.enable');
                await session.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
                if (profile.isMobile) {
                    await session.send('Network.enable');
                    await session.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 200_000, uploadThroughput: 93_750 });
                }
                await page.goto(`${baseURL}/#/village`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
                await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
                await expect(page.getByRole('button', { name: 'Enter Bank', exact: true })).toBeVisible();
                await expect(page.getByRole('button', { name: 'Enter Bank', exact: true })).toBeEnabled();
                const villageUsableMs = await page.evaluate(() => performance.now());
                await settledAssets(page);
                const initial = await snapshot(page, session);
                if (sample === 0 && journey === 'sweep') await page.screenshot({ path: resolve(output, `${profile.name}-village.png`), fullPage: true });
                if (journey === 'sweep') {
                    const cards = page.locator('.facility-tile');
                    for (let i = 0; i < await cards.count(); i++) {
                        // Desktop pointer travel; mobile keyboard/switch traversal.
                        // Neither interaction activates a destination.
                        if (profile.isMobile) await cards.nth(i).focus();
                        else await cards.nth(i).hover();
                    }
                    await page.mouse.move(0, 0);
                    await settledAssets(page);
                }
                const afterSweep = await snapshot(page, session);
                const firstEntryMs = await enterBank(page, profile.isMobile ? 'keyboard' : 'pointer');
                await settledAssets(page);
                const afterEntry = await snapshot(page, session);
                if (sample === 0 && journey === 'sweep') await page.screenshot({ path: resolve(output, `${profile.name}-bank.png`), fullPage: true });
                await returnVillage(page);
                const warmEntryMs = await enterBank(page, profile.isMobile ? 'keyboard' : 'pointer');
                let cycles: unknown;
                if (sample === 0 && journey === 'cold-first-entry') {
                    const measure = async () => {
                        await session.send('HeapProfiler.collectGarbage');
                        return { ...await session.send('Memory.getDOMCounters'), ...await session.send('Runtime.getHeapUsage') };
                    };
                    await returnVillage(page);
                    await settledAssets(page);
                    const before = await measure();
                    for (let cycle = 0; cycle < 12; cycle++) {
                        await enterBank(page, profile.isMobile ? 'keyboard' : 'pointer');
                        await returnVillage(page);
                    }
                    await settledAssets(page);
                    cycles = { count: 12, before, after: await measure() };
                }
                expect(errors).toEqual([]);
                const result = { profile: profile.name, journey, sample, villageUsableMs, firstEntryMs, warmEntryMs, initial: resourceDelta(null, initial), sweep: resourceDelta(initial, afterSweep), firstEntry: resourceDelta(afterSweep, afterEntry), cycles, errors };
                results.push(result);
                await writeFile(resolve(output, `${profile.name}-${journey}-${sample}.json`), JSON.stringify({ ...result, evidence: { initial, afterSweep, afterEntry, contentEncoding } }, null, 2));
                await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
                console.log(JSON.stringify(result));
                await context.close();
            }
        }
    }
    const summary: Record<string, unknown> = {};
    for (const profile of profiles) for (const journey of ['sweep', 'cold-first-entry']) {
        const rows = results.filter(row => row.profile === profile.name && row.journey === journey);
        const metrics: Record<string, unknown> = {};
        for (const metric of ['villageUsableMs', 'firstEntryMs', 'warmEntryMs', 'initial.jsCssTransferBytes', 'sweep.jsCssRequests', 'sweep.jsCssTransferBytes', 'sweep.scriptMs', 'firstEntry.jsCssRequests', 'firstEntry.jsCssTransferBytes']) {
            const values = rows.map(row => Number(metric.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], row))).sort((a, b) => a - b);
            const middle = Math.floor(values.length / 2);
            metrics[metric] = { samples: values.length, median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, min: values[0], max: values.at(-1) };
        }
        summary[`${profile.name}/${journey}`] = metrics;
    }
    await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
} finally {
    try {
        await browser?.close();
    } finally {
        server.kill();
        await Promise.race([new Promise(yes => server.once('exit', yes)), new Promise(yes => setTimeout(yes, 5_000))]);
        await writeFile(resolve(output, 'server.log'), serverOutput);
    }
}
