import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-checkpoint-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const expect = baseExpect.configure({ timeout: 45000 });
const browser = await chromium.launch({ headless: true });
const report = { errors: [], checks: [] };
let page;
try {
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('petRally.render.v1', 'economy');
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
    });
    let checkpointStarted = false, checkpointReleased = false, savedTick = 0;
    await page.route('**/api/festival/rally', async route => {
        const action = route.request().postDataJSON()?.action;
        const response = await route.fetch();
        const data = await response.json();
        if (action === 'prepare') {
            // Browser-only prediction. The real server starts at the actual
            // course beginning, so its first checkpoint corrects this finish.
            const length = { 'grand-circuit': 1020, 'scorpions-spine': 930, 'burning-dunes': 1180, 'caravan-clash': 960 }[data.preview.trackId];
            assert.ok(length);
            data.preview.racers.forEach((racer, index) => {
                Object.assign(racer, { distance: length - [20, 10, 30, 40][index], speed: 20 });
            });
        }
        if (action === 'checkpoint' && !checkpointStarted) {
            checkpointStarted = true;
            assert.equal(data.progress.current.race.finished, false, 'the production server returns an unfinished authoritative race');
            savedTick = data.progress.current.race.tick;
            report.authoritative = { tick: savedTick, finished: false, results: data.progress.current.results.length };
            // Allow the local finish's whole presentation to settle first.
            await new Promise(resolve => setTimeout(resolve, 4000));
            checkpointReleased = true;
        }
        await route.fulfill({ response, json: data });
    });
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Prepare Grand Prix' }).click();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.finished);
    await expect.poll(() => checkpointStarted).toBe(true);
    await page.waitForTimeout(2750);
    const settled = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount }));
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount })), settled,
        'the predicted local finish settled before its acknowledgement');
    assert.equal(checkpointReleased, false, 'the acknowledgement is still held');
    assert.equal(await page.locator('.rally-results').count(), 0, 'unconfirmed finish does not publish official results');
    assert.equal(report.authoritative.results, 0);
    await page.screenshot({ path: fileURLToPath(new URL('predicted-finish-pending.png', out)) });
    await expect.poll(() => checkpointReleased).toBe(true);
    const resumed = await (await page.waitForFunction(tick => {
        const race = window.sunscarRallyQa?.state;
        return race && !race.finished && race.tick > tick + 30 ? { tick: race.tick, finished: race.finished } : false;
    }, savedTick)).jsonValue();
    assert.equal(await page.locator('.rally-results').count(), 0, 'the corrected unfinished race keeps results closed');
    await expect(page.getByRole('button', { name: 'Steer right, left stick, D or Right Arrow' })).toBeEnabled();
    await page.getByRole('button', { name: 'Steer right, left stick, D or Right Arrow' }).click();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyQa.state.racers[0].targetLane)).toBe(1);
    report.resumed = resumed;
    report.checks.push('local predicted finish settles while final acknowledgement is delayed', 'official results wait for confirmation',
        'unfinished authoritative correction restarts the clock and renderer', 'controls remain usable after correction');
    await page.screenshot({ path: fileURLToPath(new URL('authoritative-race-resumed.png', out)) });
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.getByRole('button', { name: 'Save & return' }).click();
    await expect(page.getByRole('button', { name: 'Resume Grand Prix' })).toBeVisible();
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    if (page && !page.isClosed()) {
        report.lastState = await page.evaluate(() => window.sunscarRallyQa);
        await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) });
    }
    throw error;
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
}
