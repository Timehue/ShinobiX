import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:5199', out = new URL('../../.tmp/sunscar-flow-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], performance = [], checks = [];
const shot = async (page, name) => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)), fullPage: true });
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    const page = await context.newPage(); page.setDefaultTimeout(25_000);
    page.on('pageerror', e => errors.push(e.message));
    await page.request.post(base + '/__qa/reset');
    const session = await page.request.get(base + '/__qa/session').then(r => r.json());
    const headers = { 'x-player-name': session.name, 'x-player-token': session.token };
    const saved = async () => page.request.get(base + '/api/festival/rally?playerName=' + session.name, { headers }).then(r => r.json());
    await page.goto(base + '/sunscar-modes-qa.html');
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Prepare Grand Prix' }).click();
    await page.getByRole('button', { name: 'Ready to race' }).click({ timeout: 90_000 });
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 30);
    await shot(page, 'official-mobile');
    for (const button of await page.locator('.rally-controls button').all()) {
        const bounds = await button.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Mobile controls stay on screen'); assert.ok(bounds.height >= 44);
    }
    // Touch input is genuine DOM pointer input, not a race-state mutation.
    await page.getByRole('button', { name: 'Steer left, A or Left Arrow' }).tap();
    await page.getByRole('button', { name: 'Jump, Space' }).tap();
    await page.waitForTimeout(8000);
    const checkpoint = await saved(); assert.ok(checkpoint.progress.current.race.tick >= 300);
    let dropped = false;
    await page.route('**/api/festival/rally', async route => {
        if (!dropped && route.request().postDataJSON()?.action === 'checkpoint') { dropped = true; await route.fetch(); await route.abort(); }
        else await route.continue();
    });
    await page.getByRole('button', { name: 'Retry connection', exact: true }).waitFor({ timeout: 30_000 });
    await shot(page, 'checkpoint-retry-mobile');
    await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.unroute('**/api/festival/rally');
    await page.reload();
    await page.getByRole('button', { name: 'Resume Grand Prix' }).click();
    await page.getByRole('button', { name: 'Resume Grand Prix' }).click();
    await page.getByRole('button', { name: 'Resume from checkpoint' }).click({ timeout: 90_000 });
    checks.push('official entry survives a lost checkpoint acknowledgement and reload');
    // Play all three full races. Scripted button presses exercise normal input,
    // local simulation and server checkpoints; no client result is injected.
    for (let race = 0; race < 3; race++) {
        const deadline = Date.now() + 240_000;
        while (!await page.locator('.rally-results').count()) {
            if (Date.now() > deadline) throw new Error('Race did not finish within four minutes');
            const debug = await page.evaluate(() => window.sunscarRallyQa);
            if (debug) {
                if (debug.state.tick > 400 && !performance.some(p => p.race === race)) performance.push({ race, fps: debug.fps, calls: debug.calls, triangles: debug.triangles, textures: debug.textures, geometry: debug.geometry });
                const p = debug.state.racers[0];
                if (!p.techniqueUsed && debug.state.tick > 1000) await page.keyboard.press('KeyE');
                if (p.stamina > 90) await page.keyboard.down('Shift');
                if (p.stamina < 15) await page.keyboard.up('Shift');
            }
            await page.waitForTimeout(600);
        }
        await page.keyboard.up('Shift');
        await shot(page, 'grand-prix-result-' + race);
        checks.push('verified race ' + (race + 1));
        if (race < 2) { await page.getByRole('button', { name: /Next race/ }).click(); await page.getByRole('button', { name: 'Ready to race' }).click(); }
    }
    const completed = await saved(); assert.equal(completed.progress.current.status, 'complete'); assert.equal(completed.progress.championships, 1); assert.equal(completed.progress.current.results.length, 3);
    await page.getByRole('button', { name: 'Return to the race desk' }).click();
    assert.ok(await page.getByRole('button', { name: 'Return tomorrow' }).isDisabled());
    await page.reload();
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'View finish board' }).click();
    await page.locator('caption').filter({ hasText: 'Grand Prix standings · 3/3 races' }).waitFor();
    assert.equal((await saved()).progress.championships, 1);
    await shot(page, 'saved-finish-board');
    checks.push('completed championship and standings survive reload without another reward');
    await page.getByRole('button', { name: /Festival$/ }).click();
    await page.getByRole('button', { name: 'Read today’s contracts' }).click();
    await page.getByRole('button', { name: 'Accept contract & depart' }).click();
    await page.getByRole('heading', { name: 'Choose the next road' }).waitFor();
    await page.request.post(base + '/__qa/encounter', { data: { eventId: 'raider-toll' } });
    await page.reload(); await page.getByRole('button', { name: 'Rejoin your caravan' }).click();
    await page.getByRole('button', { name: /^Hold the line/ }).click();
    await page.getByRole('button', { name: 'Enter battle' }).click();
    await page.getByRole('button', { name: /Flee/ }).waitFor({ timeout: 60_000 });
    await shot(page, 'caravan-main-combat-mobile');
    checks.push('Caravan renders the unchanged main combat controls on mobile');
    await writeFile(new URL('report.json', out), JSON.stringify({ errors, performance, checks, completed }, null, 2));
    assert.deepEqual(errors, []); console.log(JSON.stringify({ errors, performance, checks }));
} finally { await browser.close(); }
