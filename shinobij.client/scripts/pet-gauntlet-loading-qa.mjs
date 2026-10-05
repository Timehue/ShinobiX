import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

// Build with vite.gauntlet-qa.config.mjs first. Uses the production renderer,
// real assets and a deterministic local fight; no accounts or rewards involved.
const out = new URL('../../.tmp/pet-gauntlet-loading-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const app = express();
app.use(express.static(fileURLToPath(new URL('../../.tmp/gauntlet-qa-dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
const server = await new Promise(resolve => { const server = app.listen(5210, '127.0.0.1', () => resolve(server)); });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], expectedMissingModels: [], cycles: [], requests: [], scenarios: [] };
const url = 'http://127.0.0.1:5210/gauntlet-qa.html';
const open = async (query = '?petQuality=low', viewport = { width: 1280, height: 800 }, missingModels = false) => {
    const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => {
        const expected = missingModels && /^Could not load \/pet-models\/.* responded with 404: Not Found$/.test(error.message);
        (expected ? report.expectedMissingModels : report.errors).push(error.message);
    });
    await page.goto(url + query);
    return page;
};
const ready = async page => {
    await page.locator('[data-loading="false"]').waitFor();
    assert.equal(await page.getByText('Battle resolved safely').count(), 0);
};
const clean = async page => {
    await page.getByRole('button', { name: 'Unmount', exact: true }).click();
    await page.waitForFunction(() => window.gauntletProbe.snapshot().activeContexts === 0);
    await page.waitForTimeout(1200);
    const metrics = await page.evaluate(() => window.gauntletProbe.snapshot());
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(metrics.pendingFrames, 0);
    assert.equal(metrics.pendingTimers, 0);
    assert.equal(metrics.intervals, 0);
    for (const n of Object.values(metrics.handles)) assert.equal(n, 0);
    report.cycles.push(metrics);
};
try {
    const page = await open();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(/\/pet-models\/.*\.glb/, async route => {
        report.requests.push(route.request().url());
        await held;
        await route.continue();
    });
    await page.getByRole('button', { name: 'Mount', exact: true }).click();
    await page.getByText('Summoning your formation…').waitFor();
    await page.waitForTimeout(5000);
    assert.match(await page.locator('.gauntlet-board-round strong').innerText(), /^Round 0/);
    assert.ok(await page.locator('.gauntlet-unitplate').first().evaluate(node => {
        const rect = node.getBoundingClientRect();
        return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.gauntlet-board-loading');
    }), 'loading overlay covers floating pet labels too');
    await page.screenshot({ path: fileURLToPath(new URL('cold-loading.png', out)) });
    release();
    await ready(page);
    assert.ok(report.requests.length >= 3);
    assert.ok(report.requests.every(request => request.includes('/warfront-lod/')));
    await page.locator('[data-summoning="false"]').waitFor();
    assert.match(await page.locator('.gauntlet-board-round strong').innerText(), /^Round 0/);
    await page.screenshot({ path: fileURLToPath(new URL('ready.png', out)) });
    await page.getByRole('button', { name: 'Continue the run' }).waitFor();
    await page.waitForTimeout(7000);
    const draws = await page.evaluate(() => window.gauntletProbe.snapshot().draws);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.gauntletProbe.snapshot().draws), draws, 'settled results stop drawing');
    report.scenarios.push('five-second cold delay holds round zero; LOD renders; settled results idle');
    await clean(page);
    for (let i = 0; i < 4; i++) {
        await page.getByRole('button', { name: 'Mount', exact: true }).click();
        await ready(page);
        await page.waitForTimeout(500);
        await clean(page);
    }
    await page.close();

    const failed = await open(undefined, undefined, true);
    await failed.route(/\/pet-models\/.*\.glb/, route => route.fulfill({ status: 404, body: 'QA missing model' }));
    await failed.getByRole('button', { name: 'Mount', exact: true }).click();
    await ready(failed);
    assert.ok(report.expectedMissingModels.length >= 3);
    await failed.waitForTimeout(2000);
    await failed.screenshot({ path: fileURLToPath(new URL('fallback.png', out)) });
    await clean(failed);
    report.scenarios.push('missing GLBs recover to identity-correct pose art');
    await failed.close();

    const stalled = await open();
    await stalled.route(/\/pet-models\/.*\.glb/, () => {});
    await stalled.getByRole('button', { name: 'Mount', exact: true }).click();
    await stalled.getByText('The arena could not finish loading or rendering. Your battle result is saved').waitFor();
    await stalled.getByRole('button', { name: 'Continue the run' }).click();
    await stalled.waitForFunction(() => window.gauntletProbe.snapshot().activeContexts === 0);
    report.scenarios.push('stalled download releases arena and preserves result after bounded wait');
    await stalled.close();

    const mobile = await open('?full', { width: 430, height: 900 });
    await mobile.getByRole('button', { name: 'Warm models' }).click();
    await mobile.waitForTimeout(2000);
    await mobile.getByRole('button', { name: 'Mount', exact: true }).click();
    await ready(mobile);
    assert.match(await mobile.locator('.gauntlet-board-build').innerText(), /low/i);
    await mobile.locator('[data-summoning="false"]').waitFor();
    await mobile.screenshot({ path: fileURLToPath(new URL('mobile-5v5.png', out)) });
    await clean(mobile);
    report.scenarios.push('prewarmed ten-pet mobile formation renders at capped quality');
    await mobile.close();
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report, null, 2));
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
    server.close();
}
