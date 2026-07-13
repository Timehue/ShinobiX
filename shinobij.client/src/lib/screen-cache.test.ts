import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readScreenCache, writeScreenCache } from './screen-cache.js';

class MemorySessionStorage {
    private values = new Map<string, string>();
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
    clear(): void { this.values.clear(); }
}

const storage = new MemorySessionStorage();
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });

afterEach(() => storage.clear());

describe('screen cache', () => {
    it('returns a validated, short-lived response', () => {
        writeScreenCache('board:aya', { rows: [] }, 1_000);
        assert.deepEqual(readScreenCache('board:aya', (value): value is { rows: unknown[] } =>
            !!value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows),
        ), { rows: [] });
    });

    it('does not return a value that fails the caller validation', () => {
        writeScreenCache('board:aya', { rows: [1] }, 1_000);
        assert.equal(readScreenCache('board:aya', (value): value is { rows: string[] } =>
            !!value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)
                && (value as { rows: unknown[] }).rows.every((row) => typeof row === 'string'),
        ), null);
    });
});
