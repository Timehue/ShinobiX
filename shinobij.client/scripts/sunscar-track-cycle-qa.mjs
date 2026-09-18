import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:5199', out = new URL('../../.tmp/sunscar-track-cycle-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], checks = [], samples = [];
let page;
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    page = await context.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
        const active = new Set(), intervals = new Set();
        const request = window.requestAnimationFrame.bind(window);
        const cancel = window.cancelAnimationFrame.bind(window);
        const interval = window.setInterval.bind(window);
        const clear = window.clearInterval.bind(window);
        window.requestAnimationFrame = callback => {
            const id = request(time => { active.delete(id); callback(time); });
            active.add(id);
            return id;
        };
        window.cancelAnimationFrame = id => { active.delete(id); cancel(id); };
        window.sunscarActiveRafQa = () => active.size;
        window.setInterval = (callback, delay, ...args) => {
            const id = interval(callback, delay, ...args); intervals.add(id); return id;
        };
        window.clearInterval = id => { intervals.delete(id); clear(id); };
        window.sunscarActiveIntervalsQa = () => intervals.size;
    });
    await page.request.post(base + '/__qa/reset');
    const auth = await page.request.get(base + '/__qa/session').then(r => r.json());
    const headers = { 'x-player-name': auth.name, 'x-player-token': auth.token };
    await page.goto(base + '/sunscar-modes-qa.html');
    // Baseline once the festival hub is up: it keeps a 60 s day-rollover clock
    // for as long as the festival is open, races included.
    await page.getByRole('button', { name: 'Visit the race grounds' }).waitFor();
    await page.waitForTimeout(300);
    const idleRaf = await page.evaluate(() => window.sunscarActiveRafQa());
    const idleIntervals = await page.evaluate(() => window.sunscarActiveIntervalsQa());
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    const courses = ['Sunscar Grand Circuit', "Scorpion's Spine", 'Burning Dunes', 'Caravan Clash', 'Sunscar Grand Circuit', 'Sunscar Grand Circuit'];
    for (let i = 0; i < courses.length; i++) {
        await page.setViewportSize({ width: i === 4 ? 320 : 390, height: 844 });
        await page.locator('.rally-pet-list button').nth([0, 2, 4, 5, 6, 0][i]).click();
        await page.locator('.rally-course-card').filter({ has: page.getByText(courses[i], { exact: true }) }).click();
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await page.getByText('All companions ready').waitFor();
        assert.equal(await page.evaluate(() => window.sunscarActiveIntervalsQa()), idleIntervals, 'Practice has no checkpoint timer');
        await page.waitForTimeout(300);
        const readyFrames = await page.evaluate(() => window.sunscarRallyQa.frameCount);
        await page.waitForTimeout(600);
        assert.ok((await page.evaluate(() => window.sunscarRallyQa.frameCount)) - readyFrames <= 2, 'Ready screen must not keep rendering');
        await page.getByRole('button', { name: 'Ready to race' }).click();
        await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 180);
        await page.keyboard.press('Space'); await page.keyboard.down('Shift');
        await page.waitForTimeout(800); await page.keyboard.up('Shift');
        await page.keyboard.press('KeyE'); await page.waitForTimeout(400);
        const sample = await page.evaluate(() => {
            const q = window.sunscarRallyQa;
            return { track: q.state.trackId, pet: q.state.racers[0].pet.templateId, fps: q.fps, calls: q.calls, triangles: q.triangles, geometry: q.geometry, textures: q.textures, heap: performance.memory?.usedJSHeapSize };
        });
        samples.push(sample);
        await page.screenshot({ path: fileURLToPath(new URL('course-' + i + '.png', out)) });
        for (const button of await page.locator('.rally-controls button').all()) {
            const bounds = await button.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (i === 4 ? 320 : 390) && bounds.height >= 44);
        }
        if (i === 2) {
            // Note the frame the race finished on. A 16 ms timeout chain, so the
            // interval accounting above is untouched.
            await page.evaluate(() => {
                const watch = () => {
                    const q = window.sunscarRallyQa;
                    if (q?.state.finished) window.sunscarFinishFrameQa = q.frameCount;
                    else setTimeout(watch, 16);
                };
                watch();
            });
            const stageTop = () => page.evaluate(() => document.querySelector('.rally-stage').getBoundingClientRect().top);
            const racingTop = await stageTop();
            const deadline = Date.now() + 240_000;
            while (!await page.locator('.rally-results').count()) {
                if (Date.now() > deadline) throw new Error('Burning Dunes practice did not finish');
                const stamina = await page.evaluate(() => window.sunscarRallyQa.state.racers[0].stamina);
                if (stamina > 85) await page.keyboard.down('Shift');
                if (stamina < 15) await page.keyboard.up('Shift');
                await page.waitForTimeout(800);
            }
            await page.keyboard.up('Shift');
            // Results exist now, but the page waits for the podium before
            // scrolling to them (the settle takes at least 2.5 s).
            assert.ok(Math.abs(await stageTop() - racingTop) < 2, 'The stage stays on screen while the finish plays');
            // The finish presentation (pets gliding to the podium, the camera
            // pulling back, the victory clip) renders for 2.5 s of clip time,
            // at most 0.05 s a frame: at least 50 frames. It must then stop
            // on its own; the idle results screen draws nothing.
            const finishFrame = await page.evaluate(() => window.sunscarFinishFrameQa);
            const frameCount = () => page.evaluate(() => window.sunscarRallyQa.frameCount);
            const settleDeadline = Date.now() + 30_000;
            let settledFrame = await frameCount(), quietSince = Date.now();
            while (Date.now() - quietSince < 1000) {
                if (Date.now() > settleDeadline) throw new Error('The finish presentation never stopped rendering');
                await page.waitForTimeout(100);
                const frame = await frameCount();
                if (frame !== settledFrame) { settledFrame = frame; quietSince = Date.now(); }
            }
            assert.ok(settledFrame - finishFrame >= 45, `Finish presentation must play (${settledFrame - finishFrame} frames after the finish)`);
            const settledTop = await stageTop();
            assert.ok(settledTop < racingTop - 50, 'Results scroll into view once the finish has played');
            await page.waitForTimeout(300);
            const finishFrames = await frameCount();
            await page.waitForTimeout(600);
            assert.ok((await frameCount()) - finishFrames <= 2, 'Finished race must not keep rendering');
            await page.locator('.rally-stage').screenshot({ path: fileURLToPath(new URL('finish-' + i + '.png', out)) });
            checks.push(`Burning Dunes finish presentation rendered ${settledFrame - finishFrame} frames, then stopped and scrolled ${Math.round(racingTop - settledTop)} px to the results`);
            await page.getByRole('button', { name: 'Return to the race desk' }).click();
            checks.push('Burning Dunes full practice finish');
        } else {
            await page.getByRole('button', { name: 'Pause race' }).click();
            await page.waitForTimeout(300);
            const pausedFrames = await page.evaluate(() => window.sunscarRallyQa.frameCount);
            await page.waitForTimeout(600);
            assert.ok((await page.evaluate(() => window.sunscarRallyQa.frameCount)) - pausedFrames <= 2, 'Paused race must not keep rendering');
            await page.getByRole('button', { name: 'Save & return' }).click();
        }
        await page.waitForFunction(() => !window.sunscarRallyQa && !document.querySelector('.rally-stage canvas'));
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => window.sunscarActiveRafQa()), idleRaf, 'Race exit must release the animation-frame loop');
        assert.equal(await page.evaluate(() => window.sunscarActiveIntervalsQa()), idleIntervals, 'Race exit must release intervals');
        checks.push('Canvas and QA listener cleared after course ' + i);
    }
    const saved = await page.request.get(base + '/api/festival/rally?playerName=' + auth.name, { headers }).then(r => r.json());
    assert.equal(saved.progress.lastEntryDay, null); assert.equal(saved.progress.championships, 0);
    assert.equal(samples[0].textures, samples[5].textures);
    // Geometry uploads follow camera visibility; a later snapshot can contain
    // fewer live buffers. The retention check is that revisiting adds none.
    assert.ok(samples[5].geometry <= samples[0].geometry, 'Revisiting retains no additional geometry');
    checks.push('Repeated course adds no live geometry or textures; practice consumes no entry');
    assert.deepEqual(errors, []);
} catch (error) { if (page) await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) }); throw error; }
finally { await writeFile(new URL('report.json', out), JSON.stringify({ errors, checks, samples }, null, 2)); await browser.close(); }
console.log(JSON.stringify({ errors, checks, samples }));
