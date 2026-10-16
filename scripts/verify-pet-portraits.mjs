import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireClient = createRequire(join(root, 'shinobij.client/package.json'));
const { chromium } = requireClient('playwright');
const evidence = join(root, '.tmp/pet-portrait-refresh-qa');
mkdirSync(evidence, { recursive: true });
const production = JSON.parse(readFileSync(join(root, 'shinobij.client/art-source/pet-portrait-refresh/production.json'), 'utf8'));
const expected = production.entries.filter((entry) => entry.status === 'reviewed').length;
const channel = process.env.PET_PORTRAIT_QA_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const failures = [];
const reports = [];
try {
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1080 }], ['mobile', { width: 390, height: 844 }]]) {
        const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
        page.on('pageerror', (error) => failures.push(`${name}: ${error.message}`));
        const response = await page.goto(`${process.env.PET_PORTRAIT_QA_URL || 'https://127.0.0.1:5182'}/petportraits.html`, { waitUntil: 'networkidle', timeout: 60000 });
        assert.equal(response.status(), 200);
        await page.waitForSelector('[data-portrait-id]');
        await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
        const count = await page.locator('[data-portrait-id]').count();
        assert.equal(count, expected, `${name}: complete current production coverage`);
        const layout = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth,
            cards: [...document.querySelectorAll('[data-portrait-id]')].map((card) => {
                const image = card.querySelector('img');
                const frame = card.querySelector('.companion-identity-art').getBoundingClientRect();
                const style = getComputedStyle(image);
                return { id: card.dataset.portraitId, src: image.currentSrc, scenic: image.dataset.petArt, square: Math.abs(frame.width - frame.height) < 1.5, objectFit: style.objectFit, padding: style.padding, loaded: image.complete && image.naturalWidth > 0 };
            }),
        }));
        assert.equal(layout.overflow, false, `${name}: no horizontal overflow`);
        for (const card of layout.cards) {
            const entry = production.entries.find((item) => item.id === card.id);
            const servedUrl = new URL(card.src);
            assert.equal(servedUrl.pathname, `/${entry.output}`, `${card.id}: current delivery path`);
            assert.equal(servedUrl.searchParams.get('v'), entry.outputSha256.slice(0, 12), `${card.id}: current image revision`);
            const delivery = await page.request.get(card.src, { headers: { 'Cache-Control': 'no-cache' } });
            assert.equal(delivery.status(), 200, `${card.id}: served image`);
            card.servedSha256 = createHash('sha256').update(await delivery.body()).digest('hex');
            assert.equal(card.servedSha256, entry.outputSha256, `${card.id}: actual served bytes match reviewed artwork`);
            assert.equal(card.scenic, 'scenic', card.id);
            assert.equal(card.square, true, `${card.id}: preserve entire portrait`);
            assert.equal(card.objectFit, 'cover', card.id);
            assert.equal(card.padding, '0px', card.id);
            assert.equal(card.loaded, true, card.id);
        }
        await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
        for (const id of ['starter-lightning', 'standard-0', 'starter-earth-r', 'rare-3', 'rare-40']) {
            const entry = production.entries.find((item) => item.id === id);
            await page.getByRole('textbox').fill(entry.name);
            await page.locator(`[data-portrait-id="${id}"]`).click();
            const selected = page.locator('.portrait-comparison figure').first();
            await selected.locator('img').evaluate((image) => image.decode());
            assert.ok((await selected.locator('img').getAttribute('src')).includes(`/${entry.output}?v=${entry.outputSha256.slice(0, 12)}`));
            await selected.screenshot({ path: join(evidence, `${id}-${name}.png`) });
        }
        await page.getByRole('textbox').fill('Cinder Cub');
        assert.equal(await page.locator('[data-portrait-id]').count(), 1);
        await page.locator('[data-portrait-id="starter-fire"]').click();
        assert.match(await page.locator('.portrait-comparison figure').first().innerText(), /Cinder Cub/);
        const magpie = production.entries.find((entry) => entry.id === 'standard-38' && entry.status === 'reviewed');
        if (magpie) {
            await page.getByRole('textbox').fill('Kite Magpie');
            await page.locator('[data-portrait-id="standard-38"]').click();
            const selected = page.locator('.portrait-comparison figure').first();
            const portrait = selected.locator('img');
            await portrait.evaluate((image) => image.decode());
            await page.waitForFunction(() => [...document.querySelectorAll('.portrait-comparison img')].every((image) => image.complete && image.naturalWidth > 0));
            assert.equal(await page.locator('.portrait-comparison figure').count(), 3, 'Portrait, original cutout and current model reference are available');
            assert.ok((await portrait.getAttribute('src')).includes(`/${magpie.output}?v=${magpie.outputSha256.slice(0, 12)}`), 'Corrected Magpie bytes are selected');
            await selected.screenshot({ path: join(evidence, `kite-magpie-${name}.png`) });
        }
        reports.push({ viewport: name, loadedPortraits: count, ...layout });
        await page.close();
    }
    assert.deepEqual(failures, [], 'No browser runtime errors');
    writeFileSync(join(evidence, 'report.json'), `${JSON.stringify({ expected, reports, failures }, null, 2)}\n`);
    console.log(`Verified ${expected} scenic portraits on desktop and mobile; zero image failures or layout overflow.`);
} finally {
    await browser.close();
}
