import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-low-end-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const expect = baseExpect.configure({ timeout: 45000 });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], checks: [], metrics: [] };
let page;
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.errors.push(error.message));
    const downloads = [], checkpoints = [];
    page.on('request', request => { if (/\.glb(?:\?|$)|\/RallyCanvas-/.test(request.url())) downloads.push(request.url()); });
    page.on('request', request => {
        if (!request.url().includes('/api/festival/rally') || request.method() !== 'POST') return;
        const body = request.postDataJSON();
        if (body?.action === 'checkpoint') checkpoints.push(body);
    });
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            if (/^webgl/.test(type)) return null;
            return original.call(this, type, ...args);
        };
    });
    await page.route(/\.glb(?:\?|$)/, route => route.abort());
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Prepare Grand Prix' }).click();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    assert.equal(await page.evaluate(() => window.sunscarRallyQa?.quality), 'economy');
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('economy');
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('auto');
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 60);
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const before = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount, time: performance.now() }));
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount, time: performance.now() }));
    const elapsed = (after.time - before.time) / 1000;
    report.clock = { before, after, elapsed, simulated: (after.tick - before.tick) / 60, frames: after.frame - before.frame };
    console.log(JSON.stringify({ clock: report.clock }));
    assert.ok(Math.abs((after.tick - before.tick) / 60 - elapsed) < .45, 'race clock follows wall time with slower graphics');
    assert.ok(after.frame - before.frame < (after.tick - before.tick) * .7, 'simulation remains independent of the 30fps draw budget');
    await page.getByRole('button', { name: 'Steer right, left stick, D or Right Arrow' }).click();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyQa.state.racers[0].targetLane), { intervals: [100, 200] }).toBe(1);
    // The opening cart can stagger the player while steering completes.
    // A rejected jump during hit recovery is correct gameplay, not a render failure.
    await expect.poll(() => page.evaluate(() => {
        const racer = window.sunscarRallyQa.state.racers[0];
        return racer.stagger === 0 && racer.jumpCooldown === 0;
    }), { intervals: [100] }).toBe(true);
    await page.getByRole('button', { name: 'Jump, right trigger or Space' }).click();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyQa.state.racers[0].jump > 0), { intervals: [100] }).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL('economy-mobile-jump.png', out)) });
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].attackCharge === 100);
    await page.keyboard.press('KeyQ');
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].shotsFired === 1);
    // A pause saves the current simulated Burst flag before the queued release
    // is applied. Reopening must release it even though this key is no longer held.
    await page.keyboard.down('Shift');
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].burst);
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(700);
    const frozen = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount }));
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount })), frozen);
    const metrics = await page.evaluate(() => { const { state, ...metrics } = window.sunscarRallyQa; return metrics; }); report.metrics.push(metrics);
    assert.equal(metrics.pixelRatio, 1);
    assert.deepEqual(downloads, [], 'automatic economy skips 3D code and all pet models');
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('3d');
    await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyQa?.quality)).toBe('economy');
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('economy');
    await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save & return' }).click();
    await page.getByRole('button', { name: 'Resume Grand Prix' }).click();
    await expect(page.getByRole('button', { name: 'Resume from checkpoint' })).toBeEnabled();
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.state.racers[0].shotsFired), 1, 'official checkpoint retains actions');
    const resumeAt = await page.evaluate(() => {
        const race = window.sunscarRallyQa.state;
        return { tick: race.tick, burst: race.racers[0].burst };
    });
    assert.equal(resumeAt.burst, true, 'the stored snapshot exercises restoration of a held Burst');
    for (const [width, height] of [[320, 640], [844, 390], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        const bounds = await page.locator('canvas').boundingBox();
        assert.ok(bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width);
        await page.screenshot({ path: fileURLToPath(new URL(`economy-${width}.png`, out)) });
    }
    await page.getByRole('button', { name: 'Resume from checkpoint' }).click();
    const resumed = await (await page.waitForFunction(savedTick => {
        const race = window.sunscarRallyQa?.state;
        return race && race.tick > savedTick ? { tick: race.tick, burst: race.racers[0].burst } : false;
    }, resumeAt.tick)).jsonValue();
    assert.equal(resumed.burst, false, 'Burst releases as soon as the restored race advances');
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.getByRole('button', { name: 'Save & return' }).click();
    await expect(page.getByRole('button', { name: 'Resume Grand Prix' })).toBeVisible();
    assert.ok(checkpoints.some(checkpoint => checkpoint.actions.some(action => action.kind === 'burst-off' && action.tick === resumeAt.tick)),
        'the release is recorded on the first resumed tick for authoritative replay');
    report.burstResume = { savedTick: resumeAt.tick, observedTick: resumed.tick, released: !resumed.burst };
    await expect(page.locator('canvas')).toHaveCount(0);
    assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false);
    report.checks.push('no-WebGL low-memory boot', 'same-renderer preference changes', '4x CPU clock parity', 'independent 30fps rendering', 'steer/jump/shot', 'paused rendering sleeps', 'mid-race 3D failure recovery', 'official save/resume', 'held Burst release on first resumed tick', '1x pixel cap', 'mobile/landscape/desktop fit', 'exit cleanup');
    await context.close();

    // A capable device with unavailable WebGL must recover into the same race.
    const fallback = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await fallback.newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 16 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : original.call(this, type, ...args); };
    });
    await page.route('**/api/festival/rally', async route => {
        const response = await route.fetch();
        const data = await response.json();
        if (route.request().postDataJSON()?.action === 'practice') {
            data.practice.tick = 3600;
            data.practice.racers.forEach((racer, i) => { racer.distance = 1020 - [20, 10, 30, 40][i]; racer.speed = 20; });
        }
        await route.fulfill({ response, json: data });
    });
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await expect(page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ })).toBeEnabled();
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy');
    await page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ }).click();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyQa?.state.finished)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL('graphics-failure-recovery.png', out)) });
    await expect(page.locator('.rally-podium > div')).toHaveCount(3);
    report.checks.push('3D failure automatically recovers', 'economy finish presentation/results');
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    if (page && !page.isClosed()) { report.lastState = await page.evaluate(() => window.sunscarRallyQa); console.log(JSON.stringify({ failure: report.lastState })); }
    if (page && !page.isClosed()) await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) });
    throw error;
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
}
