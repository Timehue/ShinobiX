import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const url = process.env.SHINOBIX_PRODUCTION_URL || 'https://shinobijourney.com/';
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const failedRequests = [];
const badResponses = [];

page.on('requestfailed', (request) => {
    failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' });
});
page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() });
});

try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 180,
        downloadThroughput: 500 * 1024 / 8,
        uploadThroughput: 250 * 1024 / 8,
        connectionType: 'cellular3g',
    });
    const startedAt = Date.now();
    const response = await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(response?.status(), 200);
    await page.waitForTimeout(2_000);
    const title = await page.title();
    const bodyText = (await page.locator('body').innerText()).trim();
    assert.ok(title.length > 0, 'production document title is empty');
    assert.ok(bodyText.length > 0, 'production app shell rendered no text');
    const assetFailures = failedRequests.filter((item) => /\.(?:js|css|woff2?|webp|png|jpe?g|svg)(?:\?|$)/i.test(item.url));
    const assetErrors = badResponses.filter((item) => /\.(?:js|css|woff2?|webp|png|jpe?g|svg)(?:\?|$)/i.test(item.url));
    assert.deepEqual(assetFailures, []);
    assert.deepEqual(assetErrors, []);
    process.stdout.write(`${JSON.stringify({
        result: 'PASS',
        url: page.url(),
        profile: '500 Kbps down / 250 Kbps up / 180 ms RTT',
        elapsedMs,
        title,
        renderedCharacters: bodyText.length,
        failedStaticAssets: 0,
        staticAssetHttpErrors: 0,
    }, null, 2)}\n`);
} finally {
    await context.close();
    await browser.close();
}
