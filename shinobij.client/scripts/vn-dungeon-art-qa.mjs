import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { legacyVnFixture } from './vn-art-fixtures.mjs';
const cases = JSON.parse(await readFile('../docs/art-audit/live-art-browser-cases.json', 'utf8')).filter(row => row.eventId === 'builtin-hidden-dungeon');
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('pet-music-muted', '1');
    });
    await context.route('**/api/img?**', async route => route.fulfill({ contentType: 'image/webp', body: await legacyVnFixture(new URL(route.request().url()).searchParams.get('id')) }));
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const width of [1440, 390]) for (const row of cases) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto(`http://127.0.0.1:4173/?preview=vn&reader=dungeon&legacyArt=1&event=${row.eventId}&page=${row.pageIndex}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.cvn-root').waitFor({ timeout: 90000 });
        await page.waitForLoadState('networkidle');
        await page.locator('.cvn-dialogue-footer button').first().waitFor();
        const result = await page.evaluate(async () => {
            const stage = document.querySelector('.cvn-root');
            const image = new Image();
            const background = getComputedStyle(stage.querySelector('.cvn-backdrop')).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];
            image.src = background;
            await image.decode();
            return { background: new URL(image.src).pathname,
                portraits: [...stage.querySelectorAll('img')].map(i => i.getAttribute('src')),
                overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert.equal(result.background, row.background.split(/[?#]/)[0]);
        assert.ok(!result.portraits.some(src => src.includes('/api/img')));
        assert.ok(result.overflow <= 1);
        assert.deepEqual(errors, []);
        const name = `dungeon-p${row.pageIndex}-${width}`;
        await page.screenshot({ path: `../tmp/vn-art-recheck/verified/${name}.png` });
        reports.push({ name, ...result });
        console.log(name);
    }
} finally {
    await browser.close();
    await writeFile('../tmp/vn-art-recheck/verified/dungeon-report.json', JSON.stringify(reports, null, 2));
}
