/** Local release-serving benchmark. No external target, credentials, or routed API mocks. */
import { chromium, expect as baseExpect, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';

const root = fileURLToPath(new URL('../../', import.meta.url));
const expect = baseExpect.configure({ timeout: 30_000 });
const output = resolve(root, process.argv[2] ?? 'test-results/performance-gauntlet-2026-09-16/startup');
const samples = Number(process.env.PERF_SAMPLES ?? 5);
if (!Number.isInteger(samples) || samples < 1 || samples > 10) throw new Error('PERF_SAMPLES must be 1..10');
await mkdir(output, { recursive: true });
const reservation = createServer();
await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
const address = reservation.address();
if (!address || typeof address === 'string') throw new Error('Missing loopback port');
const port = address.port;
await new Promise<void>(done => reservation.close(() => done()));
const baseURL = `http://127.0.0.1:${port}`;
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
    if (/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|COMSPEC|PATHEXT)$/i.test(key) && value) env[key] = value;
}
Object.assign(env, {
    NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', PORT: String(port),
    SESSION_SECRET: 'performance-local-disposable-session-secret',
    ADMIN_PASSWORD: 'performance-local-disposable-admin',
    DISABLE_SCHEDULED_JOBS: '1', DISABLE_PRESENCE_STATE_JOBS: '1',
    DISABLE_REALTIME: '1', DISABLE_SNAPSHOT_CRON: '1', SENTRY_DSN: '',
});
const server = spawn(process.execPath, ['dist/server.js'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
let serverError: Error | undefined;
server.on('error', error => { serverError = error; });
let browser: Browser | undefined;
const rows: any[] = [];
const profiles = [
    { name: 'desktop', viewport: { width: 1366, height: 768 }, cpu: 1, latency: 0, down: -1, up: -1 },
    { name: 'mobile-emulated', viewport: { width: 390, height: 844 }, cpu: 4, latency: 40, down: 200_000, up: 93_750 },
];
try {
    const deadline = Date.now() + 60_000;
    while (true) {
        if (serverError) throw serverError;
        if (server.exitCode !== null) throw new Error(`Local server exited ${server.exitCode}`);
        if (await fetch(`${baseURL}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false)) break;
        if (Date.now() > deadline) throw new Error('Local server readiness timeout');
        await new Promise(done => setTimeout(done, 200));
    }
    browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    for (const profile of profiles) for (let sample = 0; sample < samples; sample++) {
        const context = await browser.newContext({ baseURL, viewport: profile.viewport,
            isMobile: profile.cpu > 1, hasTouch: profile.cpu > 1, serviceWorkers: 'block', reducedMotion: 'reduce' });
        context.setDefaultTimeout(30_000);
        context.setDefaultNavigationTimeout(60_000);
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Performance.enable');
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency,
            downloadThroughput: profile.down, uploadThroughput: profile.up });
        const traffic = new Map<string, any>();
        const failures: string[] = [];
        let networkCanceled = 0;
        let action: { acknowledgmentMs: number; renderedMs: number; canonicalLocalSaveVerified: boolean } | null = null;
        page.on('pageerror', error => failures.push(error.name));
        page.on('dialog', dialog => { failures.push('unexpected-dialog'); void dialog.dismiss(); });
        cdp.on('Network.responseReceived', ({ requestId, response, type }) => {
            const url = new URL(response.url);
            if (url.origin !== baseURL) return;
            traffic.set(requestId, { path: url.pathname.replace(/\/api\/save\/[^/]+/, '/api/save/:fixture'), type,
                status: response.status, encoding: response.headers['Content-Encoding'] ?? response.headers['content-encoding'] ?? null,
                cacheControl: response.headers['Cache-Control'] ?? response.headers['cache-control'] ?? null,
                cached: Boolean(response.fromDiskCache || response.fromServiceWorker), transferredBytes: 0 });
        });
        cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
            const row = traffic.get(requestId); if (row) row.transferredBytes = encodedDataLength;
        });
        cdp.on('Network.loadingFailed', ({ requestId, canceled, blockedReason }) => {
            const row = traffic.get(requestId);
            if (row) row.failed = true;
            // Avoid URLs and browser error text, which may contain private
            // request details. Navigation cancellation is recorded separately.
            if (canceled) networkCanceled++;
            else failures.push(`NetworkFailed:${blockedReason ?? 'transport'}`);
        });
        await page.addInitScript(() => {
            const w = window as any;
            w.__lab = { lcp: 0, cls: 0, longTasks: [], interactions: [] };
            for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask', 'event']) {
                try { new PerformanceObserver(list => {
                    for (const e of list.getEntries() as any) {
                        if (type === 'largest-contentful-paint') w.__lab.lcp = e.startTime;
                        if (type === 'layout-shift' && !e.hadRecentInput) w.__lab.cls += e.value;
                        if (type === 'longtask' && w.__lab.longTasks.length < 1000) w.__lab.longTasks.push(e.duration);
                        if (type === 'event' && e.interactionId && w.__lab.interactions.length < 1000) w.__lab.interactions.push(e.duration);
                    }
                }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) }); } catch { /* browser support */ }
            }
            localStorage.setItem('shinobix:storage-notice-ack', '1');
            localStorage.setItem('patchNotes.lastSeenVersion.v1', '2026.07.28-stat-leveling');
            localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        });
        const measure = async (journey: string, ready: () => Promise<void>) => {
            traffic.clear(); failures.length = 0; action = null; networkCanceled = 0;
            const start = performance.now();
            await ready();
            const usableMs = performance.now() - start;
            await page.waitForTimeout(3000); // Fixed observation window, not a readiness assertion.
            const metrics = await page.evaluate(() => {
                const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
                return { ...(window as any).__lab, navigation: { ttfbMs: navigation.responseStart, domContentLoadedMs: navigation.domContentLoadedEventEnd },
                    resourceTransferBytes: performance.getEntriesByType('resource').reduce((sum, e) => sum + (e as PerformanceResourceTiming).transferSize, 0),
                    domNodes: document.querySelectorAll('*').length };
            });
            const final = await cdp.send('Performance.getMetrics');
            const finalMetrics = Object.fromEntries(final.metrics.map(m => [m.name, m.value]));
            rows.push({ profile: profile.name, sample, journey, usableMs, ...metrics,
                // Chromium resets these counters on each full navigation.
                scriptDurationMs: finalMetrics.ScriptDuration * 1000,
                taskDurationMs: finalMetrics.TaskDuration * 1000,
                heapBytes: finalMetrics.JSHeapUsedSize, action, networkCanceled, failures: [...failures], resources: [...traffic.values()] });
            if (sample === 0) await page.screenshot({ path: resolve(output, `${profile.name}-${journey}.png`) });
            console.log(`${profile.name} ${sample + 1}/${samples} ${journey}: ${Math.round(usableMs)}ms`);
        };
        await measure('landing-cold', async () => {
            await page.goto('/', { waitUntil: 'domcontentloaded' });
            await expect(page.getByTestId('start-create')).toBeVisible();
            await expect(page.getByTestId('start-create')).toBeEnabled();
            await page.getByRole('button', { name: 'Log In', exact: true }).first().click();
            await page.getByRole('button', { name: 'Use a name and password', exact: true }).click();
            await expect(page.getByPlaceholder('Enter existing shinobi name')).toBeVisible();
        });
        await measure('landing-warm', async () => {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expect(page.getByTestId('start-create')).toBeVisible();
            await expect(page.getByTestId('start-create')).toBeEnabled();
        });
        const name = `perflab${profile.cpu}${sample}`;
        const register = await context.request.post('/api/player-auth', { data: { action: 'register', name, password: 'LocalPerf!2941' } });
        if (!register.ok()) throw new Error(`Local register ${register.status()}`);
        const token = String((await register.json()).token ?? '');
        if (!token) throw new Error('Local registration missing token');
        const fixture = uiAuditSave();
        fixture.character = { ...fixture.character, name };
        const seeded = await context.request.post(`/api/save/${name}?signal=1`, {
            headers: { 'x-admin-password': env.ADMIN_PASSWORD }, data: fixture });
        if (!seeded.ok()) throw new Error(`Local seed ${seeded.status()}`);
        const ack = await context.request.post(`/api/save/${name}?ack=1`, {
            headers: { 'x-player-name': name, 'x-player-token': token } });
        if (!ack.ok()) throw new Error(`Local signal acknowledgment ${ack.status()}`);
        await page.addInitScript(({ name, token }) => {
            localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
            localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
            localStorage.setItem('shinobix:activePlayerPersist', name);
            localStorage.setItem('shinobix:activeTokenPersist', token);
        }, { name, token });
        const useBank = async () => {
            await page.locator('#bank-transfer-amount').fill('1');
            const deposit = page.getByRole('button', { name: 'Deposit to vault', exact: true });
            await expect(deposit).toBeEnabled();
            const started = performance.now();
            const [response] = await Promise.all([
                page.waitForResponse(response => new URL(response.url()).pathname === '/api/bank/transfer'
                    && response.request().method() === 'POST'), deposit.click(),
            ]);
            const settled = await response.json();
            if (!response.ok() || !settled.character || !Number.isSafeInteger(settled._saveVersion)) {
                throw new Error(`Local bank action failed ${response.status()}`);
            }
            const acknowledgmentMs = performance.now() - started;
            await expect(page.getByText('Deposited 1 ryo to your vault.', { exact: true })).toBeVisible();
            const renderedMs = performance.now() - started;
            const canonicalResponse = await context.request.get(`/api/save/${name}`, {
                headers: { 'x-admin-password': env.ADMIN_PASSWORD },
            });
            if (!canonicalResponse.ok()) throw new Error('Could not verify local bank persistence');
            const canonical = await canonicalResponse.json();
            if (canonical.character?.bankRyo !== settled.character.bankRyo || canonical._saveVersion < settled._saveVersion) {
                throw new Error('Local bank response differs from canonical local save');
            }
            action = { acknowledgmentMs, renderedMs, canonicalLocalSaveVerified: true };
        };
        await measure('returning-feature-cold', async () => {
            // The application reads deep links at boot; a hash-only change is
            // not navigation. The query makes this a new document.
            await page.goto('/?lab=return#/village', { waitUntil: 'domcontentloaded' });
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
            await expect(page.getByRole('button', { name: 'Enter Bank', exact: true })).toBeEnabled();
            await page.getByRole('button', { name: 'Enter Bank', exact: true }).click();
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'bank');
            await useBank();
        });
        await measure('returning-warm', async () => {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'bank');
            await useBank();
        });
        await context.close();
    }
} finally {
    try {
        await browser?.close();
    } finally {
        server.kill();
        const manifest = await readFile(resolve(root, 'shinobij.client/dist/.vite/manifest.json'));
        await writeFile(resolve(output, 'results.json'), JSON.stringify({ schema: 2, browser: browser?.version() ?? null, profiles, samples,
            manifestSha256: createHash('sha256').update(manifest).digest('hex'),
            environment: 'Local compiled Express, disposable memory KV, warm server, no API mocks, SW blocked, external DNS blocked. Mobile is emulation; Chromium HTTP cache enabled. Timings include Playwright readiness assertions.',
            limitations: 'No production DB, CDN, physical Android, field INP, GPU or battery claims. Landing-cold includes opening the login form. Returning feature-cold includes first Bank entry; returning-warm restores Bank. Both returning journeys submit a deposit, check its acknowledgment and rendered result, and verify the canonical save in disposable local memory storage; this does not establish database durability. Layout shift is observed-window total, not session-window field CLS. DNS blackholing blocks nonlocal hostnames; it is not a literal-IP network firewall.', rows }, null, 2));
    }
}
