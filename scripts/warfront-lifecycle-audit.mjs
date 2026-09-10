import { chromium } from '../shinobij.client/node_modules/@playwright/test/index.mjs';
import { writeFile } from 'node:fs/promises';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:5178';
const force3d = process.argv.includes('--3d');
const forceCanvas = process.argv.includes('--canvas');
const mode = force3d ? '3d' : forceCanvas ? 'canvas' : 'auto';
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
    await page.addInitScript(({ forceCanvas }) => {
        if (forceCanvas) {
            const probe = document.createElement('canvas');
            const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
            if (context) {
                const debug = context.getExtension('WEBGL_debug_renderer_info');
                const renderer = String(context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER));
                localStorage.setItem('kage:warfront-render-route:v3', JSON.stringify({ version: 3, renderer, mode: 'model-impostor', proof: 'slow-observed', sample: null }));
                context.getExtension('WEBGL_lose_context')?.loseContext();
            }
        }
        const counters = { activeWorkers: 0, createdWorkers: 0, longTasks: [], contexts: [] };
        window.__warfrontAudit = counters;
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
            stopped = false;
            constructor(...args) { super(...args); counters.activeWorkers++; counters.createdWorkers++; }
            terminate() {
                if (!this.stopped) { counters.activeWorkers--; this.stopped = true; }
                return super.terminate();
            }
        };
        const originalContext = HTMLCanvasElement.prototype.getContext;
        const seen = new WeakSet();
        HTMLCanvasElement.prototype.getContext = function (...args) {
            const context = originalContext.apply(this, args);
            if (context && /webgl/.test(args[0]) && !seen.has(context)) {
                seen.add(context);
                counters.contexts.push(new WeakRef(context));
            }
            return context;
        };
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) counters.longTasks.push({ start: entry.startTime, ms: entry.duration });
        }).observe({ type: 'longtask', buffered: true });
    }, { forceCanvas });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const sample = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        const { metrics } = await cdp.send('Performance.getMetrics');
        const values = Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
        return {
            heapMB: Number((values.JSHeapUsedSize / 1048576).toFixed(2)),
            nodes: values.Nodes, listeners: values.JSEventListeners,
            ...(await page.evaluate(() => ({
                workers: window.__warfrontAudit.activeWorkers,
                createdWorkers: window.__warfrontAudit.createdWorkers,
                canvases: document.querySelectorAll('canvas').length,
                liveWebGlContexts: window.__warfrontAudit.contexts.filter((reference) => {
                    const context = reference.deref();
                    return context && !context.isContextLost();
                }).length,
            }))),
        };
    };
    await page.goto(`${baseURL}/petvfx.html?rite=1&petQuality=low&riteqa=1&avian=1&ritemotionqa=1${force3d ? '&riteforce3d=1' : ''}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByRole('heading', { name: 'Set your formation' }).waitFor({ timeout: 120_000 });
    const cycles = [];
    for (let cycle = 0; cycle < 4; cycle++) {
        if (cycle) {
            await page.getByRole('button', { name: 'Reopen Warfront' }).click();
            await page.getByRole('heading', { name: 'Set your formation' }).waitFor();
        }
        // Deployment can warm the exact roster before the player locks it.
        await page.waitForTimeout(1500);
        const started = await page.evaluate(() => performance.now());
        await page.getByRole('button', { name: 'Lock formation', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-testid="wfr-stage-curtain"]')?.getAttribute('data-stage-ready') === 'true', null, { timeout: 120_000 });
        const lockToReadyMs = Math.round(await page.evaluate(() => performance.now()) - started);
        await page.waitForTimeout(3500);
        const active = await sample();
        const paint = await page.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => ({ ...canvas.dataset })));
        if (cycle === 0) await page.screenshot({ path: `output/warfront-${mode}-tempest-hawk.png` });
        await page.getByRole('button', { name: 'Leave the Warfront', exact: true }).click();
        await page.getByRole('button', { name: 'Reopen Warfront' }).waitFor();
        // R3F disposes an unmounted renderer asynchronously.
        await page.waitForTimeout(1600);
        const closed = await sample();
        cycles.push({ cycle, lockToReadyMs, active, closed, paint });
        if (closed.workers !== 0 || closed.canvases !== 0 || closed.liveWebGlContexts !== 0) throw new Error(`Resources survived close: ${JSON.stringify(closed)}`);
    }
    const longTasks = await page.evaluate(() => window.__warfrontAudit.longTasks);
    const artifact = `docs/warfront-${mode}-lifecycle-audit.json`;
    await writeFile(artifact, JSON.stringify({ baseURL, mode, cycles, longTasks, errors }, null, 2));
    console.log(JSON.stringify({ artifact, cycles: cycles.map(({ paint: _paint, ...cycle }) => cycle), errorCount: errors.length, longTaskCount: longTasks.length }, null, 2));
    if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
