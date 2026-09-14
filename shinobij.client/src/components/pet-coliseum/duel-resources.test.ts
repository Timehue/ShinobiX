import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { PET_VISUAL_QUALITY_PRESETS } from "../../lib/pet-visual-quality";
import { cachedElementVolumeCurves, cachedHeroMoveStrokes, scheduleDuelFxGeometryPrewarm } from "./duel-resources";

function timerWindow(t: TestContext) {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    const pending = new Map<number, { callback: () => void; delay: number }>();
    let nextId = 0;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout(callback: () => void, delay: number) {
                pending.set(++nextId, { callback, delay });
                return nextId;
            },
            clearTimeout(id: number) { pending.delete(id); },
        },
    });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, "window", original);
        else Reflect.deleteProperty(globalThis, "window");
    });
    const takeNext = () => {
        const next = pending.entries().next().value;
        assert.ok(next, "prewarm must have a pending slice");
        pending.delete(next[0]);
        return next[1];
    };
    return { pending, takeNext };
}

test("element effects share immutable geometry across callers without mixing phases", () => {
    const contact = cachedElementVolumeCurves("water", "contact", 3);
    let disposed = 0;
    for (const geometry of contact) geometry.addEventListener("dispose", () => { disposed++; });

    const aftermath = cachedElementVolumeCurves("water", "aftermath", 3);
    const largerContact = cachedElementVolumeCurves("water", "contact", 4);
    assert.notStrictEqual(aftermath, contact);
    assert.notStrictEqual(largerContact, contact);
    assert.strictEqual(cachedElementVolumeCurves("water", "contact", 3), contact);
    assert.ok(Object.isFrozen(contact));
    assert.equal(disposed, 0, "another effect must not dispose shared contact geometry");
});

test("hero strokes reuse their quality-specific cache when quality changes back", () => {
    const low = cachedHeroMoveStrokes("avian-dive", "low");
    const high = cachedHeroMoveStrokes("avian-dive", "high");
    assert.notStrictEqual(low, high);
    assert.ok(high.length > low.length);
    assert.ok(Object.isFrozen(low));
    assert.ok(Object.isFrozen(high));
    assert.strictEqual(cachedHeroMoveStrokes("avian-dive", "low"), low);
    assert.strictEqual(cachedHeroMoveStrokes("avian-dive", "high"), high);
});

test("leaving before prewarm begins cancels queued and late-delivered work", (t) => {
    const { pending, takeNext } = timerWindow(t);
    const cancel = scheduleDuelFxGeometryPrewarm(["lightning"], PET_VISUAL_QUALITY_PRESETS.low);
    const first = takeNext();
    cancel();
    first.callback(); // A callback already dequeued by the browser can still arrive.
    assert.equal(pending.size, 0);
});

test("leaving during sliced prewarm cancels its successor and keeps warmed geometry reusable", (t) => {
    const { pending, takeNext } = timerWindow(t);
    const cancel = scheduleDuelFxGeometryPrewarm(["abyss"], PET_VISUAL_QUALITY_PRESETS.low);
    takeNext().callback();
    assert.equal(pending.size, 1, "prewarm must yield between geometry batches");
    const next = [...pending.values()][0];
    const warmed = cachedElementVolumeCurves("abyss", "contact", 2);
    cancel();
    assert.equal(pending.size, 0, "cleanup must clear the next scheduled slice");
    next.callback();
    assert.equal(pending.size, 0, "a late slice must not restart a cancelled prewarm");
    assert.strictEqual(cachedElementVolumeCurves("abyss", "contact", 2), warmed);
});
