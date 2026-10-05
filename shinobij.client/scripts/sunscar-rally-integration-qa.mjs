import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-integration-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const expect = baseExpect.configure({ timeout: 45000 });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], expectedModelErrors: [], checks: [] };
let page;
let expectingModelFailure = false;
const open = async () => {
    expectingModelFailure = false;
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(45000);
    page.on('pageerror', error => {
        // Fiber reports caught loader failures too; only our injected fetch
        // failures are expected. Every other page error still fails the check.
        if (expectingModelFailure && /^Could not load \/pet-models\/.*\.glb[^:]*: Failed to fetch$/.test(error.message)) report.expectedModelErrors.push(error.message);
        else report.errors.push(error.message);
    });
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 16 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        localStorage.setItem('petRally.render.v1', '3d');
        localStorage.setItem('liteFx.v1', '1');
    });
};
const prepare = async () => {
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
};
try {
    await open();
    await page.request.post(`${base}/__qa/reset`);
    await prepare();
    assert.equal(await page.evaluate(() => window.sunscarRallyQa?.quality), 'light');
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 10);
    await page.keyboard.down('Shift');
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].burst);
    assert.equal(await page.evaluate(() => {
        const gl = document.querySelector('.rally-stage canvas')?.getContext('webgl2');
        const extension = gl?.getExtension('WEBGL_lose_context');
        extension?.loseContext();
        return !!extension;
    }), true, 'test actually loses the live graphics context');
    await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy');
    await expect.poll(() => page.evaluate(() => window.sunscarRallyRootCount?.())).toBe(0);
    await page.keyboard.up('Shift');
    const frozen = await page.evaluate(() => window.sunscarRallyQa.state.tick);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.state.tick), frozen);
    await page.getByRole('button', { name: 'Continue race' }).click();
    await page.waitForFunction(tick => window.sunscarRallyQa?.state.tick > tick, frozen);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.state.racers[0].burst), false);
    report.checks.push('live WebGL loss pauses safely, loads battery saver, and releases held Burst');
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('3d');
    await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'light');
    await page.getByRole('button', { name: 'Continue race' }).click();
    await page.waitForFunction(tick => window.sunscarRallyQa?.state.tick > tick + 10, frozen);
    report.checks.push('3D renderer can be recreated and resumed after context retirement');
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.getByRole('button', { name: 'Save & return' }).click();
    await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeVisible();
    assert.equal(await page.locator('.rally-stage canvas').count(), 0);
    assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false);
    report.checks.push('recreated renderer removes its canvas and instrumentation on exit');
    await page.close();

    await open();
    expectingModelFailure = true;
    let failedModels = 0;
    await page.route(/\.glb(?:\?|$)/, route => { failedModels++; return route.abort(); });
    await prepare();
    assert.ok(failedModels > 0, 'model failure was exercised');
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy');
    await expect(page.locator('.rally-intro-overlay')).toContainText('graphics interruption');
    await expect.poll(() => page.evaluate(() => window.sunscarRallyRootCount?.())).toBe(0);
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 30);
    await page.screenshot({ path: fileURLToPath(new URL('model-fallback.png', out)) });
    report.checks.push('missing 3D model recovers to a playable race with existing sprite artwork');
    await page.close();

    await open();
    await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        let attempts = 0;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            // The capability probe works, but allocating the actual renderer fails.
            if (type === 'webgl2' && ++attempts > 1) return null;
            return original.call(this, type, ...args);
        };
    });
    await prepare();
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy');
    await expect(page.locator('.rally-intro-overlay')).toContainText('graphics interruption');
    await expect.poll(() => page.evaluate(() => window.sunscarRallyRootCount?.())).toBe(0);
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 30);
    report.checks.push('renderer allocation failure after a successful WebGL probe also recovers');
    await page.close();

    await open();
    await page.addInitScript(() => {
        localStorage.setItem('petRally.render.v1', 'economy');
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            if (type === '2d') return null;
            return original.call(this, type, ...args);
        };
    });
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await expect(page.locator('.rally-intro-overlay [role=alert]')).toContainText('race graphics could not load');
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Race graphics' }).selectOption('3d');
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'light');
    report.checks.push('unavailable 2D surface blocks invisible racing and can recover by changing graphics');
    assert.deepEqual(report.errors, []);
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    if (page && !page.isClosed()) {
        await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) });
        console.error(JSON.stringify({ ...report, state: await page.evaluate(() => ({ metrics: window.sunscarRallyQa, roots: window.sunscarRallyRootCount?.(), overlay: document.querySelector('.rally-intro-overlay')?.textContent })) }, null, 2));
    }
    throw error;
} finally { await browser.close(); }
