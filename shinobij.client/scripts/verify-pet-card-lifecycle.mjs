import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.PET_CARD_QA_URL ?? 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/pet-card-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { checks: [], errors: [] };
try {
    for (const mode of ['desktop', 'mobile', 'reduced']) {
        const context = await browser.newContext({ viewport: mode === 'desktop' ? { width: 1000, height: 760 } : { width: 390, height: 844 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => report.errors.push(`${mode}: ${error.message}`));
        await page.goto(`${base}/petvfx.html?cards=1`);
        const waitPhase = phase => page.waitForFunction(value => document.querySelector('canvas')?.dataset.petCardPhases === value, phase);
        await waitPhase('settled');
        assert.equal(await page.getByTestId('completions').textContent(), '1:0', 'StrictMode reports exactly one opening completion');
        const baseline = await page.locator('canvas').getAttribute('data-geometries');
        for (let cycle = 0; cycle < 5; cycle++) {
            await page.getByRole('button', { name: 'Recall', exact: true }).click();
            if (mode !== 'reduced' && cycle === 0) {
                await waitPhase('recall');
                await page.waitForTimeout(250);
                await page.getByRole('button', { name: 'Pause', exact: true }).click();
                const frozen = await page.locator('canvas').getAttribute('data-pet-card-poses');
                await page.waitForTimeout(350);
                assert.equal(await page.locator('canvas').getAttribute('data-pet-card-poses'), frozen, 'paused recall transform stays fixed');
                await page.screenshot({ path: fileURLToPath(new URL(`${mode}-recall.png`, out)) });
                await page.getByRole('button', { name: 'Resume', exact: true }).click();
            }
            await waitPhase('hidden');
            await page.getByRole('button', { name: 'Summon', exact: true }).click();
            await waitPhase('settled');
            assert.equal(await page.locator('canvas').getAttribute('data-geometries'), baseline, 'finite effect geometry retires after each summon');
        }
        assert.equal(await page.getByTestId('completions').textContent(), '6:5');
        await page.getByRole('button', { name: 'KO', exact: true }).click();
        if (mode !== 'reduced') await waitPhase('holding');
        await waitPhase('hidden');
        await page.getByRole('button', { name: 'Summon', exact: true }).click();
        await waitPhase('settled');
        await page.getByRole('button', { name: 'Swap mode', exact: true }).click();
        await waitPhase('settled');
        await page.route(/\/pet-models\/roster\/standard-1\.glb/, async route => { await new Promise(resolve => setTimeout(resolve, 1200)); await route.continue(); });
        await page.getByLabel('Pet', { exact: true }).selectOption('standard-1');
        await page.waitForTimeout(150);
        await waitPhase('settled');
        await page.getByLabel('Pet', { exact: true }).selectOption('standard-10');
        await page.getByLabel('Pet', { exact: true }).selectOption('starter-fire-r');
        await page.waitForTimeout(150);
        await waitPhase('settled');
        await page.screenshot({ path: fileURLToPath(new URL(`${mode}-settled.png`, out)) });
        if (mode === 'desktop') {
            await page.getByRole('button', { name: 'Evolution', exact: true }).click();
            await page.getByRole('button', { name: 'Play evolution', exact: true }).click();
            await page.waitForFunction(() => Number(document.querySelector('[data-testid="evo-time"]')?.textContent) > 2850);
            await page.screenshot({ path: fileURLToPath(new URL('evolution-recall.png', out)) });
            await page.waitForFunction(() => Number(document.querySelector('[data-testid="evo-time"]')?.textContent) > 4250);
            await page.screenshot({ path: fileURLToPath(new URL('evolution-release.png', out)) });
            await page.waitForFunction(() => Number(document.querySelector('[data-testid="evo-time"]')?.textContent) >= 8700);
            await page.screenshot({ path: fileURLToPath(new URL('evolution-settled.png', out)) });
        }
        await page.getByRole('button', { name: 'Companion preview', exact: true }).click();
        await page.locator('.icx-companion-render.is-model-ready').waitFor();
        await page.waitForFunction(() => document.querySelector('.icx-companion-render')?.getAttribute('data-summoning') === 'false');
        await page.getByLabel('Pet', { exact: true }).selectOption('standard-10');
        await page.waitForFunction(() => document.querySelector('.icx-companion-render')?.getAttribute('data-summoning') === 'false');
        await page.screenshot({ path: fileURLToPath(new URL(`${mode}-companion.png`, out)) });
        report.checks.push({ mode, cycles: 5, pausedRecall: mode !== 'reduced', koRecall: true, rapidSwaps: true, cleanup: true });
        await context.close();
        console.log(`${mode} pet card lifecycle passed`);
    }
    assert.deepEqual(report.errors, []);
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
}
