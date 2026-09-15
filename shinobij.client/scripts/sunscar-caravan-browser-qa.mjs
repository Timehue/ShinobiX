import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { caravanEvent } from '../../shared/sunscar/caravan-events.ts';
import { caravanChoiceBlock } from '../../shared/sunscar/caravan-state.ts';
const base = 'http://127.0.0.1:5199', out = new URL('../../.tmp/sunscar-caravan-flow-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], checks = [], receipts = [];
let page;
const shot = name => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)), fullPage: true });
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    page = await context.newPage(); page.setDefaultTimeout(25_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.request.post(base + '/__qa/reset');
    const session = await page.request.get(base + '/__qa/session').then(r => r.json());
    const headers = { 'x-player-name': session.name, 'x-player-token': session.token };
    const saved = () => page.request.get(base + '/api/festival/caravan?playerName=' + session.name, { headers }).then(r => r.json());
    await page.goto(base + '/sunscar-modes-qa.html');
    await page.getByRole('button', { name: 'Read today’s contracts' }).click();
    await page.getByRole('button', { name: 'Accept contract & depart' }).click();
    await page.getByRole('heading', { name: 'Choose the next road' }).waitFor();
    let dropped = false;
    await page.route('**/api/festival/caravan', async route => {
        if (!dropped && route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'choose') {
            dropped = true; await route.fetch(); await route.abort();
        } else await route.continue();
    });
    for (let step = 0; step < 30; step++) {
        const data = await saved(), run = data.progress.current;
        if (run.result) { receipts.push(run.result); break; }
        assert.notEqual(run.status, 'combat', 'The standard contract has a navigable non-combat route.');
        if (run.status === 'travel') {
            const safePath = node => !['combat', 'elite', 'boss'].includes(node.kind) && (node.kind === 'destination' || node.next.some(id => safePath(run.map.find(n => n.id === id))));
            const nodes = run.available.map(id => run.map.find(n => n.id === id)).filter(safePath);
            const rank = { destination: 0, camp: 1, merchant: 2, traveler: 3, event: 4, hazard: 5, rare: 6, combat: 8, elite: 9 };
            const next = nodes.sort((a, b) => (rank[a.kind] ?? 7) - (rank[b.kind] ?? 7))[0];
            await page.locator('.caravan-route-options button').nth(run.available.indexOf(next.id)).click();
            await page.getByRole('button', { name: next.kind === 'destination' ? 'Deliver the cargo' : 'Travel to this stop', exact: true }).click();
        } else {
            const event = caravanEvent(run.map.find(n => n.id === run.currentNodeId).eventId);
            const choices = event.choices.filter(c => !c.effect.combat && !c.effect.petTrail && !caravanChoiceBlock(run, c, data.character.ryo));
            const choice = choices.sort((a, b) => ((b.effect.cargo ?? 0) + (b.effect.supplies ?? 0) * 3) - ((a.effect.cargo ?? 0) + (a.effect.supplies ?? 0) * 3))[0];
            assert.ok(choice, event.id);
            await page.locator('.caravan-choices button').filter({ has: page.getByText(choice.label, { exact: true }) }).click();
            if (dropped && !checks.includes('lost choice response safely retried')) {
                await page.getByRole('button', { name: 'Retry this choice' }).click();
                checks.push('lost choice response safely retried');
                await page.unroute('**/api/festival/caravan');
            }
        }
        await page.waitForFunction(() => document.querySelector('.caravan-choices button:not(:disabled)') || !document.querySelector('.caravan-choices'));
        await page.waitForTimeout(250);
        if (step === 5) {
            await shot('journey-mobile'); await page.reload();
            await page.getByRole('button', { name: 'Rejoin your caravan' }).click();
            await page.locator('.caravan-manifest').waitFor(); checks.push('journey reload resumes');
        }
    }
    const complete = await saved(); assert.equal(complete.progress.current.status, 'complete'); assert.equal(complete.progress.deliveries, 1);
    await shot('delivery-mobile'); checks.push('all nine legs delivered with authoritative reward');
    await page.request.post(base + '/__qa/reset'); await page.reload();
    await page.getByRole('button', { name: 'Read today’s contracts' }).click();
    await page.getByRole('button', { name: 'Accept contract & depart' }).click();
    await page.getByRole('heading', { name: 'Choose the next road' }).waitFor();
    await page.request.post(base + '/__qa/encounter', { data: { eventId: 'raider-toll' } });
    await page.reload(); await page.getByRole('button', { name: 'Rejoin your caravan' }).click();
    await page.getByRole('button', { name: /^Hold the line/ }).click();
    await page.getByRole('button', { name: 'Enter battle' }).click();
    await page.getByRole('button', { name: /Flee/ }).waitFor({ timeout: 60_000 });
    await shot('main-combat-mobile'); checks.push('actual combat screen renders on mobile');
    await page.request.post(base + '/__qa/reset'); await page.reload();
    await page.getByRole('button', { name: 'Read today’s contracts' }).click();
    await page.getByRole('button', { name: 'Accept contract & depart' }).click();
    await page.getByRole('heading', { name: 'Choose the next road' }).waitFor();
    await page.request.post(base + '/__qa/encounter', { data: { eventId: 'sheltered-well', supplies: 29 } });
    await page.reload(); await page.getByRole('button', { name: 'Rejoin your caravan' }).click();
    const refill = page.locator('.caravan-choices button').filter({ has: page.getByText('Refill the water skins', { exact: true }) });
    await refill.getByText('Only 1 of 4 extra supplies fit (30 maximum).').waitFor();
    await shot('supply-cap-choice-mobile');
    await refill.click();
    await page.locator('.caravan-scene-copy').getByText('Only 1 of 4 extra supplies fit in the wagons (30 maximum).').waitFor();
    const capped = (await saved()).progress.current;
    assert.equal(capped.supplies, 30);
    assert.match(capped.log.at(-1).text, /Only 1 of 4 extra supplies fit in the wagons \(30 maximum\)\./);
    checks.push('supply-cap warning matches accepted supplies and saved journal');
    console.log(JSON.stringify({ checks, errors, receipts })); assert.deepEqual(errors, []);
} catch (error) { if (page) await shot('failure'); throw error; }
finally { await writeFile(new URL('report.json', out), JSON.stringify({ checks, errors, receipts }, null, 2)); await browser.close(); }
