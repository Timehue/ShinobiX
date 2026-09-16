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
