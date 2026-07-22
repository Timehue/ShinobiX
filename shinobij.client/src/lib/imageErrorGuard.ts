/* Global image failure recovery. Same-origin game media is safe to retry;
 * arbitrary external assets are hidden after their first failure. */
export const IMAGE_RETRY_LIMIT = 2;
const IMAGE_RETRY_DELAYS_MS = [400, 1_400] as const;
const IMAGE_RETRY_PARAM = "__img_retry";
type ImageRetryState = [base: string, count: number, failed: boolean];
const imageRetryStates = new WeakMap<HTMLImageElement, ImageRetryState>();

export function canonicalImageRetrySource(source: string, baseHref: string): string {
    try {
        const url = new URL(source, baseHref);
        url.searchParams.delete(IMAGE_RETRY_PARAM);
        return url.href;
    } catch {
        return "";
    }
}

export function isRetryableImageSource(source: string, baseHref: string): boolean {
    return imageRetryLimitForSource(source, baseHref) > 0;
}

export function imageRetryLimitForSource(source: string, baseHref: string): number {
    try {
        const url = new URL(source, baseHref);
        if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(baseHref).origin) return 0;
        return url.pathname === "/api/img" ? IMAGE_RETRY_LIMIT : 1;
    } catch {
        return 0;
    }
}

export function nextImageRetrySource(source: string, attempt: number, baseHref: string): string {
    const url = new URL(canonicalImageRetrySource(source, baseHref));
    url.searchParams.set(IMAGE_RETRY_PARAM, String(attempt));
    return url.href;
}

function installImageGuards(): void {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __sjig?: boolean };
    if (w.__sjig) return;
    w.__sjig = true;

    // A successful retry, or a new src supplied by React, restores the same DOM
    // node. The old guard never did this and could leave a valid image hidden.
    window.addEventListener("load", (e: Event) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement) || !imageRetryStates.has(img)) return;
        img.style.removeProperty("display");
        imageRetryStates.delete(img);
    }, true);

    window.addEventListener("error", (e: Event) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;

        const pageHref = window.location.href;
        const source = img.currentSrc || img.src;
        const retryBase = canonicalImageRetrySource(source, pageHref);
        const retryLimit = imageRetryLimitForSource(source, pageHref);
        let state = imageRetryStates.get(img);
        if (state?.[2] && state[0] === retryBase) return;
        if (!state || state[0] !== retryBase) {
            state = [retryBase, 0, false];
            imageRetryStates.set(img, state);
        }

        // Combat images use display:block!important, so the guard must match
        // that priority or a broken-image glyph can cover the fallback below.
        img.style.setProperty("display", "none", "important");
        if (!retryBase || !retryLimit || state[1] >= retryLimit) {
            state[2] = true;
            return;
        }

        const attempt = ++state[1];
        window.setTimeout(() => {
            if (!img.isConnected) return;
            const liveBase = canonicalImageRetrySource(img.currentSrc || img.src, window.location.href);
            if (liveBase !== retryBase) return; // React supplied a newer image meanwhile.
            img.src = nextImageRetrySource(retryBase, attempt, window.location.href);
        }, IMAGE_RETRY_DELAYS_MS[attempt - 1]);
    }, true); // Resource error events only reach window during capture.

    // Apply asynchronous decoding to images as they enter the DOM.
    if (typeof MutationObserver === "undefined") return;

    const hint = (img: HTMLImageElement) => { if (!img.hasAttribute("decoding")) img.decoding = "async"; };
    const scan = (node: Node) => {
        if (node instanceof HTMLImageElement) hint(node);
        else if (node instanceof Element && node.firstElementChild) node.querySelectorAll("img").forEach(hint);
    };

    document.querySelectorAll("img").forEach(hint);
    new MutationObserver((records) => {
        records.forEach((r) => r.addedNodes.forEach(scan));
    }).observe(document.documentElement, { childList: true, subtree: true });
}

installImageGuards();
