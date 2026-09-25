import assert from 'node:assert/strict';
import { chromium } from '../shinobij.client/node_modules/@playwright/test/index.mjs';
import { writeFile } from 'node:fs/promises';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:5180';
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const report = [];
const curtainReady = () => document.querySelector('[data-testid="wfr-stage-curtain"]')?.getAttribute('data-stage-ready') === 'true';
const tickOf = (page) => page.getByTestId('wfr-clock').getAttribute('data-tick').then(Number);
/** No graphics failure may pause a battle for good: it must play on. */
async function expectBattlePlaysOn(page) {
    await page.getByTestId('wfr-reduced-stage').waitFor({ timeout: 60_000 });
    await (await page.waitForFunction(curtainReady, null, { timeout: 20_000 })).dispose();
    const before = await tickOf(page);
    await (await page.waitForFunction((tick) => Number(document.querySelector('[data-testid="wfr-clock"]')?.getAttribute('data-tick')) > tick + 1, before, { timeout: 30_000 })).dispose();
}
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
        // Both graphics routes need the injected image, so the clash continues
        // in the reduced view rather than waiting behind a retry.
        await expectBattlePlaysOn(page);
        await page.unroute('**/kage-fire-impact-burst-v1-512.png');
        await page.getByRole('button', { name: 'Retry full graphics', exact: true }).click();
        const ready = await page.waitForFunction(() => document.querySelector('[data-testid="wfr-stage-curtain"]')?.getAttribute('data-stage-ready') === 'true'
            && document.querySelector('canvas.wfr-canvas-surface') !== null, null, { timeout: 20_000 });
        await ready.dispose();
        assert.equal(await page.locator('[data-testid="wfr-reduced-stage"]').count(), 0);
        // R3F deliberately calls window.reportError for caught render errors as
        // well as uncaught ones. Only the exact injected image may be reported.
        const injectedAssetErrors = errors.filter((error) => error === 'Could not load /assets/warfront/kage-fire-impact-burst-v1-512.png: undefined');
        assert.deepEqual(errors.filter((error) => !injectedAssetErrors.includes(error)), []);
        report.push({ failedChunk, continuedOnReducedView: true, recoveredOnCanvas: true, reportedAssetFailures: injectedAssetErrors.length, unexpectedErrors: [] });
        await page.close();
    }
    const legacyPage = await browser.newPage();
    const legacyErrors = [];
    legacyPage.on('pageerror', (error) => legacyErrors.push(error.message));
    await legacyPage.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
    await legacyPage.goto(`${baseURL}/petvfx.html?rite=1&petQuality=low&riteqa=1&ritemissingmodelqa=1&riteforce3d=1`);
    await legacyPage.getByRole('button', { name: 'Lock formation', exact: true }).click();
    await expectBattlePlaysOn(legacyPage);
    assert.deepEqual(legacyErrors, []);
    report.push({ missingPetModelIdentity: true, continuedOnReducedView: true, unexpectedErrors: legacyErrors });
    await legacyPage.close();
    const stalledPage = await browser.newPage();
    const stalledErrors = [];
    stalledPage.on('pageerror', (error) => stalledErrors.push(error.message));
    await stalledPage.route('**/api/perf-beacon', (route) => route.fulfill({ status: 204 }));
    let blockedChunk;
    await stalledPage.route('**/assets/PetWarfrontRiteStage3D-*.js', (route) => { blockedChunk = route; });
    await stalledPage.goto(`${baseURL}/petvfx.html?rite=1&petQuality=low&riteqa=1&riteforce3d=1`);
    await stalledPage.getByRole('button', { name: 'Lock formation', exact: true }).click();
    const stalledReady = await stalledPage.waitForFunction(curtainReady, null, { timeout: 55_000 });
    await stalledReady.dispose();
    assert.equal(await stalledPage.locator('canvas.wfr-canvas-surface').count(), 1);
    assert.deepEqual(stalledErrors, []);
    report.push({ stalledRendererDownload: true, preparationDeadlineRecoveredOnCanvas: true, unexpectedErrors: stalledErrors });
    await blockedChunk?.abort('failed');
    await stalledPage.close();
    await writeFile('docs/warfront-render-failure-audit.json', JSON.stringify({ baseURL, report }, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
