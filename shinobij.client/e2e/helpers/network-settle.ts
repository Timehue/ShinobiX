import type { Frame, Page, Request } from '@playwright/test';

export type SettleOptions = {
    /**
     * Budget for the navigation, and again for the network to go quiet. Left
     * out, the navigation keeps the configured navigationTimeout and the
     * quiet wait gets 30 s.
     */
    timeout?: number;
};

const QUIET_MS = 500;
const ABANDONED_AFTER_MS = 15_000;
const QUIET_BUDGET_MS = 30_000;

/**
 * Navigate to `load`, then wait until no request has been in flight for
 * 500 ms: what `waitUntil: "networkidle"` waits for, minus requests the
 * browser abandoned.
 *
 * CI's headless Firefox cancels an image load when the <img> that started it
 * is replaced, and the new element requests the same URL again. It usually
 * reports the cancel, but sometimes it reports nothing, so Playwright counts
 * the request in flight forever and `networkidle` never arrives, though the
 * page is fully drawn. The 2026-10-02 CI traces of pet-home-visual show six
 * such cancels, each 16-85 ms before a new request for the same URL. Firefox
 * reported two (NS_BINDING_ABORTED) and nothing at all for the other four.
 *
 * So an open request stops counting once a later request for its URL loads,
 * or once it has been open for 15 s. Otherwise this counts what
 * `networkidle` counts. A new document stops counting the previous
 * document's requests, and event streams never count.
 */
async function settle<T>(page: Page, navigate: () => Promise<T>, timeout: number): Promise<T> {
    const open = new Map<Request, number>();
    let lastActivity = Date.now();
    let navigation: Request | undefined;
    const counts = (request: Request) => request.resourceType() !== 'eventsource';
    const onRequest = (request: Request) => {
        if (!counts(request)) return;
        open.set(request, Date.now());
        lastActivity = Date.now();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation = request;
    };
    const onEnd = (request: Request) => {
        if (!counts(request)) return;
        open.delete(request);
        lastActivity = Date.now();
    };
    const onFinished = (request: Request) => {
        const since = open.get(request);
        onEnd(request);
        if (since === undefined) return;
        for (const [pending, pendingSince] of open) {
            if (pendingSince <= since && pending.url() === request.url()) open.delete(pending);
        }
    };
    // A hash or pushState navigation makes no request, so only a navigation
    // request's commit swaps the document.
    const onNavigated = (frame: Frame) => {
        if (frame !== page.mainFrame() || !navigation) return;
        for (const request of open.keys()) {
            if (request !== navigation) open.delete(request);
        }
        navigation = undefined;
    };
    page.on('request', onRequest);
    page.on('requestfinished', onFinished);
    page.on('requestfailed', onEnd);
    page.on('framenavigated', onNavigated);
    try {
        const result = await navigate();
        const deadline = Date.now() + timeout;
        for (;;) {
            const now = Date.now();
            const live = [...open].filter(([, since]) => now - since < ABANDONED_AFTER_MS);
            if (live.length === 0 && now - lastActivity >= QUIET_MS) return result;
            if (page.isClosed()) throw new Error('The page closed before the network went quiet.');
            if (now >= deadline) {
                const urls = live.map(([request]) => request.url()).join(', ');
                throw new Error(`The network did not go quiet within ${timeout} ms. Still open: ${urls}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    } finally {
        page.off('request', onRequest);
        page.off('requestfinished', onFinished);
        page.off('requestfailed', onEnd);
        page.off('framenavigated', onNavigated);
    }
}

/** `page.goto(url, { waitUntil: "networkidle" })` that does not wait on abandoned requests. */
export function gotoSettled(page: Page, url: string, { timeout }: SettleOptions = {}) {
    return settle(page, () => page.goto(url, { waitUntil: 'load', timeout }), timeout ?? QUIET_BUDGET_MS);
}

/** `page.reload({ waitUntil: "networkidle" })` that does not wait on abandoned requests. */
export function reloadSettled(page: Page, { timeout }: SettleOptions = {}) {
    return settle(page, () => page.reload({ waitUntil: 'load', timeout }), timeout ?? QUIET_BUDGET_MS);
}
