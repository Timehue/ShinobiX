import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/sunscar-caravan-resource-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
const samples = [], errors = [];
let page;
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        const frames = new Set(), intervals = new Set(), timers = new Set();
        const requestFrame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
        const setIntervalOriginal = window.setInterval.bind(window), clearIntervalOriginal = window.clearInterval.bind(window);
        const setTimeoutOriginal = window.setTimeout.bind(window), clearTimeoutOriginal = window.clearTimeout.bind(window);
        window.requestAnimationFrame = callback => {
            const id = requestFrame(time => { frames.delete(id); callback(time); });
            frames.add(id); return id;
        };
        window.cancelAnimationFrame = id => { frames.delete(id); cancelFrame(id); };
        window.setInterval = (callback, delay, ...args) => {
            const id = setIntervalOriginal(callback, delay, ...args); intervals.add(id); return id;
        };
        window.clearInterval = id => { intervals.delete(id); clearIntervalOriginal(id); };
        window.setTimeout = (callback, delay, ...args) => {
            const id = setTimeoutOriginal((...values) => { timers.delete(id); if (typeof callback === 'function') callback(...values); }, delay, ...args);
            timers.add(id); return id;
        };
        window.clearTimeout = id => { timers.delete(id); clearTimeoutOriginal(id); };
        const counts = { window: 0, document: 0 };
        const listeners = new WeakMap();
        const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
        const tracked = target => target === window ? 'window' : target === document ? 'document' : null;
        const key = (type, options) => `${type}:${typeof options === 'boolean' ? options : !!options?.capture}`;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            const scope = tracked(this);
            if (scope && listener) {
                let byType = listeners.get(this);
                if (!byType) { byType = new Map(); listeners.set(this, byType); }
                const id = key(type, options);
                let active = byType.get(id);
                if (!active) { active = new Set(); byType.set(id, active); }
                if (!active.has(listener)) { active.add(listener); counts[scope]++; }
            }
            return add.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function(type, listener, options) {
            const scope = tracked(this), active = listeners.get(this)?.get(key(type, options));
            if (scope && active?.delete(listener)) counts[scope]--;
            return remove.call(this, type, listener, options);
        };
        window.sunscarResourceQa = () => ({ frames: frames.size, intervals: intervals.size, timers: timers.size, ...counts });
    });
    await page.request.post(base + '/__qa/reset');
    await page.goto(base + '/sunscar-modes-qa.html');
    await page.getByRole('button', { name: 'Read today’s contracts' }).click();
    await page.getByRole('button', { name: 'Accept contract & depart' }).click();
    await page.getByRole('heading', { name: 'Choose the next road' }).waitFor();
    await page.getByRole('button', { name: '← Festival grounds' }).click();
    await page.getByRole('button', { name: 'Rejoin your caravan' }).waitFor();
    await page.waitForTimeout(900);
    const idle = await page.evaluate(() => window.sunscarResourceQa());
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async name => (await cdp.send('Performance.getMetrics')).metrics.find(item => item.name === name)?.value;
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return metric('JSHeapUsedSize'); };
    const idleTask = async () => { const before = await metric('TaskDuration'); await page.waitForTimeout(1000); return (await metric('TaskDuration')) - before; };
    const firstHeap = await heap(), firstTask = await idleTask();
    for (let i = 0; i < 6; i++) {
        await page.getByRole('button', { name: 'Rejoin your caravan' }).click();
        await page.locator('.caravan-manifest').waitFor();
        await page.getByRole('button', { name: 'Route map', exact: true }).click();
        await page.getByRole('button', { name: 'Zoom map in' }).click();
        await page.locator('.caravan-map-node.is-available').first().click();
        await page.getByRole('button', { name: '← Festival grounds' }).click();
        await page.getByRole('button', { name: 'Rejoin your caravan' }).waitFor();
        await page.waitForTimeout(900);
        const sample = await page.evaluate(() => window.sunscarResourceQa());
        samples.push(sample);
        for (const key of ['frames', 'intervals', 'timers', 'window', 'document'])
            assert.equal(sample[key], idle[key], `Caravan cycle ${i + 1} retained ${key}`);
    }
    const lastHeap = await heap(), lastTask = await idleTask();
    assert.ok(lastHeap <= firstHeap + 5_000_000, `Caravan JS heap grew ${lastHeap - firstHeap} bytes after warm-up`);
    assert.ok(lastTask <= firstTask + .05, `Caravan idle CPU task time rose from ${firstTask} to ${lastTask}`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ idle, samples, firstHeap, lastHeap, firstTask, lastTask, errors }));
} catch (error) {
    if (page) {
        await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)), fullPage: true });
        await writeFile(new URL('failure.txt', out), await page.locator('body').innerText());
    }
    throw error;
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify({ samples, errors }, null, 2));
    await browser.close();
}
