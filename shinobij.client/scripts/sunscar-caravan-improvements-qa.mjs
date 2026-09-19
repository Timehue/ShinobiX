import { chromium, webkit, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { caravanRewardPreview } from '../../shared/sunscar/caravan-state.ts';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const output = new URL('../../.tmp/caravan-improvements-qa/', import.meta.url);
await mkdir(output, { recursive: true });
const report = { checks: [], errors: [], accessibility: [] };
try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
        // Resetting disposable saves does not reset the server's in-process
        // request limiter. Give the next engine its own normal request window.
        if (name === 'webkit') await new Promise(resolve => setTimeout(resolve, 60_000));
        const browser = await engine.launch({ headless: true });
        let page;
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            page = await context.newPage();
            page.setDefaultTimeout(25000);
            page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
            const session = await page.request.get(`${base}/__qa/session`).then(r => r.json());
            const headers = { 'x-player-name': session.name, 'x-player-token': session.token };
            const saved = () => page.request.get(`${base}/api/festival/caravan?playerName=${session.name}`, { headers }).then(r => r.json());
            const choice = label => page.locator('.caravan-choices button').filter({ has: page.getByText(label, { exact: true }) });
            async function rejoin() { await page.reload(); await page.getByRole('button', { name: 'Rejoin your caravan' }).click(); await expect(page.locator('.caravan-mission-status')).toBeVisible(); await expect(page.locator('.caravan-encounter')).toBeFocused(); }
            async function fixture(data) { const response = await page.request.post(`${base}/__qa/encounter`, { data }); assert.ok(response.ok()); await rejoin(); }
            async function start() {
                await page.request.post(`${base}/__qa/reset`); await page.goto(`${base}/sunscar-modes-qa.html`);
                await page.getByRole('button', { name: 'Read today’s contracts' }).click();
                await expect(page.locator('.caravan-base-pay')).toContainText('3,675 Ryo base pay');
                await page.getByRole('button', { name: 'Accept contract & depart' }).click();
                await expect(page.getByRole('heading', { name: 'Choose the next road' })).toBeVisible();
            }
            async function checkPayout() {
                const { progress } = await saved(), preview = caravanRewardPreview(progress.current);
                await expect(page.locator('.caravan-payout-preview strong')).toHaveText(`${preview.ryo.toLocaleString()} Ryo`);
            }
            async function capture(label) {
                await page.locator('.caravan-encounter').scrollIntoViewIfNeeded();
                const layout = await page.locator('.caravan-mode').evaluate(root => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
                    tiny: [...root.querySelectorAll('button, select')].some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }) }));
                assert.deepEqual(layout, { overflow: false, tiny: false });
                await page.screenshot({ path: fileURLToPath(new URL(`${name}-${label}.png`, output)), fullPage: true });
            }

            await start(); await checkPayout();
            await fixture({ eventId: 'glass-sand', stamina: 0, supplies: 0 });
            await expect(choice('Walk the cargo across')).toBeDisabled();
            await expect(choice('Walk the cargo across')).toContainText('Requires 10 stamina');
            const before = await saved();
            const forged = await page.request.post(`${base}/api/festival/caravan`, { headers, data: { playerName: session.name, action: 'choose', runId: before.progress.current.id, version: before.progress.current.version, requestId: `forged-stamina-${name}`, choiceId: 'walk', stamina: 100, character: { stamina: 100 } } });
            assert.equal(forged.status(), 400);
            assert.equal((await saved()).progress.current.version, before.progress.current.version);
            await capture('exhausted-choice');
            await choice('Keep the wheels moving').tap();
            await expect(page.locator('.caravan-feedback')).toContainText('−12% cargo');
            await checkPayout(); await rejoin();
            await expect(page.locator('.caravan-feedback')).toContainText('−12% cargo');
            report.checks.push(`${name}: exhausted choices rejected on server; fallback and saved feedback work`);

            await fixture({ eventId: 'shifting-marker', chakra: 7 });
            await expect(choice('Test the false route with a scout clone')).toBeDisabled();
            await fixture({ eventId: 'shifting-marker', chakra: 8 });
            await choice('Test the false route with a scout clone').tap();
            await expect(page.locator('.caravan-feedback')).toContainText('−8 chakra');
            assert.equal((await saved()).progress.current.log.at(-1).changes.chakra, -8);
            await fixture({ eventId: 'camp-high-ground', chakra: 100 });
            await expect(choice('Send a scout clone over the ridge')).toBeDisabled();
            await expect(choice('Send a scout clone over the ridge')).toContainText('already been used');
            report.checks.push(`${name}: clone uses saved chakra and cannot be reused at another encounter`);

            await fixture({ eventId: 'sand-wall', cargo: 96, chakra: 12 });
            await choice('Reinforce the cargo seals with chakra').tap();
            await expect(page.locator('.caravan-feedback')).toContainText('+4% cargo');
            await expect(page.locator('.caravan-feedback')).toContainText('−12 chakra');
            await checkPayout(); await capture('seal-feedback');
            report.checks.push(`${name}: seal feedback reflects actual capped cargo gain`);

            await fixture({ eventId: 'raider-toll' });
            await expect(choice('Follow your Tracker around the ambush')).toBeDisabled();
            await fixture({ eventId: 'raider-toll', tracker: true });
            await choice('Follow your Tracker around the ambush').tap();
            await expect(page.getByRole('heading', { name: 'Choose the next road' })).toBeVisible();
            const tracked = await saved();
            assert.equal(tracked.progress.current.status, 'travel');
            assert.equal(tracked.progress.current.tools.feed, 0);
            await expect(page.locator('.caravan-feedback')).toContainText('−1 pet feed');
            report.checks.push(`${name}: selected Tracker and feed unlock a real ambush bypass`);

            await start();
            await fixture({ eventId: 'lost-apprentice', contractId: 'medical-relief' });
            await page.getByRole('button', { name: 'Route map', exact: true }).tap();
            await expect(page.locator('.caravan-map-objective').first()).toBeVisible();
            await fixture({ eventId: 'lost-apprentice', supplies: 17 });
            await expect(page.locator('.caravan-objective-progress')).toContainText('0 / 2');
            await choice('Take her to the next marker').tap();
            await expect(page.locator('.caravan-objective-progress')).toContainText('1 / 2');
            await expect(page.locator('.caravan-feedback')).toContainText('+1 traveler helped');
            await expect(page.locator('.caravan-objective-bonus')).toContainText('not yet earned');
            await fixture({ eventId: 'village-pilgrims' });
            await choice('Give them a water skin').tap();
            await expect(page.locator('.caravan-objective-progress')).toContainText('2 / 2');
            await expect(page.locator('.caravan-objective-bonus')).toContainText('(included)');
            await checkPayout(); await capture('objective-complete');
            const audit = await new AxeBuilder({ page }).include('.caravan-mode').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            report.accessibility.push({ name, violations: audit.violations }); assert.deepEqual(audit.violations, []);
            report.checks.push(`${name}: objective progress, route markers, and payout update together; accessibility passes`);
            await context.close();
        } catch (error) {
            if (page) {
                await page.screenshot({ path: fileURLToPath(new URL(`${name}-failure.png`, output)), fullPage: true });
                await writeFile(new URL(`${name}-failure.txt`, output), await page.locator('body').innerText());
            }
            throw error;
        } finally { await browser.close(); }
    }
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report));
} finally { await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2)); }
