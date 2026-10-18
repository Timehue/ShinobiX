import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(import.meta.dirname, '../.tmp/pet-yard-care-review');
const base = process.env.PET_TECHNIQUES_QA_URL ?? 'http://127.0.0.1:4319';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const report = { errors: [], viewports: [] };
try {
    for (const [seat, viewport] of [['alice', { width: 1280, height: 900 }], ['bob', { width: 390, height: 844 }]]) {
        const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
        page.setDefaultTimeout(180000);
        page.on('pageerror', error => report.errors.push(error.message));
        const models = new Set(), mutations = [];
        page.on('request', request => {
            if (request.url().includes('.glb')) models.add(request.url());
            if (request.url().includes('/api/pet/progress') && request.method() === 'POST') mutations.push(request.postDataJSON());
        });
        const save = () => page.evaluate(async name => (await (await fetch(`/api/save/${name}`)).json()).character, seat);
        await page.goto(`${base}/pet-tactics-qa.html?seat=${seat}&ranked=1&yard=1`, { waitUntil: 'commit' });
        await page.getByRole('button', { name: 'View companion', exact: true }).waitFor();
        const portraits = await page.locator('.pet-slot-card img').evaluateAll(images => images.map(image => image.src));
        assert.ok(portraits.length > 0);
        assert.equal(models.size, 0);
        const initial = await save();
        assert.ok(initial.pets[0].training, 'start the isolated care harness with a fresh completed-training fixture');
        await page.getByRole('button', { name: 'View companion', exact: true }).click();
        const dialog = page.getByRole('dialog'), canvas = dialog.locator('canvas');
        await canvas.waitFor();
        await dialog.getByRole('status').filter({ hasText: 'Loading companion' }).waitFor({ state: 'hidden' });
        await page.waitForFunction(() => Number(document.querySelector('canvas')?.dataset.previewTriangles) > 0);
        let releaseCare;
        const careGate = new Promise(resolveGate => { releaseCare = resolveGate; });
        await page.route('**/api/pet/progress', async route => {
            if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'pet') {
                await careGate;
                await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Care service temporarily unavailable.' }) });
            } else await route.continue();
        });
        await dialog.getByRole('button', { name: 'Pet companion', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: 'Saving companion changes' }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: 'Pet companion', exact: true }).isDisabled(), true);
        assert.equal(await dialog.getByRole('button', { name: 'Feed companion', exact: true }).isDisabled(), true);
        releaseCare();
        await dialog.getByRole('alert').filter({ hasText: 'Care service temporarily unavailable' }).waitFor();
        assert.equal(await canvas.getAttribute('data-preview-care-serial'), '0', 'failed request never plays a success reaction');
        assert.deepEqual((await save()).pets[0], initial.pets[0]);
        await page.unroute('**/api/pet/progress');
        await dialog.getByRole('button', { name: 'Pet companion', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: 'enjoyed your company' }).waitFor();
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.previewCareSerial === '1');
        assert.ok((await save()).pets[0].happiness > initial.pets[0].happiness);
        await dialog.getByRole('button', { name: 'Feed companion', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: 'enjoyed the treat' }).waitFor();
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.previewCareSerial === '2');
        const fed = await save();
        assert.equal(fed.inventory.filter(item => item === 'pet-treat').length,
            initial.inventory.filter(item => item === 'pet-treat').length - 1, 'one real treat consumed');
        assert.ok(fed.pets[0].xp > initial.pets[0].xp);
        await dialog.getByRole('button', { name: 'Collect training', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: 'finished training' }).waitFor();
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.previewCare === 'training');
        const trained = await save();
        assert.ok(!trained.pets[0].training);
        await dialog.screenshot({ path: resolve(output, `care-${viewport.width}.png`) });
        await dialog.locator('summary').filter({ hasText: 'Collar & appearance preview' }).click();
        const countBefore = mutations.length;
        await dialog.getByLabel('Preview collar', { exact: true }).selectOption('collar-azure');
        await dialog.getByRole('button', { name: 'Preview only', exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: 'Preview only', exact: true }).isDisabled(), true);
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.previewCollar === 'collar-azure');
        assert.equal(await dialog.getByLabel('Preview appearance', { exact: true }).locator('option[value="chromatic"]').count(), 0);
        await dialog.getByLabel('Preview appearance', { exact: true }).selectOption('original');
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.previewAppearance === 'original');
        assert.equal(mutations.length, countBefore, 'previewing items and colors performs no save mutation');
        assert.deepEqual((await save()).pets[0], trained.pets[0]);
        await dialog.screenshot({ path: resolve(output, `appearance-${viewport.width}.png`) });
        await dialog.getByLabel('Preview appearance', { exact: true }).selectOption('current');
        await dialog.getByLabel('Preview collar', { exact: true }).selectOption('collar-crimson');
        await dialog.getByRole('button', { name: 'Equip collar', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: 'Collar equipped' }).waitFor();
        assert.equal((await save()).pets[0].loadout.collar, 'collar-crimson');
        await dialog.getByLabel('Preview collar', { exact: true }).selectOption('collar-prismatic');
        await dialog.getByRole('button', { name: 'Equip collar', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: 'Collar equipped' }).waitFor();
        assert.equal((await save()).pets[0].loadout.collar, 'collar-prismatic');
        await dialog.getByRole('button', { name: 'Pause preview', exact: true }).click();
        await page.waitForTimeout(200);
        const paused = await canvas.getAttribute('data-preview-time');
        await page.waitForTimeout(350);
        assert.equal(await canvas.getAttribute('data-preview-time'), paused);
        const calls = Number(await canvas.getAttribute('data-preview-calls'));
        assert.ok(calls <= 4, `one model plus two unlit collar surfaces: ${calls} draw calls`);
        await dialog.screenshot({ path: resolve(output, `prismatic-${viewport.width}.png`) });
        assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'viewer has no horizontal overflow');
        assert.ok(await dialog.getByLabel('Preview collar', { exact: true }).evaluate((element, minimum) => element.clientWidth >= minimum, viewport.width < 440 ? 280 : 150),
            'collar names retain readable width');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('canvas').count(), 0);
        assert.deepEqual(await page.locator('.pet-slot-card img').evaluateAll(images => images.map(image => image.src)), portraits);
        await page.reload({ waitUntil: 'commit' });
        await page.getByRole('button', { name: 'View companion', exact: true }).click();
        await page.getByRole('dialog').locator('summary').filter({ hasText: 'Collar & appearance preview' }).click();
        assert.equal(await page.getByRole('dialog').getByLabel('Preview collar', { exact: true }).inputValue(), 'collar-prismatic');
        assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Equipped', exact: true }).isDisabled(), true);
        await page.getByRole('dialog').getByLabel('Preview collar', { exact: true }).selectOption('');
        await page.getByRole('dialog').getByRole('button', { name: 'Remove collar', exact: true }).click();
        await page.getByRole('dialog').getByRole('status').filter({ hasText: 'Collar removed' }).waitFor();
        assert.equal((await save()).pets[0].loadout?.collar, undefined);
        await page.getByRole('dialog').getByLabel('Preview collar', { exact: true }).selectOption('collar-prismatic');
        await page.getByRole('dialog').getByRole('button', { name: 'Equip collar', exact: true }).click();
        await page.getByRole('dialog').getByRole('status').filter({ hasText: 'Collar equipped' }).waitFor();
        await page.getByRole('dialog').locator('summary').filter({ hasText: 'Edit loadout' }).click();
        assert.equal(await page.locator('canvas').count(), 1, 'loadout editing stays inside the viewer');
        await page.getByRole('dialog').getByRole('heading', { name: 'Learnable techniques', exact: true }).waitFor();
        await page.waitForFunction(() => document.activeElement?.id === 'pet-yard-section');
        assert.equal(models.size, 1, 'care, collars and alternate colors all reuse the selected model');
        report.viewports.push({ viewport, failedCareSafe: true, pet: true, feed: true, training: true,
            equipmentSaved: true, equipmentRemoved: true, pendingActionsBlocked: true, directRankedEditor: true, noOverflow: true,
            previewDoesNotMutate: true, portraitsPreserved: true, uniqueModels: models.size, drawCallsWithAura: calls });
        await page.close();
    }
    assert.deepEqual(report.errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
