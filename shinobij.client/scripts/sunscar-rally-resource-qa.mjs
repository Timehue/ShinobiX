import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-resource-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
const expect = baseExpect.configure({ timeout: 60000 });
const cycles = Number(process.argv[2] ?? 7);
const report = { errors: [], samples: [], paused: [] };
try {
    const context = await browser.newContext({ viewport: { width: 960, height: 720 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(60000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
        // Counters store IDs and weak references, never a strong GL/canvas reference.
        const frames = new Set(), intervals = new Set(), timers = new Set();
        const raf = requestAnimationFrame.bind(window), caf = cancelAnimationFrame.bind(window);
        const interval = setInterval.bind(window), clearI = clearInterval.bind(window);
        const timeout = setTimeout.bind(window), clearT = clearTimeout.bind(window);
        window.requestAnimationFrame = callback => {
            const id = raf(time => { frames.delete(id); callback(time); }); frames.add(id); return id;
        };
        window.cancelAnimationFrame = id => { frames.delete(id); caf(id); };
        window.setInterval = (callback, delay, ...args) => { const id = interval(callback, delay, ...args); intervals.add(id); return id; };
        window.clearInterval = id => { intervals.delete(id); clearI(id); };
        window.setTimeout = (callback, delay, ...args) => {
            const id = timeout((...values) => { timers.delete(id); if (typeof callback === 'function') callback(...values); }, delay, ...args);
            timers.add(id); return id;
        };
        window.clearTimeout = id => { timers.delete(id); clearT(id); };
        const counts = { window: 0, document: 0 }, listeners = new WeakMap();
        const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
        const scope = target => target === window ? 'window' : target === document ? 'document' : null;
        const key = (type, options) => `${type}:${typeof options === 'boolean' ? options : !!options?.capture}`;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            const s = scope(this);
            if (s && listener && !options?.once && !options?.signal) {
                let entries = listeners.get(this); if (!entries) listeners.set(this, entries = new Map());
                let active = entries.get(key(type, options)); if (!active) entries.set(key(type, options), active = new Set());
                if (!active.has(listener)) { active.add(listener); counts[s]++; }
            }
            return add.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function(type, listener, options) {
            if (scope(this) && listeners.get(this)?.get(key(type, options))?.delete(listener)) counts[scope(this)]--;
            return remove.call(this, type, listener, options);
        };
        const contexts = [], known = new WeakSet(), active = new Set();
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const result = getContext.call(this, type, ...args);
            if (/^webgl2?$/.test(String(type)) && result && !known.has(result)) {
                known.add(result); const id = contexts.length; contexts.push(new WeakRef(result)); active.add(id);
                this.addEventListener('webglcontextlost', () => active.delete(id), { once: true });
            }
            return result;
        };
        window.rallyResources = () => ({ frames: frames.size, intervals: intervals.size, timers: timers.size, ...counts,
            activeContexts: active.size, createdContexts: contexts.length, retainedContexts: contexts.filter(ref => !!ref.deref()).length,
            retainedContextIds: contexts.flatMap((ref, i) => ref.deref() ? [i] : []),
            canvases: document.querySelectorAll('canvas').length, scrollLocked: document.body.classList.contains('ui-scroll-locked') });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const sample = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        const resources = await page.evaluate(() => window.rallyResources());
        return { ...resources, heap: (await metrics()).JSHeapUsedSize };
    };
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    const cycle = async i => {
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
        await page.getByRole('button', { name: 'Ready to race' }).click();
        await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 80);
        await page.keyboard.press('KeyE');
        await page.getByRole('button', { name: 'Pause race' }).click();
        await page.waitForTimeout(700);
        const frozen = await page.evaluate(() => ({ frame: window.sunscarRallyQa.frameCount, tick: window.sunscarRallyQa.state.tick }));
        await page.waitForTimeout(500);
        assert.deepEqual(await page.evaluate(() => ({ frame: window.sunscarRallyQa.frameCount, tick: window.sunscarRallyQa.state.tick })), frozen, 'paused race stops both simulation and rendering');
        report.paused.push(frozen);
        await page.getByRole('button', { name: 'Save & return' }).click();
        await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled();
        await page.waitForFunction(() => window.rallyResources().activeContexts === 0);
        await page.waitForTimeout(1100);
        const result = await sample(); report.samples.push(result);
        console.log(JSON.stringify({ cycle: i, ...result }));
        assert.equal(result.activeContexts, 0); assert.equal(result.canvases, 0); assert.equal(result.scrollLocked, false);
        assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false, 'race instrumentation is removed on exit');
    };
    for (let i = 0; i < cycles; i++) await cycle(i);
    const baseline = report.samples[1], last = report.samples.at(-1);
    for (const entry of report.samples.slice(2)) for (const key of ['frames', 'intervals', 'timers', 'window', 'document'])
        assert.equal(entry[key], baseline[key], `repeated races retain ${key}`);
    assert.ok(last.heap < baseline.heap + 5_000_000, `heap grew by ${last.heap - baseline.heap} bytes after warm-up`);
    assert.ok(last.retainedContexts <= baseline.retainedContexts, 'disposed contexts remain reachable after garbage collection');
    const before = await metrics(); await page.waitForTimeout(1000); const after = await metrics();
    report.idleTaskSeconds = after.TaskDuration - before.TaskDuration;
    assert.ok(report.idleTaskSeconds < .1, 'race desk should not keep doing race work');
    await page.getByRole('button', { name: '← Festival' }).click();
    await page.waitForTimeout(900);
    report.afterFestival = await sample();
    assert.equal(report.afterFestival.activeContexts, 0);
    console.log(JSON.stringify({ afterFestival: report.afterFestival }));
    assert.deepEqual(report.errors, []);
} finally {
    await writeFile(new URL(cycles === 7 ? 'report.json' : `report-${cycles}.json`, out), JSON.stringify(report, null, 2));
    await browser.close();
}
