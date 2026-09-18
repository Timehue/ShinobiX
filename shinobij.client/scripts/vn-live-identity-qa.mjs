import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { legacyVnFixture } from './vn-art-fixtures.mjs';

const audit = JSON.parse(await readFile('../docs/art-audit/live-identity-audit.json', 'utf8'));
const rows = audit.rows.filter(row => row.id.startsWith('vn:') && !row.missingEvent && !row.missingPage);
const cases = [...new Map(rows.map(row => [`${row.eventId}:${row.pageIndex}`, row])).values()];
const output = path.resolve('../tmp/vn-identity-audit/verified');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('pet-music-muted', '1');
    });
    await context.route('**/api/img?**', async route => {
        const id = new URL(route.request().url()).searchParams.get('id');
        await route.fulfill({ contentType: 'image/webp', body: await legacyVnFixture(id) });
    });
    const page = await context.newPage();
    let errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const mobile = cases.filter(row => row.pageIndex === 0 || ['Kite Harrow', 'Elder Sova', 'Kage Hoshina Enju'].includes(row.actor));
    for (const [width, height, selected] of [[1440, 900, cases], [390, 844, mobile]]) {
        await page.setViewportSize({ width, height });
        for (const row of selected) {
            errors = [];
            await page.goto(`http://127.0.0.1:4173/?${new URLSearchParams({ preview: 'vn', event: row.eventId, page: String(row.pageIndex), legacyArt: '1', avatar: 'square' })}`, { waitUntil: 'domcontentloaded' });
            await page.locator('.cvn-root').waitFor({ timeout: 90000 });
            await page.waitForFunction(() => !document.querySelector('.cvn-root img[src*="/api/img"]'));
            await page.waitForFunction(() => [...document.querySelectorAll('.cvn-root img')].every(i => i.complete && i.naturalWidth));
            const state = await page.evaluate(() => ({
                portraits: [...document.querySelectorAll('.cvn-actor:not(.is-player) img')].map(i => new URL(i.src).pathname),
                actors: [...document.querySelectorAll('.cvn-actor:not(.is-player) figcaption')].map(i => i.textContent),
                overflow: document.documentElement.scrollWidth - innerWidth,
            }));
            const expected = row.cast.filter(actor => actor.name !== 'Player' && actor.image).map(actor => actor.image.split(/[?#]/)[0]);
            assert.deepEqual(state.portraits.sort(), expected.sort(), `${row.eventId} page ${row.pageIndex}`);
            assert.ok(state.overflow <= 1);
            assert.deepEqual(errors, []);
            const name = `${row.eventId}-p${row.pageIndex}-${width}`;
            if (width === 390 || row.pageIndex === 0) await page.screenshot({ path: path.join(output, `${name}.png`) });
            reports.push({ name, expected, ...state });
            console.log(name);
        }
    }
} finally {
    await browser.close();
    await writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
}
