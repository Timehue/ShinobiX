import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Presentation fixture only: no official progress or simulation rules change.
const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-finish-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const expect = baseExpect.configure({ timeout: 60000 });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], checks: [] };
let page;
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
    page = await context.newPage(); page.setDefaultTimeout(60000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 16 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        localStorage.setItem('petRally.render.v1', '3d');
        localStorage.setItem('liteFx.v1', '1');
        window.__rallyFinishTrace = { first: null, settled: null, reported: 0 };
        let metrics;
        Object.defineProperty(window, 'sunscarRallyQa', {
            configurable: true,
            get: () => metrics,
            set: value => {
                metrics = value;
                if (value?.state.finished && !window.__rallyFinishTrace.first) {
                    const { state, ...summary } = value;
                    window.__rallyFinishTrace.first = { ...summary, time: performance.now(), tick: state.tick };
                }
            },
        });
        const scroll = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function(...args) {
            if (this.matches('.rally-results')) {
                const { state, ...summary } = metrics;
                window.__rallyFinishTrace.reported++;
                window.__rallyFinishTrace.settled = { ...summary, time: performance.now(), tick: state.tick };
            }
            return scroll.apply(this, args);
        };
    });
    await page.route('**/api/festival/rally', async route => {
        const response = await route.fetch(), data = await response.json();
        if (route.request().postDataJSON()?.action === 'practice') {
            const race = data.practice;
            race.tick = 3600;
            // Market Loop is 1020m. Player crosses in a jump while the others
            // remain on course, exercising the waiting pose before the podium.
            race.racers.forEach((racer, i) => Object.assign(racer, {
                rivalId: null, speed: 15, distance: 1020 - [2, 35, 42, 48][i],
                lane: [0, -1, 1, 0][i], targetLane: [0, -1, 1, 0][i], motion: 'run',
            }));
            Object.assign(race.racers[0], { jump: .8, verticalSpeed: 3, jumpCooldown: 58, motion: 'jump' });
        }
        await route.fulfill({ response, json: data });
    });
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('3d');
    await expect(page.getByRole('button', { name: 'Resume from checkpoint' })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyQa?.quality)).toBe('light');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.getByRole('button', { name: 'Resume from checkpoint' }).click();
    await page.waitForFunction(() => {
        const race = window.sunscarRallyQa?.state;
        return race && race.racers[0].finishTick !== null && !race.finished;
    });
    report.waiting = await page.evaluate(() => window.sunscarRallyQa.state.racers[0]);
    assert.ok(report.waiting.jump > 0, 'fixture crosses with residual physics jump to exercise grounded presentation');
    await page.screenshot({ path: fileURLToPath(new URL('waiting-after-jump.png', out)) });
    await page.waitForFunction(() => !!window.__rallyFinishTrace.settled);
    report.presentation = await page.evaluate(() => window.__rallyFinishTrace);
    const { first, settled } = report.presentation;
    assert.equal(first.quality, 'light'); assert.equal(settled.quality, 'light');
    assert.equal(settled.tick, first.tick, 'simulation stops after the race while presentation continues');
    assert.ok(settled.finishFrameCount >= 50, 'victory plays at least fifty actual 3D frames before presentation completes');
    assert.ok(settled.time - first.time >= 2300, 'authored victory is not truncated by the main browser clock');
    assert.equal(report.presentation.reported, 1, 'presentation completion is reported once');
    await expect(page.locator('.rally-results')).toBeVisible();
    await page.screenshot({ path: fileURLToPath(new URL('finish-settled.png', out)) });
    await page.waitForTimeout(800);
    const idle = await page.evaluate(() => window.sunscarRallyQa.frameCount);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.frameCount), idle, 'idle results stop 3D rendering');
    assert.equal(await page.evaluate(() => window.__rallyFinishTrace.reported), 1);
    assert.deepEqual(report.errors, []);
    report.checks.push('forced light 3D on SwiftShader with 4x CPU throttle', 'crossing during jump waiting screenshot', 'rendered-frame victory timing', 'simulation stops independently', 'once-only presentation callback', 'idle results sleep');
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await context.close();
} catch (error) {
    if (page) {
        await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) });
        console.error(await page.evaluate(() => JSON.stringify({ metrics: window.sunscarRallyQa, trace: window.__rallyFinishTrace })));
    }
    throw error;
} finally { await browser.close(); }
