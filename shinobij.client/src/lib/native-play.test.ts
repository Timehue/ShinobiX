import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maybeRequestPlayReview, reviewMilestoneEligible } from './native-play';
const ready = { native: true, visible: true, activated: true, level: 5, wins: 3, now: 200 * 86_400_000, last: 0 };
test('review requests require native app, foreground, a gesture and enough play', () => {
    assert.equal(reviewMilestoneEligible(ready), true);
    for (const patch of [{ native: false }, { visible: false }, { activated: false }, { level: 4 }, { wins: 2 }]) {
        assert.equal(reviewMilestoneEligible({ ...ready, ...patch }), false);
    }
});
test('review requests respect cooldown including clock rollback', () => {
    assert.equal(reviewMilestoneEligible({ ...ready, last: ready.now - 89 * 86_400_000 }), false);
    assert.equal(reviewMilestoneEligible({ ...ready, last: ready.now - 90 * 86_400_000 }), true);
    assert.equal(reviewMilestoneEligible({ ...ready, last: ready.now + 1 }), false);
});

test('the review bridge dispatches once from an eligible wrapper and leaves older installs alone', (t) => {
    const keys = ['window', 'navigator', 'location', 'document', 'localStorage', 'matchMedia'] as const;
    const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    t.after(() => {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    let url = 'https://shinobijourney.com/?playNative=1&playReview=0#/village';
    let standalone = true;
    const navigations: string[] = [];
    const storage = new Map<string, string>();
    const values = {
        window: {},
        navigator: { userAgent: 'Android', userActivation: { isActive: true } },
        location: { get href() { return url; }, set href(next: string) { navigations.push(next); } },
        document: { visibilityState: 'visible' },
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
        matchMedia: () => ({ matches: standalone }),
    };
    for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: values[key] });
    for (let i = 0; i < 4; i++) maybeRequestPlayReview(10);
    assert.equal(storage.size, 0, 'native eligibility must precede the web cooldown');
    url = 'https://shinobijourney.com/#/village';
    maybeRequestPlayReview(10);
    assert.equal(storage.size, 0, 'older wrappers have no review activity handshake');
    url = 'https://shinobijourney.com/?playNative=1&playReview=1#/village';
    standalone = false;
    maybeRequestPlayReview(10);
    assert.equal(storage.size, 0, 'a regular browser must never launch the native activity');
    standalone = true;
    maybeRequestPlayReview(10);
    maybeRequestPlayReview(10);
    assert.deepEqual(navigations, []);
    maybeRequestPlayReview(10);
    maybeRequestPlayReview(10);
    assert.deepEqual(navigations, ['intent://review#Intent;scheme=shinobijourney;package=com.shinobijourney.app;end']);
    values.localStorage.getItem = () => { throw new Error('Storage denied'); };
    assert.doesNotThrow(() => maybeRequestPlayReview(10));
});

test('the Flutter shell is never standalone, so its User-Agent token stands in', (t) => {
    const keys = ['window', 'navigator', 'location', 'document', 'localStorage', 'matchMedia'] as const;
    const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    t.after(() => {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    const url = 'https://shinobijourney.com/?playNative=1&playReview=1#/village';
    let userAgent = 'Mozilla/5.0 (Linux; Android 16; wv) Chrome/150.0.0.0 Mobile Safari/537.36';
    const navigations: string[] = [];
    const storage = new Map<string, string>();
    const values = {
        window: {},
        navigator: { get userAgent() { return userAgent; }, userActivation: { isActive: true } },
        location: { get href() { return url; }, set href(next: string) { navigations.push(next); } },
        document: { visibilityState: 'visible' },
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
        matchMedia: () => ({ matches: false }),
    };
    for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: values[key] });

    // A plain Android browser with the shell's query string is still refused.
    maybeRequestPlayReview(10);
    assert.equal(storage.size, 0, 'a browser without the token must never launch the native review');

    userAgent += ' ShinobiJourneyApp/1';
    for (let i = 0; i < 3; i++) maybeRequestPlayReview(10);
    // Same intent string as the TWA: the shell intercepts it, and older TWA
    // installs still need exactly this URL.
    assert.deepEqual(navigations, ['intent://review#Intent;scheme=shinobijourney;package=com.shinobijourney.app;end']);
});
