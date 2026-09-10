/** Decoded atlases are large. Keep a small LRU across clashes; mounted actors
 * retain their own image references when an old cache entry is evicted. */
export const WARFRONT_IMAGE_CACHE_LIMIT = 20;
export const WARFRONT_IMAGE_LOAD_TIMEOUT_MS = 25_000;

/** Failed or stalled art must reach the renderer's recovery UI. Loading is
 * shared across warmup and mounting, so this deadline belongs to the image. */
export function loadWarfrontImage(url: string, createImage: () => HTMLImageElement = () => new Image()): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = createImage();
        let finished = false;
        const finish = (error?: Error) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            image.onload = image.onerror = null;
            if (error) {
                image.removeAttribute("src");
                reject(error);
            } else resolve(image);
        };
        const timer = setTimeout(() => finish(new Error(`Battle image timed out: ${url}`)), WARFRONT_IMAGE_LOAD_TIMEOUT_MS);
        image.decoding = "async";
        image.onload = () => { void image.decode().catch(() => undefined).then(() => finish()); };
        image.onerror = () => finish(new Error(`Unable to load ${url}`));
        image.src = url;
    });
}

export function createWarfrontImageCache<T>(load: (url: string) => Promise<T>, limit = WARFRONT_IMAGE_CACHE_LIMIT) {
    const entries = new Map<string, Promise<T>>();
    const capacity = Math.max(1, Math.floor(limit));
    const get = (url: string): Promise<T> => {
        const cached = entries.get(url);
        if (cached) {
            entries.delete(url);
            entries.set(url, cached);
            return cached;
        }
        const pending = Promise.resolve().then(() => load(url));
        entries.set(url, pending);
        while (entries.size > capacity) entries.delete(entries.keys().next().value!);
        void pending.catch(() => {
            if (entries.get(url) === pending) entries.delete(url);
        });
        return pending;
    };
    return {
        get,
        get size() { return entries.size; },
        async warm(urls: readonly string[]): Promise<void> {
            const unique = [...new Set(urls)];
            // Decode at most three large atlases together, leaving the UI time
            // to paint loading progress and avoiding a burst of decoder memory.
            for (let start = 0; start < unique.length; start += 3) {
                await Promise.all(unique.slice(start, start + 3).map(get));
            }
        },
    };
}
