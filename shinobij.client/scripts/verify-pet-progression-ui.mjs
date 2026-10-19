import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'test-results', 'pet-progression-review');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' });
let browser;
try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch();
    const results = [];
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${port}/pet-progression-qa.html`);
        await page.getByRole('heading', { name: 'Ability progression' }).waitFor();
        let saved = await page.locator('#saved-loadout').textContent();
        assert.match(await page.getByRole('region', { name: 'Companion ability progression' }).textContent(), /Saved for later/);
        assert.match(await page.locator('.pet-technique-signature h4').textContent(), /unlocks at level 20/);
        assert.equal(await page.locator('.pet-progression-milestones > li[data-earned=true]').count(), 1);
        await page.getByRole('checkbox', { name: 'Equip Water Pulse', exact: true }).uncheck();
        await page.getByRole('checkbox', { name: 'Equip Mend', exact: true }).check();
        await page.getByRole('button', { name: 'Save loadout', exact: true }).click();
        await page.getByRole('button', { name: 'Loadout saved', exact: true }).waitFor();
        const changed = await page.locator('#saved-loadout').textContent();
        assert.notEqual(changed, saved, 'saving a locked preference changes the saved choice');
        assert.ok(JSON.parse(changed).moveIds.includes('mend'));
        assert.match(await page.locator('.pet-progression-active').textContent(), /Water Strike/);
        saved = changed;
        await page.screenshot({ path: path.join(output, `${name}-level-1.png`), fullPage: true });
        const boundaries = [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100];
        for (const level of boundaries) {
            await page.getByLabel('Preview level').selectOption(String(level));
            assert.equal(await page.locator('.pet-progression-milestones > li[data-earned=true]').count(), [1, 5, 10, 20, 30, 50, 75].filter(milestone => level >= milestone).length);
            assert.equal(await page.locator('#saved-loadout').textContent(), saved);
            const active = await page.locator('.pet-progression-active').textContent();
            assert.equal(active.includes('Ripple Seal: Renewal'), level >= 20);
        }
        await page.getByLabel('Preview level').selectOption('75');
        assert.equal(await page.locator('.pet-progression-milestones > li[data-earned=true]').count(), 7);
        assert.match(await page.locator('.pet-progression-active').textContent(), /Signature mastery/);
        assert.equal(await page.locator('#saved-loadout').textContent(), saved, 'previewing earned levels must preserve saved preferences');
        await page.getByText('Progression update & battle rules', { exact: true }).click();
        await page.screenshot({ path: path.join(output, `${name}-level-75.png`), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal page overflow');
        const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.length })), []);
        assert.deepEqual(errors, []);
        results.push({ viewport: name, boundaries, lockedPreferenceSaved: true, savedPreferencesPreserved: true, horizontalOverflow: false, accessibilityViolations: accessibility.violations.length, pageErrors: errors.length });
        await context.close();
    }
    const report = { passed: true, results, screenshots: output };
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await server.close(); }
