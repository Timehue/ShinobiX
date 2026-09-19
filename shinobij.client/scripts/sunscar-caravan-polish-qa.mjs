import { chromium, webkit, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/caravan-polish-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const report = { layouts: [], errors: [], accessibility: [] };
async function measure(page, label) {
    if (await page.locator('.caravan-scene > img').count()) {
        await expect.poll(() => page.locator('.caravan-scene > img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    const layout = await page.locator('.caravan-mode').evaluate(root => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        smallTargets: [...root.querySelectorAll('button, select, summary')].filter(el => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
        }).map(el => el.textContent),
        undersizedInputs: [...root.querySelectorAll('select')].filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).length,
    }));
    report.layouts.push({ label, ...layout });
    assert.equal(layout.overflow, false, `${label}: horizontal page overflow`);
    assert.deepEqual(layout.smallTargets, [], `${label}: 44px touch targets`);
    if (!label.includes('1440')) assert.equal(layout.undersizedInputs, 0, 'Mobile inputs do not trigger iOS text zoom');
    await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, out)) });
}
try {
    for (const [browserName, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await browserType.launch({ headless: true });
        try {
            for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024], [1440, 900]]) {
                const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: width < 1000, reducedMotion: 'reduce' });
                const page = await context.newPage();
                page.setDefaultTimeout(20000);
                page.on('pageerror', error => report.errors.push({ browserName, width, message: error.message }));
                const requests = [];
                page.on('request', request => requests.push(request.url()));
                const label = `${browserName}-${width}x${height}`;
                await page.request.post(`${base}/__qa/reset`);
                await page.goto(`${base}/sunscar-modes-qa.html`);
                await page.getByRole('button', { name: 'Read today’s contracts' }).click();
                await expect(page.getByRole('button', { name: 'Accept contract & depart' })).toBeEnabled();
                await expect(page.getByRole('heading', { name: 'The border supply line', exact: true }).first()).toBeVisible();
                await measure(page, `${label}-contracts`);
                await page.getByRole('button', { name: 'Accept contract & depart' }).tap();
                await expect(page.getByRole('heading', { name: 'Choose the next road' })).toBeVisible();
                await measure(page, `${label}-decision`);
                if (width < 1000) {
                    await expect(page.locator('.caravan-chart')).toBeHidden();
                    const top = await page.locator('.caravan-view-switch').evaluate(el => el.getBoundingClientRect().top);
                    assert.ok(top >= 0 && top < height / 2, 'Departure brings the decision into view');
                    await page.getByRole('button', { name: 'Route map', exact: true }).tap();
                }
                await expect.poll(() => page.locator('.caravan-map-scroll').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
                await measure(page, `${label}-map`);
                await page.getByRole('button', { name: 'Zoom map in' }).tap();
                await page.getByRole('button', { name: 'Zoom map out' }).tap();
                await expect(page.getByRole('button', { name: 'Zoom map out' })).toBeDisabled();
                await page.locator('.caravan-map-node.is-available').first().tap();
                await expect(page.locator('.caravan-next-stop')).toBeFocused();
                await expect(page.locator('.caravan-travel-cost')).toContainText('1 supply to travel');
                await expect(page.getByRole('button', { name: 'Travel to this stop', exact: true })).toBeInViewport();
                if (width === 390) {
                    await page.getByRole('button', { name: 'Route map', exact: true }).tap();
                    await page.locator('.caravan-map-node.is-selected').focus();
                    await page.keyboard.press('Enter');
                    await expect(page.locator('.caravan-next-stop')).toBeFocused();
                    await expect(page.getByRole('button', { name: 'Travel to this stop', exact: true })).toBeInViewport();
                }
                await page.getByRole('button', { name: 'Other roads' }).tap();
                await page.locator('.caravan-route-options button').first().tap();
                await measure(page, `${label}-inspection`);
                assert.ok(!requests.some(url => /\/CaravanBattle-|sunscar-queen/.test(url)), 'Battle module and boss art stay deferred during travel');
                const sceneArt = [...new Set(requests.filter(url => /\/sunscar-shinobi-.*\.webp/.test(url)))];
                assert.equal(sceneArt.length, 1, 'Only the current region artwork loads');
                assert.match(sceneArt[0], /sunscar-shinobi-dunes/);
                if (width === 390) {
                    const audit = await new AxeBuilder({ page }).include('.caravan-mode').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
                    report.accessibility.push({ label, violations: audit.violations });
                    assert.deepEqual(audit.violations, [], 'Automated accessibility checks');
                    // An interrupted response must remain retryable with its original ID.
                    let travelRequests = 0;
                    await page.route('**/api/festival/caravan', async route => {
                        if (route.request().postDataJSON()?.action === 'travel') {
                            travelRequests++;
                            if (travelRequests === 1) { await route.fetch(); await route.abort(); return; }
                        }
                        await route.continue();
                    });
                    await page.getByRole('button', { name: 'Travel to this stop', exact: true }).tap();
                    await expect(page.getByRole('button', { name: 'Retry this choice' })).toBeInViewport();
                    await expect(page.getByRole('alert')).toBeFocused();
                    await page.getByRole('button', { name: 'Retry this choice' }).tap();
                    await expect(page.locator('.caravan-choices')).toBeVisible();
                    assert.equal(travelRequests, 2, 'Retry is the only additional travel request');
                    await measure(page, `${label}-encounter`);
                }
                await context.close();
            }
        } finally { await browser.close(); }
    }
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ layouts: report.layouts.length, accessibility: report.accessibility.length, errors: report.errors }));
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
}
