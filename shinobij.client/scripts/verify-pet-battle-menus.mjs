import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.PET_TACTICS_QA_URL ?? 'http://127.0.0.1:4318';
const out = resolve(import.meta.dirname, '../../docs/audits/pet-battle-unification');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const dungeonOnly = process.argv.includes('--dungeon-only');
const report = dungeonOnly ? JSON.parse(await readFile(resolve(out, 'browser-report.json'), 'utf8'))
    : { errors: [], badResponses: [], native: [], beastfront: [], gauntlet: [] };
if (dungeonOnly) report.native = report.native.filter(fixture => !fixture.dungeon);
const state = page => page.locator('#native-state').textContent().then(JSON.parse);
async function open(url, viewport) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.setDefaultTimeout(70000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) report.badResponses.push({ url: response.url(), status: response.status() }); });
    await page.goto(base + url, { waitUntil: 'networkidle', timeout: 90000 });
    return page;
}
async function order(page, resolveTarget = true) {
    const available = page.locator('.pet-native-console .showdown-tech-pill:not([aria-disabled="true"])');
    const signature = available.and(page.locator('.signature'));
    const damaging = available.filter({ hasText: /damage/i });
    const move = !await available.count() ? page.locator('.pet-native-actions .showdown-stance-chip:not([aria-disabled="true"])').first()
        : !resolveTarget ? available.first() : await signature.count() ? signature.first() : await damaging.count() ? damaging.last() : available.first();
    await move.scrollIntoViewIfNeeded(); await move.click();
    const targets = page.locator('.pet-native-targets button');
    if (resolveTarget && await targets.count()) { await targets.first().scrollIntoViewIfNeeded(); await targets.first().click(); }
}
try {
    for (const fixture of [
        { name: 'native-2v2-desktop', format: '2v2', viewport: { width: 1440, height: 960 } },
        { name: 'native-2v2-mobile', format: '2v2', viewport: { width: 390, height: 844 } },
        { name: 'native-3v3-mobile', format: '3v3', viewport: { width: 390, height: 844 } },
        { name: 'native-1v1-desktop', format: '1v1', viewport: { width: 1440, height: 960 } },
        { name: 'native-3v3-landscape', format: '3v3', viewport: { width: 844, height: 390 } },
        { name: 'dungeon-command-desktop', format: '1v1', dungeon: 'desktop', viewport: { width: 1440, height: 960 } },
        { name: 'dungeon-command-mobile', format: '1v1', dungeon: 'mobile', viewport: { width: 390, height: 844 } },
    ].filter(fixture => !dungeonOnly || fixture.dungeon)) {
        const page = await open(`/pet-battle-qa.html?format=${fixture.format}${fixture.dungeon ? `&dungeon=${fixture.dungeon}` : ''}`, fixture.viewport);
        await page.locator('.pet-native-console').waitFor();
        await page.locator('.showdown-vs-intro').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => Math.abs(document.querySelector('.pet-native-console').getBoundingClientRect().top - document.querySelector('.showdown-scene-viewport').getBoundingClientRect().bottom) <= 2);
        const geometry = await page.evaluate(() => {
            const menu = document.querySelector('.pet-native-console').getBoundingClientRect();
            const arena = document.querySelector('.showdown-scene-viewport').getBoundingClientRect();
            const buttons = [...document.querySelectorAll('.pet-native-console .showdown-tech-pill')].map(button => button.getBoundingClientRect().height);
            return { menuTop: menu.top, arenaBottom: arena.bottom, arenaHeight: arena.height, duplicateFriendlyHud: !!document.querySelector('.showdown-playerbar'), overflow: document.documentElement.scrollWidth > innerWidth + 2, buttons, background: getComputedStyle(document.querySelector('.pet-native-console')).backgroundImage };
        });
        assert.ok(Math.abs(geometry.menuTop - geometry.arenaBottom) <= 2, JSON.stringify(geometry));
        assert.ok(geometry.arenaHeight > 120 && !geometry.duplicateFriendlyHud && !geometry.overflow);
        assert.ok(geometry.buttons.every(height => height >= 44));
        assert.match(geometry.background, /command-ink-v2/);
        assert.equal(await page.locator('.pet-native-team [role="progressbar"]').count(), Number(fixture.format[0]) * 2);
        await page.screenshot({ path: resolve(out, `${fixture.name}.png`), fullPage: true });
        const first = page.locator('.showdown-tech-pill').first();
        await first.focus(); await page.keyboard.press('ArrowRight');
        assert.ok(await page.locator('.showdown-tech-pill').nth(1).evaluate(button => button === document.activeElement));
        const before = await state(page);
        assert.equal(await page.getByText('Choose the Fight Plan', { exact: true }).count(), 0);
        if (fixture.dungeon) assert.equal(before.enemy[0].name, 'Sealed Rare Beast');
        if (fixture.format !== '1v1') {
            await order(page);
            await page.getByRole('button', { name: 'Undo last order' }).click();
            assert.ok((await page.locator('.pet-native-prompt').textContent()).includes(before.player[0].name));
        }
        for (let index = 0; index < Number(fixture.format[0]); index++) await order(page);
        await page.waitForFunction(round => JSON.parse(document.querySelector('#native-state').textContent).round > round, before.round);
        await page.locator('.pet-native-console').waitFor();
        const after = await state(page);
        for (const pet of after.player.filter(pet => !pet.benched)) {
            const hp = page.locator('.pet-native-team').getByRole('progressbar', { name: `${pet.name} HP`, exact: true });
            if (await hp.count()) assert.equal(Number(await hp.getAttribute('aria-valuenow')), pet.hp);
        }
        if (fixture.format === '2v2') {
            await order(page, false);
            await page.locator('.pet-native-targets').waitFor();
            await page.screenshot({ path: resolve(out, `${fixture.name}-targeting.png`), fullPage: true });
            assert.ok(await page.locator('.pet-native-targets button').first().evaluate(button => button.getBoundingClientRect().height >= 44));
            await page.getByRole('button', { name: 'Back', exact: true }).click();
        }
        report.native.push({ ...fixture, geometry, roundResolved: after.round, keyboard: true, resources: true });
        await page.close();
        console.log(`Verified ${fixture.name}`);
    }
    for (const viewport of dungeonOnly ? [] : [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
        const page = await open('/petvfx.html?rite=1&riteqa=1&petQuality=low&ritespeed=8', viewport);
        await page.locator('.wfr-root.pet-battle-theme').waitFor();
        await page.getByRole('button', { name: /Lock formation/i }).waitFor();
        await page.screenshot({ path: resolve(out, `beastfront-formation-${viewport.width}.png`), fullPage: true });
        report.beastfront.push({ viewport, formation: true, theme: true });
        await page.close();
        const board = await open('/gauntlet-qa.html?petQuality=low', viewport);
        await board.getByRole('button', { name: 'Mount', exact: true }).click();
        await board.locator('.gauntlet-board-takeover.pet-battle-theme').waitFor();
        await board.locator('[data-loading="false"]').waitFor();
        await board.getByRole('button', { name: 'Unmount', exact: true }).evaluate(button => { button.parentElement.style.display = 'none'; });
        await board.screenshot({ path: resolve(out, `gauntlet-battle-${viewport.width}.png`), fullPage: true });
        report.gauntlet.push({ viewport, renderer: true, theme: true });
        await board.close();
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.badResponses, []);
    await writeFile(resolve(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: resolve(out, 'menu-failure.png'), fullPage: true }).catch(() => undefined);
    throw error;
} finally { await browser.close(); }
