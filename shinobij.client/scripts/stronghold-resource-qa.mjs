// Run through stronghold-browser-qa.mjs --resources [--baseline].
// Uses the actual React host/Arena. Network and characters are local fixtures.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

async function instrument(page) {
    await page.addInitScript(() => {
        const timeouts = new Map(), intervals = new Set(), frames = new Set();
        const timeout = window.setTimeout.bind(window), clearTimeout = window.clearTimeout.bind(window);
        const interval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
        const frame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
        window.setTimeout = (fn, ms, ...args) => {
            const id = timeout(() => { timeouts.delete(id); typeof fn === 'function' ? fn(...args) : (0, eval)(fn); }, ms);
            timeouts.set(id, { id, delayMs: ms, stack: new Error('timer scheduled').stack }); return id;
        };
        window.clearTimeout = id => { timeouts.delete(id); intervals.delete(id); clearTimeout(id); };
        window.setInterval = (fn, ms, ...args) => { const id = interval(fn, ms, ...args); intervals.add(id); return id; };
        window.clearInterval = id => { intervals.delete(id); timeouts.delete(id); clearInterval(id); };
        window.requestAnimationFrame = fn => { const id = frame(now => { frames.delete(id); fn(now); }); frames.add(id); return id; };
        window.cancelAnimationFrame = id => { frames.delete(id); cancelFrame(id); };
        let observers = 0, webglCreated = 0, webglActive = 0, canvasDraws = 0;
        const NativeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeObserver {
            targets = new Set();
            observe(target, options) { if (!this.targets.size) observers++; this.targets.add(target); super.observe(target, options); }
            unobserve(target) { if (this.targets.delete(target) && !this.targets.size) observers--; super.unobserve(target); }
            disconnect() { if (this.targets.size) observers--; this.targets.clear(); super.disconnect(); }
        };
        const getContext = HTMLCanvasElement.prototype.getContext;
        const contexts = new WeakSet(), webglRenderers = new Set();
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            const result = getContext.call(this, type, ...args);
            if (result && /^(webgl|experimental-webgl)/.test(type) && !contexts.has(result)) {
                contexts.add(result); webglCreated++; webglActive++;
                const debug = result.getExtension('WEBGL_debug_renderer_info');
                webglRenderers.add(result.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : result.RENDERER));
                this.addEventListener('webglcontextlost', () => webglActive--, { once: true });
            }
            return result;
        };
        const clearRect = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) { canvasDraws++; return clearRect.apply(this, args); };
        window.resourceSnapshot = () => ({ timeouts: [...timeouts.values()].map(timer => timer.delayMs), timeoutDetails: [...timeouts.values()], intervals: intervals.size, frames: frames.size, observers, webglCreated, webglActive, webglRenderers: [...webglRenderers], canvasDraws,
            animations: document.getAnimations().filter(a => a.playState === 'running').length });
    });
}

