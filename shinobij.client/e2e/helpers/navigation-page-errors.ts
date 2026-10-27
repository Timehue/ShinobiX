import type { Frame, Page, Request } from '@playwright/test';

// WebKit logs a refused old-document fetch as a JavaScript page error while
// its replacement is provisional, even when the rejection is caught:
// https://github.com/microsoft/playwright/issues/43120
// Keep the exception scoped to the exact recovery probe and native error,
// between an actual main-document request and its commit (or failure).
export function isWebkitReplacementProbeError(error: Error, browserName: string, replacingDocument: boolean, origin: string) {
    if (browserName !== 'webkit' || !replacingDocument || error.name !== 'Fetch API cannot load http') return false;
    const line = error.stack?.split('\n')[0] ?? '';
    const match = /^Fetch API cannot load (https?:\/\/\S+) due to access control checks\.$/.exec(line);
    if (!match) return false;
    let url: URL;
    try { url = new URL(match[1]); } catch { return false; }
    return url.origin === origin && url.pathname === '/api/pvp/session' && url.searchParams.get('pending') === '1';
}

export function collectNavigationPageErrors(page: Page, browserName: string) {
    const errors: string[] = [];
    const documentReplacementErrors: string[] = [];
    let hasDocument = page.url() !== 'about:blank';
    let replacingDocument = false;
    let origin = hasDocument ? new URL(page.url()).origin : '';
    const onRequest = (request: Request) => {
        if (hasDocument && request.isNavigationRequest() && request.frame() === page.mainFrame()) replacingDocument = true;
    };
    const onCommit = (frame: Frame) => {
        if (frame !== page.mainFrame()) return;
        hasDocument = frame.url() !== 'about:blank';
        origin = new URL(frame.url()).origin;
        replacingDocument = false;
    };
    const onFailed = (request: Request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) replacingDocument = false;
    };
    const onError = (error: Error) => {
        const destination = isWebkitReplacementProbeError(error, browserName, replacingDocument, origin)
            ? documentReplacementErrors : errors;
        destination.push(error.message);
    };
    page.on('request', onRequest);
    page.on('framenavigated', onCommit);
    page.on('requestfailed', onFailed);
    page.on('pageerror', onError);
    return {
        errors, documentReplacementErrors,
        dispose() {
            page.off('request', onRequest);
            page.off('framenavigated', onCommit);
            page.off('requestfailed', onFailed);
            page.off('pageerror', onError);
        },
    };
}
