import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../.tmp/pet-studio-review');
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const errors = [], submitted = [];
try {
    const pages = await Promise.all(['alice', 'bob'].map(async (seat, i) => {
        const page = await browser.newPage({ viewport: i ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', request => {
            if (request.url().includes('pet-ranked-queue') && request.postDataJSON()?.action === 'join') submitted.push(request.postDataJSON());
        });
        page.setDefaultTimeout(60000);
        await page.goto(`http://127.0.0.1:4318/pet-tactics-qa.html?seat=${seat}&ranked=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.getByRole('heading', { name: /Choose your carried companions/ }).waitFor();
        assert.equal(await page.locator('.pta-roster-pet').count(), 5);
        assert.equal(await page.locator('.pta-roster-pet[aria-pressed="true"]').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Find ranked match' }).isDisabled(), true);
        await page.screenshot({ path: resolve(root, `ranked-picker-${seat}.png`), fullPage: true });
        for (let n = 0; n < 4; n++) await page.locator('.pta-roster-pet').nth(n).click();
        await page.getByRole('button', { name: 'Find ranked match' }).click();
        return page;
    }));
    for (const page of pages) await page.getByRole('heading', { name: 'Read their squad. Choose your opening.' }).waitFor({ timeout: 60000 });
    assert.equal(submitted.length, 2);
    for (const payload of submitted) assert.deepEqual(payload.builds.map(b => b.ownedPetId), ['ranked-0', 'ranked-1', 'ranked-2', 'ranked-3']);
    await pages[0].screenshot({ path: resolve(root, 'ranked-owned-preview.png'), fullPage: true });
    // End the local match so no QA reservation is left running.
    await pages[0].getByRole('button', { name: /Concede/i }).click();
    assert.deepEqual(errors, []);
    await writeFile(resolve(root, 'ranked-browser-report.json'), JSON.stringify({ carriedOptions: 5, defaultSelections: 0, selectedInstances: submitted.map(p => p.builds.map(b => b.ownedPetId)), pairedIntoPreview: true, viewports: ['desktop', 'phone'], errors }, null, 2));
    console.log('Desktop and phone pickers selected carried instances; both real handlers paired into owned-pet preview.');
} finally { await browser.close(); }
