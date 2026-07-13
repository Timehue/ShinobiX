import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDailyMissionCache, utcDayKey, writeDailyMissionCache } from './daily-mission-cache.js';

class MemorySessionStorage {
    private values = new Map<string, string>();
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
    clear(): void { this.values.clear(); }
}

const storage = new MemorySessionStorage();
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });

afterEach(() => storage.clear());

describe('daily mission cache', () => {
    const now = new Date('2026-07-12T12:00:00.000Z');
    const payload = { profession: 'vanguard', date: utcDayKey(now), missions: [{ id: 'patrol' }] };

    it('returns a same-player, same-track response immediately', () => {
        writeDailyMissionCache('tyler', 'vanguard', payload, now);
        assert.deepEqual(readDailyMissionCache('tyler', 'vanguard', now), payload);
    });

    it('never reuses a response for another player, track, or UTC day', () => {
        writeDailyMissionCache('tyler', 'vanguard', payload, now);
        assert.equal(readDailyMissionCache('other', 'vanguard', now), null);
        assert.equal(readDailyMissionCache('tyler', 'healer', now), null);
        assert.equal(readDailyMissionCache('tyler', 'vanguard', new Date('2026-07-13T00:00:00.000Z')), null);
    });

    it('refuses to store a stale daily response', () => {
        writeDailyMissionCache('tyler', 'vanguard', { ...payload, date: '2026-07-11' }, now);
        assert.equal(readDailyMissionCache('tyler', 'vanguard', now), null);
    });
});
