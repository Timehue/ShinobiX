import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { legacyVnFixture, replacementVnFixture } from './vn-art-fixtures.mjs';

const audit = JSON.parse(await readFile('../docs/art-audit/live-identity-audit.json', 'utf8'));
const eventId = 'story-frostfang-village-4-0';
const row = audit.rows.find(row => row.eventId === eventId && row.id.endsWith(':page:0:right'));
const expected = row.cast.filter(actor => actor.name !== 'Player' && actor.image).map(actor => actor.image.split(/[?#]/)[0]);
const browser = await chromium.launch({ headless: true });
try {
    for (const replacement of [false, true]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        let requests = 0;
        await context.route('**/api/img?**', async route => {
            requests++;
            await gate;
            const id = new URL(route.request().url()).searchParams.get('id');
            await route.fulfill({ contentType: 'image/webp', body: await (replacement ? replacementVnFixture() : legacyVnFixture(id)) });
        });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:4173/?${new URLSearchParams({ preview: 'vn', event: eventId, page: '0', legacyArt: '1', avatar: 'square' })}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.cvn-root').waitFor({ timeout: 90000 });
        const portraits = () => page.locator('.cvn-actor:not(.is-player) img').evaluateAll(images => images.map(i => new URL(i.src).pathname));
        assert.deepEqual(await portraits(), expected, 'current cast appears before any image verification response');
        assert.equal(await page.locator('.cvn-root img[src*="/api/img"]').count(), 0);
        assert.ok(requests > 0, 'verification is pending');
        release();
        await page.waitForLoadState('networkidle');
        if (replacement) {
            await page.locator('.cvn-actor:not(.is-player) img[src*="/api/img"]').waitFor();
        } else {
            assert.deepEqual(await portraits(), expected, 'reviewed stale bytes remain retired');
            assert.equal(await page.locator('.cvn-root img[src*="/api/img"]').count(), 0);
        }
        console.log(replacement ? 'new upload in old slot restored after verification' : 'old identity never appears, including first paint');
        await context.close();
    }
} finally {
    await browser.close();
}
