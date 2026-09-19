import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Browser-only practice fixtures. Production handlers and official saves are untouched.
const base = 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-features-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], checks = [];
const requested = new Set(process.argv.slice(2));
const includes = name => !requested.size || requested.has(name);
const expect = baseExpect.configure({ timeout: 45000 });
let page, scenario = 'hit';
const capture = name => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
try {
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    page.setDefaultTimeout(45000);
    await page.request.post(`${base}/__qa/reset`);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 16 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    });
    await page.route('**/api/festival/rally', async route => {
        const response = await route.fetch();
        const data = await response.json();
        if (route.request().postDataJSON()?.action === 'practice' && scenario !== 'adaptive') {
            const race = data.practice;
            race.racers.forEach((racer, i) => Object.assign(racer, { rivalId: null, speed: 15, distance: i === 0 ? 40 : i === 1 ? 48 : 20 - i * 3,
                lane: i < 2 ? 0 : i === 2 ? -1 : 1, targetLane: i < 2 ? 0 : i === 2 ? -1 : 1 }));
            const player = race.racers[0], target = race.racers[1];
            player.attackCharge = 100; player.stamina = 40;
            if (scenario === 'hit' || scenario === 'blocked') { player.distance = 440; target.distance = 448; }
            if (scenario === 'blocked') target.armor = true;
            if (scenario === 'dodged') {
                target.lane = target.targetLane = 1; player.attackCharge = 0; player.shotsFired = 1;
                race.shots = [{ ownerId: player.id, element: 'Fire', distance: 46, lane: 0, remaining: 36, slowTicks: 44,
                    slowSpeed: .7, speed: 38, width: .34, targetId: target.id, targetPassed: false }];
            }
            // Resume just after takeoff to check reward presentation without
            // tying a subsecond jump window to the automation machine's load.
            if (scenario === 'jump') Object.assign(player, { distance: 72, attackCharge: 0, jump: .001, verticalSpeed: 8.518, jumpCooldown: 58 });
            if (scenario === 'shortcut') Object.assign(player, { distance: 330, speed: 19, lane: 1, targetLane: 1, burst: true, attackCharge: 0,
                jump: .001, verticalSpeed: 8.518, jumpCooldown: 58 });
            if (scenario === 'finish') {
                race.tick = 3600;
                race.racers.forEach((racer, i) => { racer.distance = 1020 - [80, 50, 100, 110][i]; });
                Object.assign(player, { cleanJumps: 2, shortcuts: 1, staminaEarned: 15, shortcutTimeGained: 1.2, attackTimeGained: .24, shotsFired: 2, shotsHit: 1 });
            }
        }
        await route.fulfill({ response, json: data });
    });
    const open = async name => {
        scenario = name;
        await page.emulateMedia({ reducedMotion: name === 'adaptive' ? 'no-preference' : 'reduce' });
        await page.goto(`${base}/sunscar-modes-qa.html`);
        await page.getByRole('button', { name: 'Visit the race grounds' }).click();
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await expect(page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ })).toBeEnabled();
    };
    const start = async () => {
        await page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ }).click();
        await expect(page.getByRole('button', { name: 'Pause race' })).toBeEnabled();
    };
    for (const name of ['hit', 'blocked', 'dodged', 'jump', 'shortcut'].filter(includes)) {
        await open(name); await start();
        if (name === 'hit' || name === 'blocked') {
            await expect(page.locator('.rally-aim-hint')).toContainText(name === 'hit' ? 'In line' : 'Guarded');
            await page.keyboard.press('KeyQ');
        }
        const kind = name === 'jump' ? 'clean-jump' : name === 'shortcut' ? 'shortcut' : `shot-${name}`;
        await expect(page.locator(`.rally-event-${kind}`)).toBeVisible();
        await capture(name);
        const player = await page.evaluate(() => window.sunscarRallyQa.state.racers[0]);
        if (name === 'hit') assert.equal(player.shotsHit, 1);
        if (name === 'blocked' || name === 'dodged') assert.equal(player.shotsHit, 0);
        if (name === 'jump') assert.equal(player.staminaEarned, 4);
        if (name === 'shortcut') assert.equal(player.staminaEarned, 7);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        checks.push(name); console.log(`Passed ${name}`);
    }
    if (includes('finish')) {
        await open('finish'); await start();
        await expect(page.locator('.is-final-stretch')).toContainText('Final stretch');
        await capture('final-stretch');
        await expect(page.locator('.rally-finish-banner')).toBeVisible();
        await capture('finish-banner');
        await expect(page.locator('.rally-results')).toBeVisible();
        await expect(page.locator('.rally-podium > div')).toHaveCount(3);
        await expect(page.locator('.rally-race-recap')).toContainText('~1.20s');
        await capture('finish-board-mobile');
        checks.push('finish board');
        console.log('Passed finish board');
    }
    let before, after;
    if (includes('adaptive')) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await open('adaptive');
        before = await page.evaluate(() => { const { state, ...metrics } = window.sunscarRallyQa; return metrics; });
        assert.equal(before.quality, 'full');
        assert.equal(before.pixelRatio, 1.5);
        await start();
        await page.waitForFunction(() => window.sunscarRallyQa.quality === 'light');
        after = await page.evaluate(() => { const { state, ...metrics } = window.sunscarRallyQa; return metrics; });
        assert.equal(after.pixelRatio, 1);
        await capture('adaptive-light-desktop');
        checks.push('adaptive graphics');
    }
    assert.deepEqual(errors, []);
    await writeFile(new URL(requested.size ? `report-${[...requested].join('-')}.json` : 'report.json', out), JSON.stringify({ errors, checks, before, after }, null, 2));
    console.log(JSON.stringify({ errors, checks, before, after }, null, 2));
} catch (error) {
    if (page) { await capture('failure'); console.error(await page.evaluate(() => JSON.stringify(window.sunscarRallyQa))); }
    throw error;
} finally { await browser.close(); }
