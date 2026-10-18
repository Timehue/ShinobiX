import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(import.meta.dirname, '../.tmp/pet-yard-model-review');
const base = process.env.PET_TECHNIQUES_QA_URL ?? 'http://127.0.0.1:4318';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const report = { errors: [], viewports: [] };
try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
        const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
        page.setDefaultTimeout(90000);
        page.on('pageerror', error => report.errors.push(error.message));
        const models = [];
        page.on('request', request => { if (request.url().includes('.glb')) models.push(request.url()); });
        await page.goto(`${base}/pet-tactics-qa.html?seat=alice&ranked=1&yard=1`, { waitUntil: 'commit' });
        await page.getByRole('button', { name: 'View companion', exact: true }).waitFor();
        assert.equal(models.length, 0, 'normal Yard does not download any GLB');
        assert.equal(await page.locator('canvas').count(), 0, 'closed inspector has no renderer');
        await page.getByRole('button', { name: 'View companion', exact: true }).click();
        const dialog = page.getByRole('dialog');
        const canvas = dialog.locator('canvas');
        await canvas.waitFor();
        await dialog.getByRole('status').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => Number(document.querySelector('canvas')?.dataset.previewTriangles) > 0);
        const read = () => canvas.evaluate(element => ({
            frames: Number(element.dataset.previewFrames), time: Number(element.dataset.previewTime),
            calls: Number(element.dataset.previewCalls), triangles: Number(element.dataset.previewTriangles), model: element.dataset.previewModel,
        }));
        const a = await read(), start = Date.now();
        await page.waitForTimeout(1500);
        const b = await read(), fps = (b.frames - a.frames) / ((Date.now() - start) / 1000);
        assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'viewer fits without horizontal scrolling');
        assert.ok(fps <= 28, `inspection animation frame cap: ${fps}`);
        assert.ok(b.calls <= 8, `bounded draw calls: ${b.calls}`);
        assert.ok(b.model.includes('warfront-lod'), 'uses the existing certified LOD');
        assert.equal(new Set(models).size, 1, 'one selected model only');
        await dialog.getByRole('button', { name: 'Pause preview', exact: true }).click();
        // A button label/row wrap can resize the demand canvas once. Let that
        // layout redraw settle before checking that no animation work repeats.
        await page.waitForTimeout(1200);
        const paused = await read();
        await page.waitForTimeout(400);
        const afterPause = await read();
        assert.equal(afterPause.time, paused.time, 'paused preview never advances animation');
        assert.ok(afterPause.frames - paused.frames <= 2, 'paused preview permits only incidental layout redraws');
        await dialog.getByRole('button', { name: 'Rotate pet right', exact: true }).click();
        await page.waitForTimeout(150);
        assert.equal((await read()).time, paused.time, 'rotation works without advancing paused animation');
        await dialog.screenshot({ path: resolve(output, `pet-${viewport.width}.png`) });
        await dialog.getByRole('button', { name: 'Resume preview', exact: true }).click();
        await dialog.locator('summary').filter({ hasText: 'Edit loadout' }).click();
        const editor = dialog.locator('.pet-techniques-editor');
        assert.equal(await editor.getByRole('checkbox').count(), 8);
        assert.equal(await dialog.getByRole('button', { name: 'Play technique', exact: true }).count(), 0);
        await editor.getByRole('checkbox').filter({ visible: true }).first().waitFor();
        await editor.getByRole('button', { name: 'Tactics build', exact: true }).click();
        const chosen = await editor.locator('input:checked').evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label')));
        if (await editor.getByRole('button', { name: 'Save loadout', exact: true }).count()) {
            await editor.getByRole('button', { name: 'Save loadout', exact: true }).click();
        }
        await editor.getByRole('button', { name: 'Loadout saved', exact: true }).waitFor();
        assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'expanded loadout has no horizontal overflow');
        assert.equal(await dialog.locator('option[value="chromatic"]').count(), 0, 'chromatic colors cannot be previewed');
        await dialog.screenshot({ path: resolve(output, `loadout-${viewport.width}.png`) });
        // Exercise the browser visibility event independently of headless tab policy.
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForTimeout(200);
        const hidden = await read();
        await page.waitForTimeout(1400);
        assert.deepEqual(await read(), hidden, 'hidden preview stops rendering');
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForTimeout(150);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('canvas').count(), 0, 'close retires the canvas');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.getByRole('button', { name: 'View companion', exact: true }).click();
        await page.getByRole('dialog').locator('canvas').waitFor();
        await page.getByRole('dialog').getByRole('status').waitFor({ state: 'hidden' });
        await page.getByRole('dialog').getByRole('button', { name: 'Resume preview', exact: true }).waitFor();
        await page.getByRole('dialog').locator('canvas').evaluate(element => element.dispatchEvent(new Event('webglcontextlost')));
        await page.getByRole('dialog').getByRole('status').filter({ hasText: '3D preview is unavailable' }).waitFor();
        assert.equal(await page.locator('canvas').count(), 0, 'graphics failure falls back to artwork');
        await page.getByRole('dialog').locator('summary').filter({ hasText: 'Collar & appearance preview' }).click();
        assert.equal(await page.getByRole('dialog').getByLabel('Preview appearance', { exact: true }).isDisabled(), true,
            'artwork fallback cannot pretend to preview 3D colors');
        assert.equal(await page.getByRole('dialog').getByLabel('Preview collar', { exact: true }).isEnabled(), true,
            'owned equipment remains available after a graphics failure');
        await page.getByRole('dialog').locator('summary').filter({ hasText: 'Edit loadout' }).click();
        assert.equal(await page.getByRole('dialog').getByRole('checkbox', { checked: true }).first().isEnabled(), true,
            'loadout editing remains available after a graphics failure');
        assert.deepEqual(await page.getByRole('dialog').locator('input:checked').evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label'))), chosen,
            'saved choices survive closing and reopening the inspector');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'View companion', exact: true }).click();
        await page.getByRole('dialog').locator('summary').filter({ hasText: 'Edit loadout' }).click();
        await page.getByRole('dialog').getByRole('heading', { name: 'Learnable techniques', exact: true }).waitFor();
        assert.equal(await page.locator('canvas').count(), 1, 'loadout editing stays inside the companion inspector');
        assert.equal(new Set(models).size, 1, 'reopening reuses the same model');
        report.viewports.push({ viewport, fps, ...b, normalYardModels: 0, uniqueModels: new Set(models).size, pause: true, hidden: true, close: true, reducedMotion: true, graphicsFallback: true, editorKeyboardFocus: true });
        await page.close();
    }
    assert.deepEqual(report.errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