export async function auditStrongholdResources({ browser, fixture, prepare, ready, output }) {
    const checks = [], samples = [];
    const baselineMode = process.argv.includes('--baseline');
    for (const sector of [12, 99]) {
        const state = fixture({ sector, crowd: 18, visited: Array.from({ length: 851 }, (_, i) => i) });
        const page = await prepare(browser, { width: 390, height: 844 }, state, `?host=1&sector=${sector}&lifecycle=1&resourceAudit=1`, instrument);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable'); await cdp.send('LayerTree.enable');
        let layers = [];
        cdp.on('LayerTree.layerTreeDidChange', data => { layers = data.layers ?? []; });
        const snapshot = async label => {
            const unmounted = await page.getByRole('heading', { name: 'Returned to sector', exact: true }).isVisible();
            // Chromium's native MouseEventManager can retain the last hovered
            // map button and its detached tree after an artificial unmount.
            // Heap evidence confirmed that moving onto the returned screen
            // releases it. Compare both baselines with the same input state.
            if (unmounted) await page.mouse.move(1, 1);
            await cdp.send('HeapProfiler.collectGarbage');
            const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
            const value = { sector, label, pointerSettledOnReturnedScreen: unmounted, ...await page.evaluate(() => window.resourceSnapshot()), ...await cdp.send('Memory.getDOMCounters'),
                heapBytes: metrics.JSHeapUsedSize, taskSeconds: metrics.TaskDuration, layers: layers.length };
            samples.push(value);
            // Keep ownership evidence even if the next assertion fails.
            await writeFile(`${output}/resource-samples.json`, JSON.stringify({ samples, checks }, null, 2));
            return value;
        };
        // This is an artificial React lifecycle control, not a game action.
        // Keep its toolbar hidden so it cannot cover Players/the movement pad.
        // Real game controls below still require ordinary actionable clicks.
        const unmount = async () => { await page.getByTestId('stronghold-qa-unmount').evaluate(button => button.click()); await page.getByRole('heading', { name: 'Returned to sector' }).waitFor(); };
        // Warm React, CSS and image caches before comparing retained resources.
        for (let cycle = 0; cycle < 3; cycle++) { await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page); await unmount(); }
        await page.waitForTimeout(350);
        const warm = await snapshot('warm unmounted');
        for (let cycle = 0; cycle < 12; cycle++) {
            await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page);
            await page.getByRole('button', { name: /^Players/ }).click(); await page.keyboard.press('Escape');
            await page.getByRole('button', { name: 'View full map', exact: true }).click();
            await page.getByRole('button', { name: 'Follow player', exact: true }).click();
            if (cycle % 2) await unmount();
            else { await page.getByRole('button', { name: 'Leave stronghold', exact: true }).click(); await page.getByRole('heading', { name: 'Returned to sector' }).waitFor(); }
        }
        await page.waitForTimeout(350);
        const after = await snapshot('after 12 entry/exit cycles');
        if (after.jsEventListeners > warm.jsEventListeners || after.nodes > warm.nodes + 10) {
            const chunks = [];
            const collect = ({ chunk }) => chunks.push(chunk);
            cdp.on('HeapProfiler.addHeapSnapshotChunk', collect);
            try { await cdp.send('HeapProfiler.takeHeapSnapshot'); }
            finally { cdp.off('HeapProfiler.addHeapSnapshotChunk', collect); }
            await writeFile(`${output}/exploration-retainers-${sector}.heapsnapshot`, chunks.join(''));
            await snapshot('diagnostic second collection after retention failure');
        }
        assert.equal(after.observers, warm.observers); assert.equal(after.intervals, warm.intervals); assert.equal(after.frames, warm.frames);
        // A later collection can release React's last detached tree. A decrease
        // is healthy; reject listener growth rather than requiring equality.
        assert.deepEqual(after.timeoutDetails, warm.timeoutDetails); assert(after.jsEventListeners <= warm.jsEventListeners, 'exploration listeners accumulate');
        assert(after.nodes <= warm.nodes + 10); assert(after.heapBytes - warm.heapBytes < 1_500_000, 'retained heap keeps growing');
        assert(after.layers <= warm.layers + 1); assert.equal(after.animations, 0); assert.equal(after.webglCreated, 0);
        const polls = state.polls; await page.waitForTimeout(2300); assert.equal(state.polls, polls, 'polling survives unmount');
        checks.push({ sector, cycles: 12, stoppedTimersAndPolling: true, stableListenersNodesHeapLayers: true });
        await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page);
        // Sample real JS CPU stacks over several idle presence responses, with all rooms discovered.
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
        const idleStart = await snapshot('fully discovered idle start');
        await page.waitForTimeout(6300);
        const { profile } = await cdp.send('Profiler.stop');
        const idleEnd = await snapshot('fully discovered idle end');
        const fogNodes = new Set(profile.nodes.filter(n => n.callFrame.functionName === 'computeHollowGateVisible').map(n => n.id));
        for (const n of profile.nodes) if (fogNodes.has(n.id)) for (const id of n.children ?? []) fogNodes.add(id);
        const fogSamples = profile.samples?.filter(id => fogNodes.has(id)).length ?? 0;
        checks.push({ sector, idleTaskMs: (idleEnd.taskSeconds - idleStart.taskSeconds) * 1000, fogSamples });
        await writeFile(`${output}/cpu-${sector}-${baselineMode ? 'before' : 'after'}.cpuprofile`, JSON.stringify(profile));
        await unmount();
        // A resolved patrol should not leave the Arena's 12-second deadline timer behind.
        Object.assign(state.visit, { threat: 100 });
        Object.assign(state.session, { status: 'done', winner: 'player', outcome: 'win', terminalEvidence: { finishedAt: Date.now(), finalMoveToken: 'qa-terminal', finalVersion: 0, finalEventSeq: 0, winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending' } });
        await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page);
        await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '0');
        await unmount();
        const settled = await snapshot('after successful patrol settlement');
        if (!baselineMode) assert.equal(settled.timeouts.filter(ms => ms === 12000).length, 0, 'settlement deadline survives completion');
        // A failing settlement must not keep making report requests after the fight unmounts.
        state.visit.threat = 100; state.failReport = true;
        const priorReports = state.reports;
        await page.getByRole('button', { name: 'Enter preview', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.hex-grid-layer'));
        await expect.poll(() => state.reports, { timeout: 15_000, message: 'failed settlement must attempt its report' }).toBeGreaterThan(priorReports);
        await unmount(); const reportsAtExit = state.reports;
        await page.waitForTimeout(2000);
        const failed = await snapshot('after failed settlement unmount');
        checks.push({ sector, successDeadlineTimers: settled.timeouts.filter(ms => ms === 12000).length, reportsAfterUnmount: state.reports - reportsAtExit, remainingTimers: failed.timeouts });
        if (!baselineMode) { assert.equal(state.reports, reportsAtExit); assert.deepEqual(failed.timeoutDetails, warm.timeoutDetails); }
        if (!baselineMode) {
            // React/Chrome can retain the most recent detached combat tree.
            // Repeat combat itself to distinguish bounded retention from growth.
            for (let cycle = 0; cycle < 8; cycle++) {
                const reports = state.reports;
                await page.getByRole('button', { name: 'Enter preview', exact: true }).click();
                await page.locator('.hex-grid-layer').waitFor();
                await expect.poll(() => state.reports, { timeout: 15_000, message: 'combat cycle must attempt settlement' }).toBeGreaterThan(reports);
                await unmount(); await page.waitForTimeout(50);
            }
            const combatCycles = await snapshot('after 8 combat entry/exit cycles');
            assert(combatCycles.nodes <= failed.nodes + 10, 'detached combat nodes accumulate');
            assert(combatCycles.jsEventListeners <= failed.jsEventListeners, 'combat listeners accumulate');
            assert(combatCycles.heapBytes - failed.heapBytes < 1_500_000, 'combat heap accumulates');
            // The fixture's app-wide capability lease survives feature unmount.
            // Require the exact original timer IDs/stacks, so a new combat timer
            // cannot pass merely by sharing the same duration as that lease.
            assert.deepEqual(combatCycles.timeoutDetails, warm.timeoutDetails, 'combat timers survive unmount');
            assert.equal(combatCycles.frames, 0); assert.equal(combatCycles.observers, 0);
            checks.push({ sector, combatCycles: 8, stableCombatResources: true });
        }
        await page.close();
    }
    if (!baselineMode) for (const backdrop of ['2d', '3d']) {
        const state = fixture({ sector: 99 });
        const page = await prepare(browser, { width: 1280, height: 900 }, state, `?host=1&sector=99&lifecycle=1&resourceAudit=1&backdrop=${backdrop}`, async page => {
            await instrument(page); await page.emulateMedia({ reducedMotion: 'no-preference' });
        });
        // Exercise the real exterior canvas, with ordinary animation enabled.
        await page.locator('.scene-ambience-canvas').waitFor();
        await page.waitForFunction(() => window.resourceSnapshot().canvasDraws > 5);
        if (backdrop === '3d') await page.waitForFunction(() => window.resourceSnapshot().webglActive >= 2);
        const outside = await page.evaluate(() => window.resourceSnapshot());
        for (let cycle = 0; cycle < 3; cycle++) {
            await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page);
            await page.waitForFunction(() => window.resourceSnapshot().webglActive === 0);
            await page.waitForTimeout(700);
            const inside = await page.evaluate(() => window.resourceSnapshot());
            await page.waitForTimeout(300);
            const quiet = await page.evaluate(() => window.resourceSnapshot());
            assert.equal(inside.frames, 0, 'hidden exterior still schedules animation frames');
            assert.equal(quiet.canvasDraws, inside.canvasDraws, 'hidden exterior still paints');
            assert.equal(await page.locator('canvas').count(), 0, 'hidden exterior retains its canvases');
            checks.push({ backdrop, cycle, outsideFrames: outside.frames, outsideWebgl: outside.webglActive, webglRenderers: outside.webglRenderers, insideFrames: inside.frames, insideWebgl: inside.webglActive });
            await page.getByTestId('stronghold-qa-unmount').evaluate(button => button.click());
            await page.locator('.scene-ambience-canvas').waitFor();
            await page.waitForFunction(draws => window.resourceSnapshot().canvasDraws > draws, inside.canvasDraws);
        }
        await page.close();
    }
    await writeFile(`${output}/resource-${baselineMode ? 'before' : 'after'}.json`, JSON.stringify({ samples, checks }, null, 2));
    return checks;
}
