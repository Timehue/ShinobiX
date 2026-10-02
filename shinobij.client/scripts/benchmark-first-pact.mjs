import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Local diagnostics, not a device certification. Compare the same optimized
// preview, browser, viewport, DPR, throttle and input sequence on this machine.
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5186';
const label = process.argv[3] ?? 'candidate';
const repetitions = Number(process.argv[4] ?? 3);
const output = resolve('output', 'first-pact-performance', label);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const profile of [
        { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
        { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    ]) {
        for (let run = 0; run < repetitions; run++) {
            const context = await browser.newContext({ ...profile, reducedMotion: 'no-preference', serviceWorkers: 'block' });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(String(error)));
            const cdp = await context.newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
            await page.addInitScript(() => {
                const data = window.__fpBench = { phase: 'boot', phases: {}, largeCanvases: [], readyMs: null };
                const bucket = () => data.phases[data.phase] ??= { callbacks: [], longTasks: [], cacheClears: 0, cacheArea: 0, worldBlits: 0 };
                const request = window.requestAnimationFrame.bind(window);
                window.requestAnimationFrame = callback => request(now => {
                    const start = performance.now();
                    const phase = bucket();
                    try { callback(now); } finally { phase.callbacks.push(performance.now() - start); }
                });
                new PerformanceObserver(entries => {
                    for (const entry of entries.getEntries()) bucket().longTasks.push(entry.duration);
                }).observe({ type: 'longtask', buffered: true });
                const clear = CanvasRenderingContext2D.prototype.clearRect;
                CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                    if (!this.canvas.isConnected && this.canvas.width > 1000) {
                        const phase = bucket();
                        phase.cacheClears++;
                        phase.cacheArea += args[2] * args[3];
                        if (!data.largeCanvases.some(size => size.width === this.canvas.width && size.height === this.canvas.height)) {
                            data.largeCanvases.push({ width: this.canvas.width, height: this.canvas.height });
                        }
                    }
                    return clear.apply(this, args);
                };
                const draw = CanvasRenderingContext2D.prototype.drawImage;
                CanvasRenderingContext2D.prototype.drawImage = function (...args) {
                    if (this.canvas.classList.contains('fp-world-canvas')) bucket().worldBlits++;
                    return draw.apply(this, args);
                };
                new MutationObserver(() => {
                    if (data.readyMs == null && document.querySelector('[data-fp-render-ready="true"]')) data.readyMs = performance.now();
                }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-fp-render-ready'] });
            });
            await page.goto(`${baseUrl}/firstpactpreview.html?state=world`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelector('[data-fp-render-ready="true"]'), undefined, { timeout: 60000 }).catch(async error => {
                await page.screenshot({ path: resolve(output, `${profile.name}-failure.png`) });
                console.error(JSON.stringify({ errors, canvas: await page.locator('.fp-world-canvas').evaluate(canvas => ({ ready: canvas.dataset.fpRenderReady, proof: canvas.dataset.fpRenderProof })) }));
                throw error;
            });
            await page.waitForTimeout(1800);
            if (run === 0) await page.screenshot({ path: resolve(output, `${profile.name}-world.png`) });
            await page.evaluate(() => { window.__fpBench.phase = 'idle'; });
            await page.waitForTimeout(1200);
            await page.evaluate(() => { window.__fpBench.phase = 'movement'; });
            for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']) {
                await page.keyboard.down(key);
                await page.waitForTimeout(650);
                await page.keyboard.up(key);
            }
            await page.waitForTimeout(250);
            const metrics = await page.evaluate(() => {
                const quantile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1] : 0;
                return {
                    readyMs: window.__fpBench.readyMs,
                    largeCanvases: window.__fpBench.largeCanvases,
                    resources: performance.getEntriesByType('resource').filter(r => /\.(js|png|webp)(\?|$)/.test(r.name)).reduce((sum, r) => ({ bytes: sum.bytes + r.encodedBodySize, requests: sum.requests + 1 }), { bytes: 0, requests: 0 }),
                    scripts: performance.getEntriesByType('resource').filter(r => /\.js(\?|$)/.test(r.name)).map(r => ({ url: r.name, bytes: r.encodedBodySize })),
                    phases: Object.fromEntries(Object.entries(window.__fpBench.phases).map(([phase, data]) => [phase, {
                        callbackCount: data.callbacks.length,
                        callbackP95Ms: quantile(data.callbacks, .95),
                        callbackMaxMs: Math.max(0, ...data.callbacks),
                        longTaskCount: data.longTasks.length,
                        longTaskTotalMs: data.longTasks.reduce((sum, duration) => sum + duration, 0),
                        cacheClears: data.cacheClears,
                        cacheArea: data.cacheArea,
                        worldBlits: data.worldBlits,
                    }])),
                };
            });
            if (errors.length) throw new Error(errors.join('\n'));
            results.push({ profile: profile.name, run, cpuThrottle: 4, metrics, errors });
            console.log(JSON.stringify(results.at(-1)));
            await context.close();
        }
    }
    await writeFile(resolve(output, 'results.json'), JSON.stringify({ label, note: 'Headless Chromium diagnostics with 4x CPU throttle; no real-phone or GPU certification.', results }, null, 2));
} finally {
    await browser.close();
}
