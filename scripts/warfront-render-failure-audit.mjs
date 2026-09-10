import assert from 'node:assert/strict';
import { chromium } from '../shinobij.client/node_modules/@playwright/test/index.mjs';
import { writeFile } from 'node:fs/promises';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:5180';
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const report = [];
try {
    for (const failedChunk of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
        await page.route('**/kage-fire-impact-burst-v1-512.png', (route) => route.fulfill({ status: 404, body: 'Injected image failure' }));
        if (failedChunk) await page.route('**/assets/PetWarfrontRiteStage3D-*.js', (route) => route.abort('failed'));
        await page.goto(`${baseURL}/petvfx.html?rite=1&petQuality=low&riteqa=1&avian=1&ritemotionqa=1&riteforce3d=1`);
        await page.getByRole('button', { name: 'Lock formation', exact: true }).click();
        await page.getByRole('button', { name: 'Retry battle graphics', exact: true }).waitFor({ timeout: 15_000 });
        assert.equal(await page.locator('[data-testid="wfr-stage-curtain"]').getAttribute('data-stage-ready'), 'false');
        await page.unroute('**/kage-fire-impact-burst-v1-512.png');
        await page.getByRole('button', { name: 'Retry battle graphics', exact: true }).click();
        const ready = await page.waitForFunction(() => document.querySelector('[data-testid="wfr-stage-curtain"]')?.getAttribute('data-stage-ready') === 'true', null, { timeout: 20_000 });
        await ready.dispose();
        assert.equal(await page.locator('canvas.wfr-canvas-surface').count(), 1);
        assert.equal(await page.locator('[data-testid="wfr-render-failure"]').count(), 0);
        // R3F deliberately calls window.reportError for caught render errors as
        // well as uncaught ones. Only the exact injected image may be reported.
        const injectedAssetErrors = errors.filter((error) => error === 'Could not load /assets/warfront/kage-fire-impact-burst-v1-512.png: undefined');
        assert.deepEqual(errors.filter((error) => !injectedAssetErrors.includes(error)), []);
        report.push({ failedChunk, recoveredOnCanvas: true, reportedAssetFailures: injectedAssetErrors.length, unexpectedErrors: [] });
        await page.getByRole('button', { name: 'Leave the Warfront', exact: true }).click();
        await page.getByRole('button', { name: 'Reopen Warfront', exact: true }).waitFor();
        await page.close();
    }
    const legacyPage = await browser.newPage();
    const legacyErrors = [];
    legacyPage.on('pageerror', (error) => legacyErrors.push(error.message));
    await legacyPage.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
    await legacyPage.goto(`${baseURL}/petvfx.html?rite=1&petQuality=low&riteqa=1&ritemissingmodelqa=1&riteforce3d=1`);
    await legacyPage.getByRole('button', { name: 'Lock formation', exact: true }).click();
    await legacyPage.getByRole('button', { name: 'Retry battle graphics', exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await legacyPage.locator('[data-testid="wfr-stage-curtain"]').getAttribute('data-stage-ready'), 'false');
    await legacyPage.getByRole('button', { name: 'Leave the Warfront', exact: true }).click();
    await legacyPage.getByRole('button', { name: 'Reopen Warfront', exact: true }).waitFor();
    assert.deepEqual(legacyErrors, []);
    report.push({ missingPetModelIdentity: true, loadingFailureVisible: true, exitAvailable: true, unexpectedErrors: legacyErrors });
    await legacyPage.close();
    const stalledPage = await browser.newPage();
    const stalledErrors = [];
    stalledPage.on('pageerror', (error) => stalledErrors.push(error.message));
    await stalledPage.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
    let blockedChunk;
    await stalledPage.route('**/assets/PetWarfrontRiteStage3D-*.js', (route) => { blockedChunk = route; });
    await stalledPage.goto(`${baseURL}/petvfx.html?rite=1&petQuality=low&riteqa=1&riteforce3d=1`);
    await stalledPage.getByRole('button', { name: 'Lock formation', exact: true }).click();
    const stalledReady = await stalledPage.waitForFunction(() => document.querySelector('[data-testid="wfr-stage-curtain"]')?.getAttribute('data-stage-ready') === 'true', null, { timeout: 55_000 });
    await stalledReady.dispose();
    assert.equal(await stalledPage.locator('canvas.wfr-canvas-surface').count(), 1);
    assert.deepEqual(stalledErrors, []);
    report.push({ stalledRendererDownload: true, preparationDeadlineRecoveredOnCanvas: true, unexpectedErrors: stalledErrors });
    await blockedChunk?.abort('failed');
    await stalledPage.close();
    await writeFile('docs/warfront-render-failure-audit.json', JSON.stringify({ baseURL, report }, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
