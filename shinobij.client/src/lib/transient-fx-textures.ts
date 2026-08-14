import * as THREE from "three";

/** A small match-local working set keeps repeated jutsu bursts hot without
 * retaining every effect the player has ever seen. Active leases are never
 * evicted; idle sequences leave in least-recently-used order. */
export const TRANSIENT_FX_TEXTURE_CACHE_LIMIT = 12;
export const TRANSIENT_FX_DECODE_TIMEOUT_MS = 2_500;

type TextureSequenceEntry = {
    key: string;
    textures: THREE.Texture[];
    ready: Promise<readonly THREE.Texture[]>;
    refs: number;
    lastUsed: number;
    loaded: boolean;
    cached: boolean;
    disposed: boolean;
};

export type TransientFxTextureLease = {
    ready: Promise<readonly THREE.Texture[]>;
    release: () => void;
};

const sequenceCache = new Map<string, TextureSequenceEntry>();
const loader = new THREE.TextureLoader();
let sequenceClock = 0;

export const transientFxTextureSequenceKey = (urls: readonly string[]): string => urls.join("\u0000");

function boundedDecode(image: HTMLImageElement & { decode?: () => Promise<void> }): Promise<void> {
    if (!image.decode) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => { if (settled) return; settled = true; globalThis.clearTimeout(timer); resolve(); };
        const timer = globalThis.setTimeout(finish, TRANSIENT_FX_DECODE_TIMEOUT_MS);
        void image.decode().catch(() => undefined).then(finish);
    });
}

function loadDecodedTexture(url: string): Promise<THREE.Texture | null> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (texture: THREE.Texture | null) => {
            if (settled) { texture?.dispose(); return; }
            settled = true;
            globalThis.clearTimeout(timeout);
            resolve(texture);
        };
        const timeout = globalThis.setTimeout(() => finish(null), TRANSIENT_FX_DECODE_TIMEOUT_MS);
        loader.load(url, (texture) => {
            const image = texture.image as (HTMLImageElement & { decode?: () => Promise<void> }) | undefined;
            void (image ? boundedDecode(image) : Promise.resolve()).then(() => {
                texture.colorSpace = THREE.SRGBColorSpace;
                finish(texture);
            });
        }, undefined, () => finish(null));
    });
}

function disposeEntry(entry: TextureSequenceEntry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    if (entry.cached && sequenceCache.get(entry.key) === entry) sequenceCache.delete(entry.key);
    for (const texture of entry.textures) texture.dispose();
    entry.textures.length = 0;
}

function trimIdleSequences(maxSize = TRANSIENT_FX_TEXTURE_CACHE_LIMIT): void {
    if (sequenceCache.size <= maxSize) return;
    const idle = [...sequenceCache.values()]
        .filter((entry) => entry.refs === 0 && entry.loaded && !entry.disposed)
        .sort((a, b) => a.lastUsed - b.lastUsed);
    while (sequenceCache.size > maxSize) {
        const entry = idle.shift();
        if (!entry) break;
        disposeEntry(entry);
    }
}

function sequenceEntry(urls: readonly string[]): TextureSequenceEntry {
    const key = transientFxTextureSequenceKey(urls);
    const cached = sequenceCache.get(key);
    if (cached && !cached.disposed) {
        cached.lastUsed = ++sequenceClock;
        return cached;
    }
    trimIdleSequences(TRANSIENT_FX_TEXTURE_CACHE_LIMIT - 1);
    const cacheEntry = sequenceCache.size < TRANSIENT_FX_TEXTURE_CACHE_LIMIT;
    const entry: TextureSequenceEntry = {
        key,
        textures: [],
        ready: Promise.resolve([]),
        refs: 0,
        lastUsed: ++sequenceClock,
        loaded: false,
        cached: cacheEntry,
        disposed: false,
    };
    entry.ready = Promise.all(urls.map(loadDecodedTexture)).then((loaded) => {
        if (entry.disposed) {
            for (const texture of loaded) texture?.dispose();
            return [];
        }
        entry.textures.push(...loaded.filter((texture): texture is THREE.Texture => texture !== null));
        entry.loaded = true;
        if (!entry.cached && entry.refs === 0) {
            disposeEntry(entry);
            return [];
        }
        trimIdleSequences();
        return entry.textures;
    });
    if (cacheEntry) sequenceCache.set(key, entry);
    return entry;
}

export function acquireTransientFxTextures(urls: readonly string[]): TransientFxTextureLease {
    const entry = sequenceEntry(urls);
    entry.refs++;
    entry.lastUsed = ++sequenceClock;
    let released = false;
    return {
        ready: entry.ready,
        release: () => {
            if (released) return;
            released = true;
            entry.refs = Math.max(0, entry.refs - 1);
            entry.lastUsed = ++sequenceClock;
            if (!entry.cached && entry.loaded && entry.refs === 0) disposeEntry(entry);
            trimIdleSequences();
        },
    };
}

/** Warm likely sequences during the match countdown. A failed image is simply
 * omitted and the renderer retains its radial fallback. */
export async function preloadTransientFxTextures(sequences: readonly (readonly string[])[]): Promise<void> {
    const entries = sequences.filter((urls) => urls.length > 0).map(sequenceEntry);
    await Promise.all(entries.map((entry) => entry.ready.then(() => undefined)));
    trimIdleSequences();
}

/** Test/diagnostic seam; no texture objects escape the cache. */
export const transientFxTextureCacheSize = (): number => sequenceCache.size;
