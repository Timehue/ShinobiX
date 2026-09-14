import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHUNK_RELOAD_WINDOW_MS,
    clearChunkReloadFlag,
    isChunkLoadError,
    reloadClearingChunkFlag,
    reloadOnceForChunkLoadError,
} from './chunk-load-recovery.js';

const FLAG = '__sj_chunk_reloaded';
const T0 = 1_757_800_000_000;

class MemorySessionStorage {
    private values = new Map<string, string>();
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
    removeItem(key: string): void { this.values.delete(key); }
    clear(): void { this.values.clear(); }
}

const storage = new MemorySessionStorage();
let reloads = 0;

function installStorage(value: unknown): void {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value });
}

beforeEach(() => {
    storage.clear();
    installStorage(storage);
    reloads = 0;
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location: { reload: () => { reloads += 1; } } },
    });
});

afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'sessionStorage');
});

// The message each engine gives a failed dynamic import (measured 2026-09-13),
// plus the one retryDynamicImport rethrows after its last attempt.
const chunkError = (message = 'Failed to fetch dynamically imported module: https://x/assets/WeeklyBossArena-abc12345.js') =>
    new TypeError(message);

describe('isChunkLoadError', () => {
    it('recognises every engine and the retry wrapper', () => {
        for (const message of [
            'Failed to fetch dynamically imported module: https://x/assets/a-12345678.js',
            'error loading dynamically imported module: https://x/assets/a-12345678.js',
            'Importing a module script failed.',
            'error loading dynamically imported module (after 4 attempts): Importing a module script failed.',
            'Loading chunk 42 failed.',
        ]) {
            assert.equal(isChunkLoadError(new TypeError(message)), true, message);
        }
        assert.equal(isChunkLoadError({ name: 'ChunkLoadError', message: '' }), true);
    });

    it('rejects render errors and non-errors', () => {
        assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'hp')")), false);
        assert.equal(isChunkLoadError(null), false);
        assert.equal(isChunkLoadError(undefined), false);
        assert.equal(isChunkLoadError('dynamically imported module'), false);
    });
});

describe('reloadOnceForChunkLoadError', () => {
    it('reloads on the first chunk error and stamps the time before reloading', () => {
        let stampAtReload: string | null = null;
        (globalThis as unknown as { window: { location: { reload: () => void } } }).window.location.reload = () => {
            reloads += 1;
            stampAtReload = storage.getItem(FLAG);
        };
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0), true);
        assert.equal(reloads, 1);
        assert.equal(stampAtReload, String(T0));
    });

    it('never reloads for a render error, and leaves the guard alone', () => {
        assert.equal(reloadOnceForChunkLoadError(new Error('boom'), T0), false);
        assert.equal(reloads, 0);
        assert.equal(storage.getItem(FLAG), null);
    });

    it('shows the card for a second failure after the reload, however soon or late in the window', () => {
        // The loop this guards against: reload, boot, the same chunk fails
        // again. A fast engine is back in ~4 s; a chunk that hangs on every
        // attempt is back in about a minute. Nothing clears the stamp between.
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0), true);
        for (const later of [4_400, 10_000, 52_000, CHUNK_RELOAD_WINDOW_MS - 1]) {
            assert.equal(reloadOnceForChunkLoadError(chunkError(), T0 + later), false, `+${later} ms`);
        }
        assert.equal(reloads, 1);
        assert.equal(storage.getItem(FLAG), String(T0), 'a declined attempt must not extend the window');
    });

    it('caps a repeatedly failing chunk at one reload per window', () => {
        // Simulate a tab whose restored screen fails ~5 s after every boot
        // for half an hour.
        for (let t = T0; t < T0 + 30 * 60_000; t += 5_000) {
            reloadOnceForChunkLoadError(chunkError(), t);
        }
        assert.equal(reloads, (30 * 60_000) / CHUNK_RELOAD_WINDOW_MS);
    });

    it('reloads again for a chunk error once the window has passed', () => {
        // A second, genuinely new stale deploy later in the same tab.
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0), true);
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0 + CHUNK_RELOAD_WINDOW_MS), true);
        assert.equal(reloads, 2);
        assert.equal(storage.getItem(FLAG), String(T0 + CHUNK_RELOAD_WINDOW_MS));
    });

    it('lets the manual Reload button re-arm exactly one automatic reload', () => {
        reloadOnceForChunkLoadError(chunkError(), T0);
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0 + 5_000), false);
        reloadClearingChunkFlag();
        assert.equal(reloads, 2, 'the button itself reloads');
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0 + 9_000), true);
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0 + 13_000), false);
        assert.equal(reloads, 3);
    });

    it('treats the legacy "1" flag and unreadable stamps as expired', () => {
        // A tab mid-reload when this build deployed still holds the old "1".
        for (const legacy of ['1', '', 'yes', 'NaN', '0', '-5']) {
            storage.setItem(FLAG, legacy);
            assert.equal(reloadOnceForChunkLoadError(chunkError(), T0), true, JSON.stringify(legacy));
            assert.equal(storage.getItem(FLAG), String(T0));
        }
    });

    it('survives the clock moving back: one reload, then the fresh stamp holds', () => {
        storage.setItem(FLAG, String(T0 + 60 * 60_000));
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0), true);
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0 + 5_000), false);
        assert.equal(reloads, 1);
    });

    it('falls back to the card, never an unguarded reload, when storage fails', () => {
        installStorage({
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => { throw new Error('SecurityError'); },
            removeItem: () => { throw new Error('SecurityError'); },
        });
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0), false);

        installStorage({
            getItem: () => null,
            setItem: () => { throw new Error('QuotaExceededError'); },
            removeItem: () => undefined,
        });
        assert.equal(reloadOnceForChunkLoadError(chunkError(), T0), false);

        assert.equal(reloads, 0);
    });
});

describe('clearChunkReloadFlag', () => {
    it('removes the stamp and tolerates unavailable storage', () => {
        storage.setItem(FLAG, String(T0));
        clearChunkReloadFlag();
        assert.equal(storage.getItem(FLAG), null);

        installStorage({ removeItem: () => { throw new Error('SecurityError'); } });
        assert.doesNotThrow(() => clearChunkReloadFlag());
    });
});
