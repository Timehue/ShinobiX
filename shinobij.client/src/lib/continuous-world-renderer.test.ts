import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContinuousWorldRenderer } from './continuous-world-renderer';
import type { ContinuousWorldSpace } from '../../../shared/continuous-world-space';

test('idle terrain reuses its raster but camera, image arrivals and resize repaint', () => {
    const originals = ['Image', 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    const images: { onload: (() => void) | null }[] = [];
    class FakeImage { complete = false; naturalWidth = 0; src = ''; onload: (() => void) | null = null; constructor() { images.push(this); } }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
    let paints = 0;
    const gradient = { addColorStop() {} };
    const context = new Proxy({ clearRect() { paints++; }, createRadialGradient() { return gradient; } },
        { get(target, key) { return target[key as keyof typeof target] ?? (() => {}); } });
    const canvas = { clientWidth: 120, clientHeight: 120, width: 0, height: 0, getContext: () => context };
    const space = { chunks: [{ sector: 9, x: 0, y: 0 }], roads: [] } as unknown as ContinuousWorldSpace;
    try {
        const renderer = createContinuousWorldRenderer(canvas as unknown as HTMLCanvasElement, space), point = { x: 6, y: 6 };
        const first = renderer.draw(point, 9);
        for (let frame = 0; frame < 120; frame++) assert.equal(renderer.draw(point, 9), first);
        assert.equal(paints, 1);
        renderer.draw({ x: 6.1, y: 6 }, 9); assert.equal(paints, 2);
        renderer.draw(point, 9); assert.equal(paints, 3);
        images[0]!.onload?.(); renderer.draw(point, 9); assert.equal(paints, 4);
        canvas.clientWidth = 240; assert.equal(renderer.draw(point, 9).tilePx, 20); assert.equal(paints, 5);
        renderer.dispose();
    } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
