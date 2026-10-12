// Actual cave, walker, NPC avatars, terrain and audio; disposable local data.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { instrument } from './stronghold-resource-qa.mjs';

export async function auditHollowGateResources({ browser, engineName, url, output }) {
    const baseline = process.argv.includes('--baseline');
    const checks = [], samples = [], errors = [];
    const scenarios = baseline ? [{ floor: 2, width: 390, height: 844 }] : [2, 5, 3].flatMap(floor => [
        { floor, event: floor === 3, width: 390, height: 844 },
        { floor, event: floor === 3, width: 1366, height: 900 },
    ]);
    for (const scenario of scenarios) {
        const { floor, width, height, event } = scenario;
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'no-preference' });
        page.on('pageerror', error => errors.push(String(error)));
        await instrument(page);
        // Synthetic visibility exercises cleanup deterministically in headless
        // engines. This makes no claim about a hardware background scheduler.
        await page.addInitScript(() => {
            localStorage.setItem('audioMuted', '0');
            let hidden = false;
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
            window.setAuditVisibility = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
        });
        await page.goto(`${url}?resources&strict&explored&npc=medic&floor=${floor}${event ? '&event' : ''}`);
        await page.bringToFront();
        const cdp = engineName === 'chromium' ? await page.context().newCDPSession(page) : null;
        let layers = [];
        if (cdp) {
            await cdp.send('Performance.enable'); await cdp.send('LayerTree.enable');
            cdp.on('LayerTree.layerTreeDidChange', data => { layers = data.layers ?? []; });
        }
        const persist = () => writeFile(`${output}/${engineName}-cave-resources.json`, JSON.stringify({ checks, samples, errors }, null, 2));
        const snapshot = async label => {
            await page.mouse.move(1, 1);
            const value = { ...scenario, engine: engineName, label, ...await page.evaluate(() => window.resourceSnapshot()) };
            if (cdp) {
                await cdp.send('HeapProfiler.collectGarbage');
                const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
                Object.assign(value, await cdp.send('Memory.getDOMCounters'), { heapBytes: metrics.JSHeapUsedSize, taskSeconds: metrics.TaskDuration, layers: layers.length });
            }
            samples.push(value); await persist(); return value;
        };
        const enter = async () => {
            await page.getByTestId('cave-resource-enter').click();
            await page.locator('.underground-terrain').waitFor();
            await page.waitForFunction(() => Boolean(window.caveResourceControl));
        };
        const unmount = async () => {
            await page.getByTestId('cave-resource-unmount').evaluate(button => button.click());
            await page.locator('.hollow-gate-shrine').waitFor({ state: 'detached' });
        };
        const walk = () => page.evaluate(() => window.caveResourceControl.walk());
        for (let cycle = 0; cycle < 3; cycle++) { await enter(); await walk(); await unmount(); await page.waitForTimeout(950); }
        const warm = await snapshot('warm unmounted');
        await enter(); await page.waitForTimeout(1000);
        const mounted = await snapshot('mounted idle');
        await page.screenshot({ path: `${output}/${engineName}-cave-resources-${floor}-${width}.png` });
        await page.waitForTimeout(1000);
        const idle = await snapshot('mounted idle after 1s');
        assert.equal(idle.frames, 0, 'idle cave schedules no avatar frame loop');
        assert.equal(idle.frameCallbacks, mounted.frameCallbacks, 'idle NPCs keep animating');
        assert.equal(idle.webglCreated, 0, 'the SVG cave must allocate no WebGL context');
        assert.equal(idle.audioContexts, warm.audioContexts, 'entry creates another audio context');
        assert.equal(idle.audioSources, idle.audioAvailable ? 1 : 0, 'supported audio has one ambience source; unsupported audio allocates none');
        const motionProbe = await page.evaluate(async () => {
            const route = window.caveResourceControl.walk();
            let moving;
            // Inspect and hide in the browser's own event loop. Host automation
            // round-trips must not race the short glide/175ms walk cadence.
            for (let attempt = 0; attempt < 12; attempt++) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                moving = window.resourceSnapshot();
                if (moving.frames > 0 && document.querySelector('.hg-avatar.is-walking')) break;
            }
            window.setAuditVisibility(true);
            return { route, moving, movesAtHide: document.body.dataset.moveCount, tile: document.body.dataset.tile };
        });
        const moving = { ...scenario, engine: engineName, label: 'moving before synthetic hide', ...motionProbe.moving };
        samples.push(moving); await persist();
        assert(moving.frames > 0, 'exercise animated glides, not reduced-motion snaps');
        const movesAtHide = motionProbe.movesAtHide;
        await page.waitForTimeout(1100);
        const hidden = await snapshot('synthetic hidden after 1.1s');
        const hiddenTile = await page.locator('body').getAttribute('data-tile');
        await page.waitForTimeout(500);
        const hiddenLater = await snapshot('synthetic hidden after another 0.5s');
        if (!baseline) {
            // A submitted move can still commit. Count issued moves atomically
            // with visibility dispatch so host round-trips cannot race cadence.
            assert.equal(await page.locator('body').getAttribute('data-move-count'), movesAtHide, 'background walking issues further steps');
            assert.equal(await page.locator('body').getAttribute('data-tile'), hiddenTile, 'hidden walk still spends steps');
            assert.equal(hidden.frames, 0); assert.deepEqual(hidden.timeouts, []);
            assert.equal(hiddenLater.frameCallbacks, hidden.frameCallbacks, 'hidden NPCs keep rendering');
            assert.equal(hidden.audioSources, 0, 'hidden audio keeps playing');
            assert.equal(hidden.audioConnectedSources, 0, 'hidden audio source retains its graph connection');
            assert.equal(await page.locator('.hg-dest').count(), 0, 'hidden walk target remains queued');
        }
        await page.evaluate(() => window.setAuditVisibility(false)); await page.waitForTimeout(250);
        if (!baseline) assert.equal(await page.locator('body').getAttribute('data-tile'), hiddenTile, 'old walk resumes after return');
        if (!baseline) {
            await walk(); await page.waitForTimeout(45);
            await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(50);
            assert.equal((await snapshot('live reduced-motion preference')).frames, 0, 'motion preference leaves a glide running');
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(50);
            const cached = await snapshot('synthetic pagehide');
            assert.equal(cached.frames, 0); assert.deepEqual(cached.timeouts, []);
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
        await unmount(); await page.waitForTimeout(950);
        if (!baseline) for (let cycle = 0; cycle < 18; cycle++) {
            await enter();
            // Native disclosure lifecycle, batched to keep host automation
            // round-trips outside this repeated resource scenario. Actual
            // touch target/actionability is covered by the mobile UI matrix.
            await page.evaluate(() => {
                for (const selector of ['.hg-floor-notes', '.hg-sidepanel']) {
                    const details = document.querySelector(selector), summary = details.querySelector('summary');
                    summary.click(); if (!details.open) throw new Error('Disclosure did not open');
                    summary.click(); if (details.open) throw new Error('Disclosure did not close');
                }
            });
            await walk();
            if (cycle % 3 === 0) {
                const nextFloor = floor === 5 ? 4 : 5;
                await page.evaluate(next => window.caveResourceControl.floor(next), nextFloor);
                // Wait for the actual React floor commit, rather than racing
                // a fixed delay against layout/paint on a busy host.
                await page.waitForFunction(next => Number(document.querySelector('.hollow-gate-shrine')?.getAttribute('data-hg-floor')) === next
                    && !document.querySelector('.hg-dest'), nextFloor);
                assert.equal(await page.locator('.hg-dest').count(), 0, 'old-floor walk target survives floor change');
            }
            if (cycle % 2) { await page.getByRole('button', { name: 'Emergency Forfeit', exact: true }).click(); await page.locator('.hollow-gate-shrine').waitFor({ state: 'detached' }); }
            await unmount(); await page.waitForTimeout(950);
            if (cycle % 6 === 5) await snapshot(`unmounted after ${cycle + 1} cycles`);
        }
        const after = await snapshot('final unmounted');
        if (!baseline) {
            assert.equal(after.frames, warm.frames); assert.equal(after.intervals, warm.intervals);
            assert.equal(after.observers, warm.observers); assert.equal(after.mutationObservers, warm.mutationObservers);
            assert.deepEqual(after.timeoutDetails, warm.timeoutDetails);
            assert.equal(after.audioContexts, warm.audioContexts); assert.equal(after.audioSources, 0);
            assert.equal(after.audioConnectedSources, 0);
            assert.equal(after.animations, 0); assert.equal(after.webglCreated, 0);
            if (cdp) {
                assert(after.nodes <= warm.nodes + 10, 'detached cave DOM accumulates');
                assert(after.jsEventListeners <= warm.jsEventListeners, 'cave listeners accumulate');
                assert(after.heapBytes - warm.heapBytes < 1_500_000, 'cave retained heap keeps growing');
                assert(after.layers <= warm.layers + 1, 'cave compositor layers accumulate');
            }
        }
        checks.push({ ...scenario, engine: engineName, cycles: baseline ? 0 : 18, strictMode: true,
            syntheticVisibility: true, idleFrames: idle.frames, hiddenFrames: hidden.frames, hiddenTimeouts: hidden.timeouts,
            audioSupported: idle.audioAvailable,
            afterExitFrames: after.frames, afterExitAudioSources: after.audioSources,
            heapGrowthBytes: cdp ? after.heapBytes - warm.heapBytes : null,
            listenerGrowth: cdp ? after.jsEventListeners - warm.jsEventListeners : null,
            nodeGrowth: cdp ? after.nodes - warm.nodes : null,
            idleTaskMs: cdp ? (idle.taskSeconds - mounted.taskSeconds) * 1000 : null });
        await persist(); await page.close();
    }
    assert.deepEqual(errors, []); return checks;
}
