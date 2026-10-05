import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

// Build the three QA entries first and start sunscar-modes-qa-server.mts.
// Full Chromium is intentional: Playwright's headless shell uses SwiftShader.
const out = new URL(`../../.tmp/${process.env.PET_OUTPUT_DIR || 'pet-hardware-performance'}/`, import.meta.url);
const effects = process.env.PET_PROFILE === 'effects';
const gauntletOnly = process.env.PET_PROFILE === 'gauntlet';
const cinematicOnly = process.env.PET_PROFILE === 'cinematic';
const reportName = effects ? 'effects-measurements.json' : gauntletOnly ? 'gauntlet-measurements.json' : cinematicOnly ? 'cinematic-measurements.json' : 'measurements.json';
await mkdir(out, { recursive: true });
const app = express();
app.use(express.static(fileURLToPath(new URL('../../.tmp/gauntlet-qa-dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
const server = await new Promise(resolve => { const server = app.listen(5211, '127.0.0.1', () => resolve(server)); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=d3d11'] });
const report = { at: new Date().toISOString(), viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    durationMs: Number(process.env.PET_SAMPLE_MS || 15000), repeats: Number(process.env.PET_REPEATS || 3),
    methodology: 'Production QA builds on local HTTP; fresh browser contexts. Five-second warmup after readiness. Only animation-frame callbacks that submit WebGL draws count as rendered frames. CPU timings cover those callbacks, not the entire main thread. No GPU-duration claim. Frame rates may be capped by compositor pacing. Gauntlet uses a fixed high-HP ten-pet fixture to keep all actors alive. LOD comparison changes meshes only. Other application changes have no before/after baseline.',
    errors: [], samples: [] };

function installFrameProbe() {
    let frames = [], longTasks = [], active = null;
    const contexts = [], seen = new WeakSet();
    const originalContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
        const gl = originalContext.apply(this, args);
        if (!gl || !String(args[0]).includes('webgl') || seen.has(gl)) return gl;
        seen.add(gl);
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const context = { renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), canvas: this };
        contexts.push(context);
        for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
            if (!gl[name]) continue;
            const draw = gl[name].bind(gl);
            gl[name] = (...values) => {
                if (active) {
                    const count = values[name.startsWith('drawArrays') ? 2 : 1];
                    const instances = name.endsWith('Instanced') ? values[name.startsWith('drawArrays') ? 3 : 4] : 1;
                    active.calls++;
                    active.triangles += (values[0] === 4 ? count / 3 : values[0] === 5 || values[0] === 6 ? Math.max(0, count - 2) : 0) * instances;
                }
                return draw(...values);
            };
        }
        return gl;
    };
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(time => {
        const started = performance.now();
        active = { time, calls: 0, triangles: 0, cpuMs: 0 };
        try { callback(time); } finally {
            active.cpuMs = performance.now() - started;
            if (active.calls && frames.length < 20000) frames.push(active);
            active = null;
        }
    });
    new PerformanceObserver(list => { longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))); })
        .observe({ type: 'longtask', buffered: false });
    window.petFrameProbe = {
        reset() { frames = []; longTasks = []; },
        snapshot() { return { frames, longTasks, contexts: contexts.map(c => ({ renderer: c.renderer, width: c.canvas.width, height: c.canvas.height })),
            heapBytes: performance.memory?.usedJSHeapSize ?? null }; },
    };
}
const quantile = (values, p) => { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))] ?? null; };
const round = n => n == null ? null : Math.round(n * 100) / 100;
function summarize(capture) {
    const frames = capture.frames;
    const gaps = frames.slice(1).map((frame, i) => frame.time - frames[i].time).filter(n => n > 0);
    const elapsed = gaps.reduce((sum, n) => sum + n, 0);
    return { renderedFrames: frames.length, fps: round(gaps.length * 1000 / elapsed),
        frameMsP50: round(quantile(gaps, .5)), frameMsP95: round(quantile(gaps, .95)), frameMsP99: round(quantile(gaps, .99)),
        worstFrameMs: round(Math.max(...gaps)), framesOver33msPct: round(gaps.filter(n => n > 33.4).length / gaps.length * 100),
        framesOver50ms: gaps.filter(n => n > 50).length, renderCallbackCpuMsP95: round(quantile(frames.map(f => f.cpuMs), .95)),
        callsP50: round(quantile(frames.map(f => f.calls), .5)), trianglesP50: round(quantile(frames.map(f => f.triangles), .5)),
        longTasks: capture.longTasks.length, longestTaskMs: round(Math.max(0, ...capture.longTasks.map(t => t.duration))) };
}
const scenarios = cinematicOnly ? [{ mode: 'colosseum', quality: 'high', action: 'signature' }] : gauntletOnly ? [{ mode: 'gauntlet', quality: 'medium', lod: true }] : effects ? [
    { mode: 'colosseum', quality: 'medium', action: 'signature' },
    { mode: 'colosseum', quality: 'high', action: 'signature' },
    { mode: 'rally', quality: 'full', action: 'jump-burst-technique' },
] : [
    { mode: 'gauntlet', quality: 'medium', lod: true },
    { mode: 'gauntlet', quality: 'medium', lod: false },
    { mode: 'gauntlet', quality: 'high', lod: true },
    { mode: 'colosseum', quality: 'medium' },
    { mode: 'colosseum', quality: 'high' },
    { mode: 'rally', quality: 'full' },
    { mode: 'rally', quality: 'light' },
];
try {
    const cdp = await browser.newBrowserCDPSession();
    report.browser = await cdp.send('Browser.getVersion');
    report.gpu = (await cdp.send('SystemInfo.getInfo')).gpu;
    assert.ok(report.gpu.devices.some(device => /NVIDIA/.test(device.deviceString)) && report.gpu.featureStatus.webgl === 'enabled', 'Hardware acceleration required');
    const control = await browser.newPage();
    report.compositorControl = await control.evaluate(async () => {
        const samples = [];
        await new Promise(resolve => {
            const tick = t => { samples.push(t); if (samples.length < 121) requestAnimationFrame(tick); else resolve(); };
            requestAnimationFrame(tick);
        });
        return { fps: 120000 / (samples.at(-1) - samples[0]), samples };
    });
    await control.close();
    for (let repeat = 0; repeat < report.repeats; repeat++) {
        // Reverse alternate passes to reduce a fixed warmup/order bias.
        for (const scenario of repeat % 2 ? [...scenarios].reverse() : scenarios) {
            const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => report.errors.push({ ...scenario, repeat, message: error.message }));
            await page.addInitScript(installFrameProbe);
            const sample = { ...scenario, repeat: repeat + 1 };
            if (scenario.mode === 'gauntlet') {
                await page.goto(`http://127.0.0.1:5211/gauntlet-qa.html?benchmark&full&petQuality=${scenario.quality}&ritelod=${scenario.lod ? 1 : 0}`);
                const started = performance.now();
                await page.getByRole('button', { name: 'Mount', exact: true }).click();
                await page.locator('[data-loading="false"]').waitFor();
                sample.modelsReadyMs = round(performance.now() - started);
                assert.equal(await page.getByText('Battle resolved safely').count(), 0);
                await page.locator('[data-summoning="false"]').waitFor();
                sample.summonsDoneMs = round(performance.now() - started);
            } else if (scenario.mode === 'colosseum') {
                await page.goto(`http://127.0.0.1:5211/showdownpreview.html?vfxreview&play&move=${scenario.action === 'signature' ? 4 : 1}&petQuality=${scenario.quality}&rosterpet=standard-0&enemypet=rare-24`);
                await page.locator('canvas').waitFor();
            } else {
                await page.request.post('http://127.0.0.1:5199/__qa/reset');
                await page.addInitScript(light => localStorage.setItem('liteFx.v1', light ? '1' : '0'), scenario.quality === 'light');
                await page.goto('http://127.0.0.1:5199/sunscar-modes-qa.html');
                await page.getByRole('button', { name: 'Visit the race grounds' }).click();
                await page.getByRole('button', { name: 'Practice selected course' }).click();
                await page.getByRole('button', { name: 'Ready to race' }).click();
                await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 120);
            }
            await page.waitForTimeout(5000);
            sample.startState = await page.evaluate(() => ({ rally: window.sunscarRallyQa ?? null,
                round: document.querySelector('.gauntlet-board-round strong')?.textContent ?? null }));
            await page.evaluate(() => window.petFrameProbe.reset());
            if (scenario.action === 'jump-burst-technique') {
                await page.keyboard.down('Shift');
                await page.keyboard.press('Space');
                await page.waitForTimeout(2000);
                await page.keyboard.press('KeyE');
                await page.keyboard.up('Shift');
                await page.waitForTimeout(2000);
                await page.keyboard.press('Space');
                await page.waitForTimeout(Math.max(0, report.durationMs - 4000));
            } else await page.waitForTimeout(report.durationMs);
            sample.capture = await page.evaluate(() => window.petFrameProbe.snapshot());
            sample.endState = await page.evaluate(() => ({ rally: window.sunscarRallyQa ?? null,
                round: document.querySelector('.gauntlet-board-round strong')?.textContent ?? null }));
            assert.ok(sample.capture.contexts.every(c => /NVIDIA/.test(c.renderer)), 'Every game context must use NVIDIA');
            assert.ok(sample.capture.frames.length > 30, 'Must measure active rendering');
            if (scenario.mode === 'gauntlet') assert.equal(await page.getByRole('button', { name: 'Continue the run' }).count(), 0, 'Gauntlet must remain in combat');
            if (scenario.mode === 'rally') assert.equal(sample.endState.rally.state.finished, false, 'Rally must remain in motion');
            if (scenario.mode === 'rally') assert.equal(sample.endState.rally.quality, scenario.quality, 'Record the requested actual render quality');
            if (scenario.action === 'jump-burst-technique') assert.equal(sample.endState.rally.state.racers[0].techniqueUsed, true, 'The technique input must reach gameplay');
            sample.summary = summarize(sample.capture);
            report.samples.push(sample);
            if (repeat === 0) await page.screenshot({ path: fileURLToPath(new URL(`${scenario.mode}-${scenario.quality}-${scenario.action ?? scenario.lod ?? 'default'}.png`, out)) });
            console.log(JSON.stringify({ ...scenario, repeat: repeat + 1, ...sample.summary, modelsReadyMs: sample.modelsReadyMs }));
            await page.close();
            await writeFile(new URL(reportName, out), JSON.stringify(report, null, 2));
        }
    }
    assert.deepEqual(report.errors, []);
} finally {
    await writeFile(new URL(reportName, out), JSON.stringify(report, null, 2));
    await browser.close();
    server.close();
}
