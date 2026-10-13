import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.PET_CARD_QA_URL ?? 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/warfront-card-departure-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { errors: [], checks: [] };
try {
    for (const skip of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 430, height: 900 }, reducedMotion: 'no-preference' });
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => report.errors.push(error.message));
        await page.goto(`${base}/petvfx.html?rite=1&riteqa=1&petQuality=low&autostart=1&ritespeed=${skip ? '.78' : '30'}`);
        await page.waitForFunction(() => Number(document.querySelector('[data-testid="wfr-clock"]')?.getAttribute('data-tick')) > 0);
        if (skip) await page.getByRole('button', { name: 'Skip to result', exact: true }).click();
        await page.locator('.wfr-root[data-recalling="true"]').waitFor();
        await page.waitForFunction(() => document.querySelector('.wfr-canvas canvas')?.dataset.ritePetCardPhases?.includes('recall'));
        const tick = await page.getByTestId('wfr-clock').getAttribute('data-tick');
        await page.waitForTimeout(250);
        assert.equal(await page.getByTestId('wfr-clock').getAttribute('data-tick'), tick, 'the fight clock stays frozen during departure');
        assert.equal(await page.locator('.wfr-result-line').count(), 0, 'the verdict waits for recall');
        await page.screenshot({ path: fileURLToPath(new URL(skip ? 'skip-card-recall.png' : 'automatic-card-recall.png', out)) });
        await page.locator('.wfr-result-line').waitFor();
        const harness = page.getByTestId('rite-harness-settlement');
        assert.equal((await page.locator('.wfr-result-line').innerText()).trim(), await harness.getAttribute('data-expected-result-line'), 'card transitions preserve the complete deterministic verdict');
        await page.getByRole('button', { name: 'Leave the Warfront', exact: true }).click();
        await page.getByRole('button', { name: 'Reopen Warfront', exact: true }).waitFor();
        assert.equal(await page.locator('canvas').count(), 0);
        report.checks.push(skip ? 'spectator skip recalls before verdict and releases the canvas' : 'every automatic clash recalls before re-form or final verdict');
        await page.close();
        console.log(report.checks.at(-1));
    }
    assert.deepEqual(report.errors, []);
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
}
