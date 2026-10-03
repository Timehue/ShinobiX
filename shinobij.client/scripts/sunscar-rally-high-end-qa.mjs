import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-high-end-qa/', import.meta.url);
const expect = baseExpect.configure({ timeout: 45000 });
const report = { errors: [], checks: [], samples: [] };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=d3d11'] });
process.once('SIGINT', () => { void browser.close(); });
let page, scenario = 'race';
try {
    const cdp = await browser.newBrowserCDPSession();
    report.gpu = (await cdp.send('SystemInfo.getInfo')).gpu;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
    page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 16 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        localStorage.removeItem('petRally.render.v1');
        localStorage.setItem('liteFx.v1', '0');
    });
    await page.route('**/api/festival/rally', async route => {
        const response = await route.fetch(), data = await response.json();
        if (route.request().postDataJSON()?.action === 'practice') {
            data.practice.racers.forEach((racer, i) => Object.assign(racer, { rivalId: null, speed: 0,
                distance: [40, 48, 62, 84][i], lane: [0, 0, 1, -1][i], targetLane: [0, 0, 1, -1][i], motion: 'ready' }));
            data.practice.racers[0].attackCharge = 100;
            if (scenario === 'finish') {
                data.practice.tick = 3600;
                data.practice.racers.forEach((racer, i) => Object.assign(racer, { distance: 1020 - [20, 10, 24, 28][i], speed: 20 }));
            }
        }
        await route.fulfill({ response, json: data });
    });
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    const prepare = async () => {
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await expect(page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ })).toBeEnabled();
        await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'full');
        await expect(page.getByRole('combobox', { name: 'Race graphics' })).toHaveValue('auto');
    };
    await prepare();
    report.context = await page.locator('.rally-stage canvas').evaluate(canvas => {
        const gl = canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
        return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            antialias: gl.getContextAttributes().antialias, width: canvas.width, height: canvas.height };
    });
    assert.ok(report.context.renderer && !/SwiftShader|llvmpipe|software/i.test(report.context.renderer), 'full-quality evidence requires hardware WebGL');
    assert.equal(report.context.antialias, true);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.pixelRatio), 1.5);
    report.checks.push('automatic high-end profile selects full hardware 3D with MSAA and capped 1.5 DPR');
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 120);
    const before = await page.evaluate(() => ({ time: performance.now(), ...window.sunscarRallyQa }));
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => ({ time: performance.now(), ...window.sunscarRallyQa }));
    assert.equal(after.quality, 'full');
    const elapsed = (after.time - before.time) / 1000;
    report.samples.push({ elapsed, fps: (after.frameCount - before.frameCount) / elapsed,
        tickAdvance: after.state.tick - before.state.tick, calls: after.calls, triangles: after.triangles,
        geometry: after.geometry, textures: after.textures, pixelRatio: after.pixelRatio });
    await page.screenshot({ path: fileURLToPath(new URL('full-running.png', out)) });
    await page.keyboard.down('Shift');
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].burst);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => !window.sunscarRallyQa?.state.racers[0].burst);
    await page.keyboard.press('KeyD');
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].targetLane === 1);
    await page.keyboard.press('KeyQ');
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].shotsFired === 1);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].techniqueUsed);
    await page.waitForFunction(() => { const p = window.sunscarRallyQa?.state.racers[0]; return p && !p.stagger && !p.jumpCooldown; });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].jump > .1);
    await page.screenshot({ path: fileURLToPath(new URL('full-jump-technique.png', out)) });
    report.checks.push('full 3D steering, held Burst/release, shot, technique, and physical jump reach the shared simulation');
    await page.getByRole('button', { name: 'Pause race' }).click();
    // The 3D metrics snapshot is published at 10 Hz. Repaint the stopped
    // demand renderer once so comparisons use the final physical race tick.
    await page.setViewportSize({ width: 1280, height: 801 }); await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(200);
    const frozen = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frameCount: window.sunscarRallyQa.frameCount }));
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frameCount: window.sunscarRallyQa.frameCount })), frozen);
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('economy');
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy' && window.sunscarRallyQa.spriteCount === 4);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.state.tick), frozen.tick);
    await expect.poll(() => page.evaluate(() => window.sunscarRallyRootCount())).toBe(0);
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('3d');
    await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'full');
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.state.tick), frozen.tick);
    await page.getByRole('button', { name: 'Continue race' }).click();
    await page.waitForFunction(tick => window.sunscarRallyQa?.state.tick > tick + 10, frozen.tick);
    report.checks.push('paused full 3D sleeps; switching 3D→2D→3D preserves race state and retires the old renderer');
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('auto');
    await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save & return' }).click();
    await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyRootCount())).toBe(0);
    assert.equal(await page.locator('.rally-stage canvas').count(), 0);
    scenario = 'finish'; await prepare();
    await page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.finished);
    await page.screenshot({ path: fileURLToPath(new URL('full-finish.png', out)) });
    await page.waitForTimeout(3000);
    const finishFrames = await page.evaluate(() => window.sunscarRallyQa.frameCount);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.frameCount), finishFrames);
    await page.getByRole('button', { name: 'Return to the race desk' }).click();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyRootCount())).toBe(0);
    assert.equal(await page.locator('.rally-stage canvas').count(), 0);
    assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false);
    report.checks.push('full 3D finish presentation settles and sleeps, then removes the canvas and Fiber root');
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ renderer: report.context.renderer, samples: report.samples, checks: report.checks, errors: report.errors }, null, 2));
} catch (error) {
    report.fatal = error.message; process.exitCode = 1;
    if (page && !page.isClosed()) await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) });
    console.error(error);
} finally {
    await browser.close();
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
}
