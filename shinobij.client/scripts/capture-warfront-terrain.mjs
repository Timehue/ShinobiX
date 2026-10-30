// Run against the local Vite asset preview after build-warfront-terrain.mjs.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => { throw error; });
    for (const kind of ['pillar', 'cover']) {
        await page.goto(`${process.env.WARFRONT_ASSET_PREVIEW_URL || "http://127.0.0.1:19984"}/scripts/warfront-terrain/index.html?kind=${kind}`);
        await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 60_000 });
        await page.screenshot({ path: fileURLToPath(new URL(`../public/assets/warfront/shrine-${kind}-v1.png`, import.meta.url)), omitBackground: true });
        console.log(kind, 'ground anchor', await page.locator('canvas').getAttribute('data-anchor-y'));
    }
} finally { await browser.close(); }
