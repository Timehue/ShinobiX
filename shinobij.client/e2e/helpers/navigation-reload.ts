import type { Page, Request } from '@playwright/test';

// Chromium can lose concurrent module requests when Windows changes networks,
// even on loopback. Recover once only when that exact failure was observed in
// this reload. HTTP errors, API failures and navigation assertions stay fatal.
export async function reloadWithTransientAssetRecovery(page: Page, assertReady: () => Promise<void>) {
    const origin = new URL(page.url()).origin;
    let networkChanged = false;
    const onFailed = (request: Request) => {
        const url = new URL(request.url());
        if (url.origin === origin && /^\/assets\/[^/]+\.m?js$/.test(url.pathname) &&
            request.resourceType() === 'script' && request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED') {
            networkChanged = true;
        }
    };
    page.on('requestfailed', onFailed);
    try {
        await page.reload();
        await assertReady();
    } catch (error) {
        if (!networkChanged) throw error;
        console.warn('[navigation] Retrying reload once after a local module request failed with ERR_NETWORK_CHANGED');
        await page.reload();
        await assertReady();
    } finally {
        page.off('requestfailed', onFailed);
    }
}
