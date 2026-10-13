import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.PET_CARD_QA_URL ?? 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/pet-scene-recall-qa/', import.meta.url);
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
        const phase = value => page.waitForFunction(phase => document.querySelector('canvas')?.dataset.petCardPhases === phase, value);
        await phase('settled');
        await page.getByRole('button', { name: 'Demand mode', exact: true }).click();
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.getByRole('button', { name: 'Failed exit', exact: true }).click();
        if (mode !== 'reduced') {
            await phase('recall');
            assert.equal(await page.getByTestId('exit-error').textContent(), '', 'callback waits for recall');
            await page.screenshot({ path: fileURLToPath(new URL(`${mode}-paused-demand-recall.png`, out)) });
        }
        await page.getByTestId('exit-error').filter({ hasText: 'exit failed' }).waitFor();
        await page.getByRole('button', { name: 'Resume', exact: true }).click();
        await phase('settled');
        assert.equal(await page.getByTestId('scene-exits').textContent(), '0');
        // Repeated clicks still issue one departure, and paused demand rendering
        // must finish the entire paper flight before releasing the canvas.
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.getByRole('button', { name: 'Scene exit', exact: true }).dblclick({ delay: 20 });
        if (mode !== 'reduced') {
            await phase('recall');
            assert.equal(await page.getByTestId('scene-exits').textContent(), '0');
        }
        await page.getByRole('status').filter({ hasText: 'Scene closed' }).waitFor();
        assert.equal(await page.getByTestId('scene-exits').textContent(), mode === 'reduced' ? '2' : '1');
        assert.equal(await page.locator('canvas').count(), 0);
        const exits = Number(await page.getByTestId('scene-exits').textContent());
        await page.getByRole('button', { name: 'Resume', exact: true }).click();
        for (let cycle = 0; cycle < 3; cycle++) {
            await page.getByRole('button', { name: 'Reopen', exact: true }).click();
            await phase('settled');
            await page.getByRole('button', { name: 'Scene exit', exact: true }).click();
            await page.getByRole('status').filter({ hasText: 'Scene closed' }).waitFor();
            assert.equal(Number(await page.getByTestId('scene-exits').textContent()), exits + cycle + 1);
        }
        if (mode === 'desktop') {
            await page.getByRole('button', { name: 'Reopen', exact: true }).click();
            await phase('settled');
            await page.getByRole('button', { name: 'Swap mode', exact: true }).click();
            await phase('settled');
            await page.getByRole('button', { name: 'Failed exit', exact: true }).click();
            await phase('recall');
            await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-scene-recalling') === 'false');
            await phase('settled');
            // Keep a second participant pending so asset decoding under CPU
            // load cannot finish after the gate. The real incoming GLB must
            // still join and complete its own recall before this scene exits.
            await page.evaluate(() => { window.__releasePetCardGate = window.petCardQaHoldExit(); });
            await page.route(/\/pet-models\/roster\/standard-1\.glb/, async route => {
                await new Promise(resolve => setTimeout(resolve, 250));
                await route.continue();
            });
            await page.getByLabel('Pet', { exact: true }).selectOption('standard-1');
            const departureAt = Date.now();
            await page.getByRole('button', { name: 'Scene exit', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('canvas')?.dataset.petCardIdentities?.includes('standard-1:recall'));
            assert.equal(Number(await page.getByTestId('scene-exits').textContent()), exits + 3, 'a late incoming model extends the existing recall gate');
            await page.evaluate(() => window.__releasePetCardGate());
            await page.getByRole('status').filter({ hasText: 'Scene closed' }).waitFor();
            assert.ok(Date.now() - departureAt >= 1050, 'the late model completes its own card flight');
        }
        report.checks.push({ mode, pausedDemandExit: true, failedExitRecovery: true, repeatedMounts: 3 });
        await context.close();
        console.log(`${mode} scene recall passed`);
    }
    assert.deepEqual(report.errors, []);
    console.log('Pet scene recall verification passed');
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
}
