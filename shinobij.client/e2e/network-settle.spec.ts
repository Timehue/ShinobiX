import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { gotoSettled } from './helpers/network-settle';

// page.route answers the page, its gate image and its art, so the app is not
// involved. A request the route never answers stands in for an image load
// CI's Firefox cancels without reporting: Playwright counts both in flight
// forever. The gate holds the page's load event until every art request has
// reached its route, so a slow machine cannot report one only after the
// network already looked quiet.
const ROOT = '/__network-settle__';
const PAGE = `${ROOT}/page`;
const ART = `${ROOT}/art.webp`;
// Read the body: Chromium aborts a fetch whose body nobody reads, and an
// aborted request is not one that loaded.
const FETCH_ART = "fetch('art.webp').then((response) => response.arrayBuffer())";

/** Serve a page that requests the art `times` times, 50 ms apart. */
async function serve(page: Page, times: number, answer: (route: Route, nth: number) => Promise<void> | void) {
    let nth = 0;
    let arrived = () => {};
    let allArrived = Promise.resolve();
    await page.route(`**${PAGE}`, (route) => {
        nth = 0;
        allArrived = new Promise<void>((resolve) => { arrived = resolve; });
        const script = Array.from({ length: times }, (_, index) => `setTimeout(() => ${FETCH_ART}, ${index * 50});`).join(' ');
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><link rel="icon" href="data:,"><script>${script}</script><img src="gate.webp" alt="">` });
    });
    await page.route(`**${ROOT}/gate.webp`, async (route) => {
        await allArrived;
        await route.fulfill({ contentType: 'image/webp', body: 'RIFF' });
    });
    await page.route(`**${ART}`, (route) => {
        nth += 1;
        if (nth === times) arrived();
        return answer(route, nth);
    });
}

test.skip(({ isMobile }) => isMobile, 'this is browser-engine behaviour, so the desktop project of each engine is enough');

test('an unreported request stops counting once a later request for its URL loads', async ({ page }) => {
    let held: Request | undefined;
    const reported: string[] = [];
    page.on('requestfinished', (request) => { if (request === held) reported.push('finished'); });
    page.on('requestfailed', (request) => { if (request === held) reported.push('failed'); });
    await serve(page, 2, (route, nth) => {
        if (nth === 1) held = route.request();
        else return route.fulfill({ contentType: 'image/webp', body: 'RIFF' });
    });
    await gotoSettled(page, PAGE, { timeout: 10_000 });
    expect(held, 'the first art request reached its route').toBeDefined();
    expect(reported, 'the browser never reported the first art request').toEqual([]);
});

test('a slow request still holds the page until it lands', async ({ page }) => {
    let landed = false;
    page.on('requestfinished', (request) => { if (request.url().endsWith(ART)) landed = true; });
    await serve(page, 1, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.fulfill({ contentType: 'image/webp', body: 'RIFF' });
    });
    await gotoSettled(page, PAGE, { timeout: 10_000 });
    expect(landed).toBe(true);
});
