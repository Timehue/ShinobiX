import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { takeWarmImage, warmLifePainting, warmWorldFloors, worldFloorSource, worldTerrainSource } from './world-floor-warm';

type Settle = { resolve: () => void; reject: () => void };
/** A browser Image whose decode() settles when the test says so. */
async function withImages(run: (decodes: Settle[], made: () => number) => Promise<void> | void, { decode = true } = {}) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Image'), decodes: Settle[] = [];
    let made = 0;
    class FakeImage {
        src = '';
        decode?: () => Promise<void>;
        constructor() {
            made++;
            if (decode) this.decode = () => new Promise<void>((resolve, reject) => decodes.push({ resolve, reject: () => reject(new Error('decode failed')) }));
        }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
    try { await run(decodes, () => made); }
    finally { if (original) Object.defineProperty(globalThis, 'Image', original); else Reflect.deleteProperty(globalThis, 'Image'); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a warmed floor and its biome ground are handed over once, and only after they decode', () => withImages(async decodes => {
    warmWorldFloors(9);
    warmWorldFloors(9);
    assert.equal(decodes.length, 2, 'the floor and the ground start decoding during the wait');
    assert.equal(takeWarmImage(worldFloorSource(9)), undefined, 'an undecoded floor is not handed over');
    decodes.forEach(decode => decode.resolve()); await tick();
    assert.equal(takeWarmImage(worldFloorSource(9))?.src, worldFloorSource(9));
    assert.equal(takeWarmImage(worldFloorSource(9)), undefined, 'handed over once: the renderer owns it now');
    assert.ok(takeWarmImage(worldTerrainSource(9)));
}));

test('a failed decode is forgotten, so the renderer loads that floor as before', () => withImages(async decodes => {
    warmWorldFloors(12);
    decodes[0]!.reject(); decodes[1]!.resolve(); await tick();
    assert.equal(takeWarmImage(worldFloorSource(12)), undefined);
    assert.ok(takeWarmImage(worldTerrainSource(12)));
}));

test('decoded art nobody takes is released after 30 s, and older engines only request it', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        await withImages(async decodes => {
            warmLifePainting('quiet-v1');
            decodes[0]!.resolve(); await tick();
            mock.timers.tick(30_000);
            assert.equal(takeWarmImage('/sector-life/quiet-v1.webp'), undefined, 'decoded art does not stay held');
        });
    } finally { mock.timers.reset(); }
    await withImages((_decodes, made) => {
        warmWorldFloors(9);
        assert.equal(made(), 2, 'the requests still go out');
        assert.equal(takeWarmImage(worldFloorSource(9)), undefined, 'but nothing is held without decode()');
    }, { decode: false });
});
