import { chromium } from '../shinobij.client/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import assert from 'node:assert/strict';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:5178';
const force3d = process.argv.includes('--3d');
const forceCanvas = process.argv.includes('--canvas');
const mode = force3d ? '3d' : forceCanvas ? 'canvas' : 'auto';
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const quality = option('quality', 'high');
const cycleCount = Number(option('cycles', '6'));
assert.ok(Number.isInteger(cycleCount) && cycleCount >= 4 && cycleCount <= 30, 'Use 4–30 lifecycle cycles');
assert.ok(['low', 'medium', 'high'].includes(quality));
const artifact = option('out', `output/warfront-${mode}-retention-audit.json`);
await mkdir(dirname(artifact), { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
    await page.addInitScript(({ forceCanvas }) => {
        // The isolated audit context must actually exercise sound; the game
        // defaults to master-muted even after its local sound gate is armed.
        localStorage.setItem('audioMuted', '0');
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
        const counters = { activeWorkers: 0, createdWorkers: 0, longTasks: [], contexts: [], draws: 0, activeAudioSources: 0, createdAudioSources: 0, connectedAudioNodes: 0 };
        const media = [], seenMedia = new WeakSet();
        const playMedia = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (...args) {
            if (!seenMedia.has(this)) { seenMedia.add(this); media.push(new WeakRef(this)); }
            return playMedia.apply(this, args);
        };
        counters.playingMedia = () => media.filter(reference => {
            const element = reference.deref();
            return element && !element.paused && !element.ended;
        }).length;
        const connectedAudio = new WeakSet();
        const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
        AudioNode.prototype.connect = function (...args) {
            const result = connect.apply(this, args);
            if (!connectedAudio.has(this)) { connectedAudio.add(this); counters.connectedAudioNodes++; }
            return result;
        };
        AudioNode.prototype.disconnect = function (...args) {
            const result = disconnect.apply(this, args);
            if (args.length === 0 && connectedAudio.delete(this)) counters.connectedAudioNodes--;
            return result;
        };
        for (const prototype of [AudioBufferSourceNode.prototype, OscillatorNode.prototype]) {
            const start = prototype.start;
            prototype.start = function (...args) {
                const result = start.apply(this, args);
                counters.activeAudioSources++;
                counters.createdAudioSources++;
                this.addEventListener('ended', () => counters.activeAudioSources--, { once: true });
                return result;
            };
        }
        const frames = new Set(), timers = new Set(), intervals = new Set();
        const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
        const timeout = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
        const interval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
        window.requestAnimationFrame = callback => {
            const id = raf(time => { frames.delete(id); callback(time); }); frames.add(id); return id;
        };
        window.cancelAnimationFrame = id => { frames.delete(id); cancel(id); };
        window.setTimeout = (callback, delay, ...args) => {
            if (typeof callback !== 'function') return timeout(callback, delay, ...args);
            const id = timeout(() => { timers.delete(id); callback(...args); }, delay); timers.add(id); return id;
        };
        window.clearTimeout = id => { timers.delete(id); clear(id); };
        window.setInterval = (...args) => { const id = interval(...args); intervals.add(id); return id; };
        window.clearInterval = id => { intervals.delete(id); clearInterval(id); };
        counters.scheduled = () => ({ frames: frames.size, timers: timers.size, intervals: intervals.size });
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
                const handles = { buffer: 0, texture: 0, program: 0, shader: 0, framebuffer: 0, renderbuffer: 0, vertexArray: 0 };
                counters.contexts.push({ reference: new WeakRef(context), handles });
                for (const name of Object.keys(handles)) {
                    const suffix = name[0].toUpperCase() + name.slice(1);
                    if (!context[`create${suffix}`]) continue;
                    const live = new WeakSet();
                    const create = context[`create${suffix}`].bind(context), remove = context[`delete${suffix}`].bind(context);
                    context[`create${suffix}`] = (...args) => { const handle = create(...args); if (handle) { live.add(handle); handles[name]++; } return handle; };
                    context[`delete${suffix}`] = handle => { if (handle && live.delete(handle)) handles[name]--; return remove(handle); };
                }
                for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
                    if (!context[name]) continue;
                    const draw = context[name].bind(context);
                    context[name] = (...args) => { counters.draws++; return draw(...args); };
                }
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
            taskSeconds: values.TaskDuration,
            ...(await page.evaluate(() => ({
                workers: window.__warfrontAudit.activeWorkers,
                createdWorkers: window.__warfrontAudit.createdWorkers,
                canvases: document.querySelectorAll('canvas').length,
                ...window.__warfrontAudit.scheduled(),
                draws: window.__warfrontAudit.draws,
                activeAudioSources: window.__warfrontAudit.activeAudioSources,
                createdAudioSources: window.__warfrontAudit.createdAudioSources,
                connectedAudioNodes: window.__warfrontAudit.connectedAudioNodes,
                playingMedia: window.__warfrontAudit.playingMedia(),
                liveWebGlContexts: window.__warfrontAudit.contexts.filter(({ reference }) => {
                    const context = reference.deref();
                    return context && !context.isContextLost();
                }).length,
                gpuHandles: window.__warfrontAudit.contexts.reduce((sum, { reference, handles }) => {
                    const context = reference.deref();
                    return sum + (context && !context.isContextLost() ? Object.values(handles).reduce((a, b) => a + b, 0) : 0);
                }, 0),
            }))),
        };
    };
    await page.goto(`${baseURL}/petvfx.html?rite=1&autostart=1&seed=23&ritespeed=3&petQuality=${quality}&riteqa=1&avian=1&ritemotionqa=1${force3d ? '&riteforce3d=1' : ''}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const cycles = [];
    const failures = [];
    for (let cycle = 0; cycle < cycleCount; cycle++) {
        const started = await page.evaluate(() => performance.now());
        if (cycle) {
            await page.getByRole('button', { name: 'Reopen Warfront' }).click();
        }
        await page.waitForFunction(() => document.querySelector('[data-testid="wfr-stage-curtain"]')?.getAttribute('data-stage-ready') === 'true', null, { timeout: 120_000 });
        const lockToReadyMs = Math.round(await page.evaluate(() => performance.now()) - started);
        const sound = page.getByRole('button', { name: 'Enable combat sound' });
        if (await sound.isVisible()) await sound.click();
        await page.waitForTimeout(3500);
        const active = await sample();
        const paint = await page.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => ({ ...canvas.dataset })));
        if (cycle === 0) await page.screenshot({ path: artifact.replace(/\.json$/, '-active.png') });
        // Alternate a complete match with early exit through the real skip flow.
        if (cycle % 2) await page.getByRole('button', { name: 'Skip to result', exact: false }).click();
        await page.getByRole('heading', { name: /The Rite is (yours|lost)/ }).waitFor({ timeout: 120_000 });
        await page.getByRole('button', { name: 'Leave the Warfront', exact: true }).click();
        await page.getByRole('button', { name: 'Reopen Warfront' }).waitFor();
        // R3F disposes an unmounted renderer asynchronously.
        await page.waitForTimeout(1600);
        const closed = await sample();
        await page.waitForTimeout(2000);
        const idle = await sample();
        const idleTaskMs = Number(((idle.taskSeconds - closed.taskSeconds) * 1000).toFixed(2));
        cycles.push({ cycle, lockToReadyMs, active, closed, idle, idleTaskMs, paint });
        if (closed.workers || closed.canvases || closed.liveWebGlContexts || closed.gpuHandles || closed.frames || closed.intervals)
            failures.push(`Cycle ${cycle}: resources survived close`);
        if (idle.draws !== closed.draws) failures.push(`Cycle ${cycle}: rendering continued after exit`);
        if (idle.activeAudioSources || idle.playingMedia) failures.push(`Cycle ${cycle}: audio continued after exit`);
        if (idleTaskMs > 100) failures.push(`Cycle ${cycle}: idle CPU used ${idleTaskMs} ms over 2 seconds`);
        console.log(JSON.stringify({ cycle, activeHeapMB: active.heapMB, closed, idleTaskMs }));
    }
    const longTasks = await page.evaluate(() => window.__warfrontAudit.longTasks);
    const warmed = cycles.slice(2).map(cycle => cycle.idle);
    const first = warmed[0], last = warmed.at(-1);
    if (last.heapMB > first.heapMB + Math.max(4, first.heapMB * .08)) failures.push('Retained heap grows after warm-up');
    if (last.listeners > first.listeners + 8) failures.push('Event listeners accumulate after warm-up');
    if (last.nodes > first.nodes + 20) failures.push('DOM nodes accumulate after warm-up');
    if (last.connectedAudioNodes > first.connectedAudioNodes) failures.push('Audio graph nodes accumulate after warm-up');
    if (!last.createdAudioSources) failures.push('The audit did not exercise audio playback');
    await writeFile(artifact, JSON.stringify({ baseURL, mode, quality, cycles, longTasks, errors, failures }, null, 2));
    console.log(JSON.stringify({ artifact, errorCount: errors.length, failures }));
    if (errors.length) throw new Error(errors.join('\n'));
    assert.deepEqual(failures, []);
} finally { await browser.close(); }
