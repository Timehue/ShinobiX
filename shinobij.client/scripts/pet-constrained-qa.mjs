import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const out = new URL(`../../.tmp/${process.env.PET_CONSTRAINED_LABEL || 'pet-constrained-qa'}/`, import.meta.url);
await mkdir(out, { recursive: true });
const app = express();
app.use(compression());
app.use(express.json());
for (const path of ['../../.tmp/gauntlet-qa-dist/', '../dist/', '../../.tmp/sunscar-modes-qa-dist/', '../public/'])
    app.use(express.static(fileURLToPath(new URL(path, import.meta.url))));
// Local memory-only QA API; static assets above use the production gzip middleware.
app.use(async (req, res) => {
    const headers = { ...req.headers }; delete headers.host; delete headers['content-length']; delete headers['accept-encoding'];
    const response = await fetch('http://127.0.0.1:5199' + req.originalUrl, { method: req.method, headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}) });
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(Buffer.from(await response.arrayBuffer()));
});
const server = await new Promise(resolve => { const s = app.listen(5225, '127.0.0.1', () => resolve(s)); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=d3d11'] });
const report = { conditions: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, cpuSlowdown: 4,
    cores: 4, reportedMemoryGB: 2, downloadMbps: 1.6, uploadMbps: .75, latencyMs: 150,
    caveat: 'CPU/network throttling and mobile viewport on an RTX 3080. No GPU throttling; not a physical-phone benchmark.' }, samples: [], errors: [] };
const round = value => Math.round(value * 100) / 100;
try {
    for (const mode of ['gauntlet', 'colosseum', 'rally'].filter(mode => !process.env.PET_CONSTRAINED_MODE || process.env.PET_CONSTRAINED_MODE === mode)) {
        const context = await browser.newContext({ viewport: report.conditions.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await context.newPage(); page.setDefaultTimeout(120000);
        page.on('pageerror', error => report.errors.push({ mode, message: error.message }));
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1600000 / 8, uploadThroughput: 750000 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
            let frames = [], drawing = false;
            const contexts = [], seen = new WeakSet(), get = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (...args) {
                const gl = get.apply(this, args);
                if (!gl || !String(args[0]).includes('webgl') || seen.has(gl)) return gl;
                seen.add(gl); const debug = gl.getExtension('WEBGL_debug_renderer_info');
                contexts.push({ renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), canvas: this });
                for (const key of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
                    const draw = gl[key].bind(gl); gl[key] = (...values) => { drawing = true; return draw(...values); };
                }
                return gl;
            };
            const raf = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = callback => raf(t => { drawing = false; callback(t); if (drawing) frames.push(t); });
            window.petConstrainedProbe = { reset() { frames = []; }, snapshot() { return { frames,
                contexts: contexts.map(c => ({ renderer: c.renderer, width: c.canvas.width, height: c.canvas.height })) }; } };
        });
        const sample = { mode }, started = performance.now();
        if (mode === 'gauntlet') {
            await page.goto('http://127.0.0.1:5225/gauntlet-qa.html?benchmark&full');
            const entry = performance.now(); sample.shellReadyMs = round(entry - started);
            await page.getByRole('button', { name: 'Mount', exact: true }).click();
            await page.locator('[data-loading="false"]').waitFor();
            sample.modelsReadyAfterEntryMs = round(performance.now() - entry);
            assert.equal(await page.getByText('Battle resolved safely').count(), 0);
            await page.locator('[data-summoning="false"]').waitFor();
            sample.quality = await page.locator('.gauntlet-board-build').innerText();
            assert.match(sample.quality, /low/i);
        } else if (mode === 'colosseum') {
            await page.goto('http://127.0.0.1:5225/showdownpreview.html?vfxreview&play&move=4&rosterpet=standard-0&enemypet=rare-24');
            await page.locator('canvas').waitFor();
            sample.quality = await page.getByRole('combobox', { name: /quality|visual/i }).count() ? await page.getByRole('combobox', { name: /quality|visual/i }).inputValue() : await page.locator('.pet-showdown').getAttribute('data-quality').catch(() => null);
        } else {
            await page.request.post('http://127.0.0.1:5199/__qa/reset');
            await page.goto('http://127.0.0.1:5225/sunscar-modes-qa.html');
            await page.getByRole('button', { name: 'Visit the race grounds' }).click();
            await page.getByRole('button', { name: 'Practice selected course' }).click();
            const entry = performance.now();
            await page.getByRole('button', { name: 'Ready to race' }).click();
            sample.modelsReadyAfterEntryMs = round(performance.now() - entry);
            await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 120);
            sample.quality = await page.evaluate(() => window.sunscarRallyQa.quality);
            assert.equal(sample.quality, 'light');
        }
        sample.readyFromNavigationMs = round(performance.now() - started);
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.petConstrainedProbe.reset());
        if (mode === 'rally') { await page.keyboard.press('Space'); await page.keyboard.press('KeyE'); }
        await page.waitForTimeout(12000);
        sample.capture = await page.evaluate(() => window.petConstrainedProbe.snapshot());
        const gaps = sample.capture.frames.slice(1).map((t, i) => t - sample.capture.frames[i]).sort((a, b) => a - b);
        assert.ok(gaps.length > 30);
        sample.fps = round(gaps.length * 1000 / gaps.reduce((a, b) => a + b, 0));
        sample.p95Ms = round(gaps[Math.floor(gaps.length * .95)]); sample.worstMs = round(gaps.at(-1));
        sample.resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({ name: r.name, transferSize: r.transferSize, duration: r.duration })));
        if (mode === 'rally') {
            const models = sample.resources.filter(resource => resource.name.includes('.glb')).map(resource => resource.name);
            assert.equal(models.length, new Set(models).size, 'Atlas and rig must share one cold GLB request per pet');
        }
        await page.screenshot({ path: fileURLToPath(new URL(`${mode}.png`, out)) });
        if (mode === 'gauntlet') {
            await page.getByRole('button', { name: 'Unmount', exact: true }).click(); await page.waitForTimeout(1500);
            const warm = performance.now(); await page.getByRole('button', { name: 'Mount', exact: true }).click();
            await page.locator('[data-loading="false"]').waitFor(); sample.warmModelsReadyMs = round(performance.now() - warm);
        }
        report.samples.push(sample);
        console.log(JSON.stringify({ mode, readyMs: sample.readyFromNavigationMs, modelsMs: sample.modelsReadyAfterEntryMs, warmModelsMs: sample.warmModelsReadyMs, fps: sample.fps, p95Ms: sample.p95Ms, worstMs: sample.worstMs, quality: sample.quality }));
        await context.close();
        await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    }
    assert.deepEqual(report.errors, []);
} finally { await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2)); await browser.close(); server.close(); }
