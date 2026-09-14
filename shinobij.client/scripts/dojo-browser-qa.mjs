import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '../output/dojo-circuit');
await mkdir(out, { recursive: true });
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const config = resolve(root, 'scripts/vite.dojo-qa.config.mjs');
const base = 'http://127.0.0.1:5185/dojo-circuit-qa.html';
console.log('Building the focused Circuit preview.');
await new Promise((done, fail) => {
    const build = spawn(process.execPath, [vite, 'build', '--config', config, '--configLoader', 'runner'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    build.stdout.on('data', d => { log += d; }); build.stderr.on('data', d => { log += d; });
    build.on('error', fail); build.on('exit', code => code === 0 ? done() : fail(new Error(log)));
});
console.log('Circuit preview built. Launching the browser checks.');
const server = spawn(process.execPath, [vite, 'preview', '--config', config, '--configLoader', 'runner'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stderr.on('data', d => { serverLog += d; });
server.stdout.on('data', d => { serverLog += d; });
let browser;
const checks = [];
const fixture = () => { const now = Date.now(); return { enabled: true, serverNow: now, attempt: null, event: { id: 'qa-circuit', name: 'The Lantern Gathering', startsAt: now - 86400_000, endsAt: now + 6 * 86400_000, createdAt: now - 86400_000, featured: 'cards', entrants: [
    { id: 'kaito', name: 'Kaito', village: 'Stormveil Village', joinedAt: now - 800_000, seals: [{ discipline: 'combat', earnedAt: now - 500_000 }] },
    { id: 'ren', name: 'Ren', village: 'Frostfang Village', joinedAt: now - 700_000, seals: ['combat', 'cards', 'pets'].map(d => ({ discipline: d, earnedAt: now - 60_000 })) },
    { id: 'ayame', name: 'Ayame', village: 'Moonshadow Village', joinedAt: now - 600_000, seals: [{ discipline: 'cards', earnedAt: now - 100_000 }] },
    { id: 'akari', name: 'Akari', village: 'Ashen Leaf Village', joinedAt: now - 500_000, seals: [] },
], }, history: [{ id: 'prior', name: 'The First Gathering', startsAt: now - 14 * 86400_000, endsAt: now - 7 * 86400_000, participants: 12, finishers: 5, champion: 'Ren' }] }; };
try {
    for (let i = 0; i < 120; i++) { if (server.exitCode !== null) throw new Error(serverLog); try { if ((await fetch(base)).ok) break; } catch {} if (i === 119) throw new Error(`Vite did not start: ${serverLog}`); await new Promise(r => setTimeout(r, 300)); }
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 768, 390, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 980 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        page.setDefaultTimeout(90_000);
        page.setDefaultNavigationTimeout(120_000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        let state = fixture();
        let unavailable = false;
        let delayArchive = null;
        let archiveWaiting = false;
        await page.route('**/api/dojo-circuit/event**', async route => {
            if (unavailable) return route.fulfill({ status: 503, json: { error: 'The event board is temporarily unavailable.' } });
            if (route.request().method() === 'POST') {
                const body = route.request().postDataJSON();
                if (body.action === 'begin') state.attempt = { discipline: body.discipline, openedAt: Date.now(), baseline: 0 };
                if (body.action === 'join') state.event.entrants.push({ id: 'newcomer', name: 'Newcomer', village: 'Stormveil Village', joinedAt: Date.now(), seals: [] });
                if (body.action === 'check') { state.event.entrants[0].seals.push({ discipline: state.attempt.discipline, earnedAt: Date.now() }); state.attempt = null; state.message = 'Seal earned. Your victory is on the world board.'; }
                if (body.action === 'toggle') state.enabled = body.enabled;
                if (body.action === 'end') state.event.endedAt = Date.now();
                if (body.action === 'champion') state.event.championId = body.championId;
                if (body.action === 'schedule') state.event = { id: 'next-circuit', name: body.name, startsAt: body.startsAt, endsAt: body.startsAt + body.days * 86400_000, featured: body.featured, createdAt: Date.now(), entrants: [] };
            }
            if (new URL(route.request().url()).searchParams.get('eventId') === 'prior') {
                if (delayArchive) { archiveWaiting = true; await delayArchive; }
                return route.fulfill({ json: { ...state, event: { ...fixture().event, id: 'prior', name: 'The First Gathering', endedAt: Date.now() - 86400_000, championId: 'ren' }, attempt: null } }).catch(() => {});
            }
            await route.fulfill({ json: { ...state, serverNow: Date.now() } });
        });
        console.log(`Checking Circuit at ${width}px.`);
        await page.goto(base, { waitUntil: 'domcontentloaded' }); await expect(page.getByRole('heading', { name: 'Dojo Circuit', exact: true })).toBeVisible();
        await expect(page.getByText('Opening the event board…')).toHaveCount(0);
        await page.evaluate(() => Promise.all(Array.from(document.images).map(img => img.decode().catch(() => {}))));
        const audit = async label => {
            expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `${label} fits at ${width}px`).toBe(false);
            const violations = (await new AxeBuilder({ page }).include('.dojo-circuit').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
            expect(violations.map(v => ({ id: v.id, description: v.description, nodes: v.nodes.map(n => n.target) })), `${label} accessibility`).toEqual([]);
            const shortTargets = await page.locator('.dojo-circuit button:visible').evaluateAll(buttons => buttons.filter(b => b.getBoundingClientRect().height < 43).map(b => b.textContent));
            expect(shortTargets, `${label} touch target heights`).toEqual([]);
        };
        await audit('Hub');
        await page.screenshot({ path: resolve(out, `hub-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: /02.*Card Clash/s }).click();
        await expect(page.getByRole('region', { name: 'Card Clash briefing' })).toBeVisible();
        await audit('Briefing');
        await page.screenshot({ path: resolve(out, `brief-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: /Enter this trial/ }).click();
        await expect(page.locator('[data-qa-destination="shinobiTiles"]')).toBeVisible();
        await page.getByRole('button', { name: 'Return to Circuit' }).click();
        await page.getByRole('button', { name: 'Record my victory' }).click();
        await expect(page.getByRole('status')).toContainText('Seal earned');
        await page.getByRole('button', { name: /World board/ }).click();
        await expect(page.getByRole('heading', { name: 'The gathering', exact: true })).toBeVisible();
        await audit('World board');
        await page.screenshot({ path: resolve(out, `board-${width}.png`), fullPage: true });
        await page.getByRole('searchbox').fill('Ayame'); await expect(page.locator('.dc-roster').getByRole('listitem').filter({ hasText: 'Ayame' })).toHaveCount(1);
        await page.getByRole('button', { name: 'Honours & history' }).click();
        await expect(page.getByRole('heading', { name: 'Circuit finishers' })).toBeVisible();
        await page.screenshot({ path: resolve(out, `honours-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: /The First Gathering/ }).click();
        await expect(page.getByText('CIRCUIT ARCHIVE', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Ren', exact: true })).toBeVisible();
        let releaseArchive;
        delayArchive = new Promise(resolve => { releaseArchive = resolve; });
        await page.getByRole('button', { name: 'Refresh board' }).click();
        await expect.poll(() => archiveWaiting).toBe(true);
        const abortedArchive = page.waitForEvent('requestfailed', request => request.url().includes('eventId=prior'));
        await page.getByRole('button', { name: 'Current Circuit' }).click();
        await abortedArchive;
        releaseArchive(); delayArchive = null;
        await expect(page.getByText('WORLD EVENT · ALL FOUR VILLAGES', { exact: true })).toBeVisible();
        await expect(page.getByText('CIRCUIT ARCHIVE', { exact: true })).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        expect(overflow, `no horizontal overflow at ${width}`).toBe(false);
        const violations = (await new AxeBuilder({ page }).include('.dojo-circuit').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
        expect(violations.map(v => ({ id: v.id, description: v.description, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
        expect(errors).toEqual([]);
        checks.push({ width, overflow, accessibilityViolations: violations.length, pageErrors: errors.length, flow: 'brief → mode → return → seal → world board → honours' });
        for (const result of ['win', 'loss', 'draw', 'win&failed=1', 'win&pending=1']) {
            await page.goto(`${base}?result=${result}`);
            await expect(page.getByRole('dialog', { name: 'Circuit trial result' })).toBeVisible();
            if (result === 'win') await expect(page.getByRole('heading', { name: 'Courage, recorded.' })).toBeVisible();
            await audit(`Combat result ${result}`);
            if (result.includes('pending')) await expect(page.getByRole('button', { name: /Return to Circuit/ })).toBeDisabled();
            else {
                await page.keyboard.press('Tab');
                await expect(page.getByRole('button').first()).toBeFocused();
                await page.keyboard.press('Shift+Tab');
                await expect(page.getByRole('button').last()).toBeFocused();
            }
            if (result === 'win') await page.screenshot({ path: resolve(out, `combat-result-${width}.png`), fullPage: true });
        }
        for (const result of ['win', 'loss', 'draw']) {
            await page.goto(`${base}?cardresult=${result}`);
            await expect(page.getByRole('region', { name: 'Circuit card trial result' })).toBeVisible();
            await audit(`Card result ${result}`);
            if (result === 'win') await page.screenshot({ path: resolve(out, `card-result-${width}.png`), fullPage: true });
        }
        if (width === 390) {
            for (const phase of ['offline', 'upcoming', 'results', 'empty']) {
                state = fixture();
                if (phase === 'offline') state.enabled = false;
                if (phase === 'upcoming') state.event.startsAt = Date.now() + 86400_000;
                if (phase === 'results') { state.event.endedAt = Date.now(); state.event.championId = 'ren'; }
                if (phase === 'empty') state.event = null;
                await page.goto(base); await expect(page.getByText('Opening the event board…')).toHaveCount(0);
                await audit(phase);
                await page.screenshot({ path: resolve(out, `state-${phase}.png`), fullPage: true });
            }
            state = fixture(); await page.goto(`${base}?locked=1`);
            await page.getByRole('button', { name: /02.*Card Clash/s }).click();
            await expect(page.getByRole('button', { name: /Enter this trial/ })).toBeDisabled();
            await expect(page.locator('.dc-requirement')).toContainText('Ihara');
            await page.getByRole('button', { name: /03.*Companion Battle/s }).click();
            await expect(page.getByRole('button', { name: /Enter this trial/ })).toBeDisabled();
            await expect(page.locator('.dc-requirement')).toContainText('Adopt a companion');
            await page.goto(`${base}?new=1`); await page.getByRole('button', { name: /Join the Circuit/ }).click();
            await expect(page.getByRole('heading', { name: 'Newcomer', exact: true })).toBeVisible();
            for (const village of ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village']) {
                await page.goto(`${base}?notice=1&village=${encodeURIComponent(village)}`);
                await expect(page.getByRole('button', { name: /Dojo Circuit/ })).toBeVisible();
                await expect(page.getByText(/1 of 3 seals earned/)).toBeVisible();
                await page.screenshot({ path: resolve(out, `notice-${village.split(' ')[0].toLowerCase()}.png`), fullPage: true });
            }
            await page.goto(`${base}?notice=1&off=1`); await expect(page.getByRole('button', { name: /Dojo Circuit/ })).toHaveCount(0);
            unavailable = true; await page.goto(base); await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
            unavailable = false; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(page.getByRole('button', { name: /World board/ })).toBeVisible();
            state = fixture(); await page.goto(`${base}?admin=1`); await expect(page.getByRole('button', { name: 'Turn Dojo Circuit Off' })).toBeVisible();
            await page.getByRole('button', { name: 'Turn Dojo Circuit Off' }).click();
            await expect(page.getByRole('button', { name: 'Turn Dojo Circuit On' })).toBeVisible();
            await page.getByRole('button', { name: 'Turn Dojo Circuit On' }).click();
            await page.getByRole('button', { name: 'Preview player experience' }).click();
            await expect(page.getByText('ADMIN PREVIEW · No activity recorded')).toBeVisible();
            await page.screenshot({ path: resolve(out, 'admin-mobile.png'), fullPage: true });
            await page.getByRole('button', { name: 'Close player preview' }).click();
            await page.getByRole('button', { name: 'End current Circuit' }).click();
            await page.getByRole('button', { name: 'Keep it open' }).click();
            expect(state.event.endedAt).toBeUndefined();
            await page.getByRole('button', { name: 'End current Circuit' }).click();
            await page.getByRole('button', { name: 'Close Circuit now' }).click();
            await page.getByLabel('Eligible finisher').selectOption('ren');
            await page.getByRole('button', { name: 'Record champion' }).click();
            await expect(page.getByText('Champion · Ren', { exact: true })).toBeVisible();
            await page.getByLabel('Event name').fill('The Next Gathering');
            await page.getByLabel('Opening spotlight').selectOption('pets');
            await page.getByRole('button', { name: 'Schedule Circuit' }).click();
            await expect(page.locator('.dc-admin-grid strong').filter({ hasText: 'The Next Gathering' })).toBeVisible();
            expect(state.event.featured).toBe('pets');
            const adminViolations = (await new AxeBuilder({ page }).include('.dc-admin').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
            expect(adminViolations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
        }
        expect(errors).toEqual([]);
        await context.close();
    }
    await writeFile(resolve(out, 'browser-report.json'), JSON.stringify({ checks, capturedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify(checks, null, 2));
} finally { await browser?.close(); server.kill(); }
