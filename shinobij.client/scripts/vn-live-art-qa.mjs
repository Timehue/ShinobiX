import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const cases = JSON.parse(await readFile('../docs/art-audit/live-art-browser-cases.json', 'utf8'));
const output = path.resolve('../tmp/vn-art-recheck/verified');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = process.argv.includes('--resume') ? JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')) : [];
try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('pet-music-muted', '1');
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120000);
    let errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [width, height] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width, height });
        for (const row of cases) {
            const name = `${row.eventId}-p${row.pageIndex}-${width}`;
            if (reports.some(report => report.name === name)) continue;
            errors = [];
            await page.goto(`http://127.0.0.1:4173/?${new URLSearchParams({ preview: 'vn', event: row.eventId, page: String(row.pageIndex), legacyArt: '1', avatar: 'square' })}`, { waitUntil: 'domcontentloaded' });
            await page.locator('.cvn-root').waitFor({ timeout: 90000 });
            await page.waitForLoadState('networkidle');
            await page.waitForFunction(expected => getComputedStyle(document.querySelector('.cvn-backdrop')).backgroundImage.includes(expected), row.background.split(/[?#]/)[0]);
            await page.waitForFunction(() => [...document.querySelectorAll('.cvn-root img')].every(i => i.complete && i.naturalWidth));
            const state = await page.evaluate(async () => {
                const background = getComputedStyle(document.querySelector('.cvn-backdrop')).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];
                const image = new Image(); image.src = background;
                try { await image.decode(); } catch (error) { throw new Error(`Cannot decode ${background}: ${error}`); }
                return { background: new URL(background).pathname,
                    portraits: [...document.querySelectorAll('.cvn-actor:not(.is-player) img')].map(i => new URL(i.src).pathname),
                    overflow: document.documentElement.scrollWidth - innerWidth };
            });
            const expected = row.actors.filter(actor => actor.name !== 'Player' && actor.image).map(actor => actor.image.split(/[?#]/)[0]);
            assert.deepEqual(state.portraits.sort(), expected.sort(), `${row.eventId} page ${row.pageIndex} portraits`);
            assert.equal(state.background, row.background.split(/[?#]/)[0], `${row.eventId} page ${row.pageIndex} background`);
            assert.ok(state.overflow <= 1);
            assert.deepEqual(errors, []);
            if (row.pageIndex === 0) await page.screenshot({ path: path.join(output, `${name}.png`) });
            reports.push({ name, ...state });
            console.log(name);
        }
    }
} finally {
    await browser.close();
    await writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
}
