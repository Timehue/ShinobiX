import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:5199', out = new URL('../../.tmp/sunscar-combat-flow-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], checks = [];
let page;
const shot = name => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', e => errors.push(e.message));
    const session = await page.request.get(base + '/__qa/session').then(r => r.json());
    const headers = { 'x-player-name': session.name, 'x-player-token': session.token };
    const saved = () => page.request.get(base + '/api/festival/caravan?playerName=' + session.name, { headers }).then(r => r.json());
    for (const scenario of ['victory', 'defeat']) {
        await page.request.post(base + '/__qa/reset');
        await page.goto(base + '/sunscar-modes-qa.html');
        await page.getByRole('button', { name: 'Read today’s contracts' }).click();
        await page.getByRole('button', { name: 'Accept contract & depart' }).click();
        await page.getByRole('heading', { name: 'Choose the next road' }).waitFor();
        await page.request.post(base + '/__qa/encounter', { data: { eventId: 'scorpion-den' } });
        await page.reload(); await page.getByRole('button', { name: 'Rejoin your caravan' }).click();
        await page.getByRole('button', { name: /^Hold the ruins entrance/ }).click();
        await page.getByRole('button', { name: 'Enter battle' }).click();
        await page.getByRole('button', { name: /^Flee/ }).waitFor();
        await page.waitForFunction(() => [...document.images].some(i => i.src.includes('sunscar-queen-body') && i.complete && i.naturalWidth > 0));
        await shot('queen-' + scenario);
        const fixture = await page.request.post(base + '/__qa/combat-fixture', { data: { scenario } });
        assert.equal(fixture.status(), 200);
        await page.reload(); await page.getByRole('button', { name: 'Rejoin your caravan' }).click();
        await page.getByRole('button', { name: 'Enter battle' }).click();
        await page.getByRole('button', { name: /^Flee/ }).waitFor();
        if (scenario === 'victory') await page.getByRole('button', { name: /^Attack/ }).click();
        else {
            for (let turn = 0; turn < 12 && !await page.getByRole('button', { name: 'Return to the caravan' }).count(); turn++) {
                const wait = page.getByRole('button', { name: /^Wait/ });
                if (await wait.isEnabled()) await wait.click();
                await page.waitForTimeout(800);
            }
        }
        await page.getByRole('button', { name: 'Return to the caravan' }).click();
        const result = await saved();
        assert.equal(result.progress.current.status, scenario === 'victory' ? 'travel' : 'failed');
        if (scenario === 'victory') assert.equal(result.progress.current.enemiesDefeated, 1);
        else assert.equal(result.progress.current.result.ryo, 0);
        await shot(scenario + '-return');
        await page.reload(); await page.getByRole('button', { name: scenario === 'victory' ? 'Rejoin your caravan' : 'Read today’s contracts' }).click();
        const again = await saved();
        assert.equal(again.progress.current.status, result.progress.current.status);
        assert.equal(again.character.ryo, result.character.ryo);
        checks.push('Scorpion Queen ' + scenario + ' through the real combat UI, return and reload');
    }
    assert.deepEqual(errors, []);
} catch (error) { if (page) await shot('failure'); throw error; }
finally { await writeFile(new URL('report.json', out), JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
console.log(JSON.stringify({ checks, errors }));
