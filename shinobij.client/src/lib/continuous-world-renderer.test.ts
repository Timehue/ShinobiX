import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContinuousWorldRenderer } from './continuous-world-renderer';
import type { ContinuousWorldSpace } from '../../../shared/continuous-world-space';

/** A renderer on fake canvases: `paints` counts screen repaints, `tilePaints` cached-tile rasters, `blits` tiles copied to screen. */
function harness(run: (fixture: { renderer: ReturnType<typeof createContinuousWorldRenderer>; canvas: { clientWidth: number }; images: { onload: (() => void) | null }[];
    counts: { paints: number; tilePaints: number; blits: number } }) => void) {
    const originals = ['Image', 'devicePixelRatio', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    const images: { onload: (() => void) | null }[] = [];
    class FakeImage { complete = false; naturalWidth = 0; src = ''; onload: (() => void) | null = null; constructor() { images.push(this); } }
    const counts = { paints: 0, tilePaints: 0, blits: 0 }, gradient = { addColorStop() {} };
    const fake = (methods: Record<string, () => unknown>) => new Proxy(methods, { get(target, key) { return target[key as string] ?? (() => {}); } });
    const screen = fake({ clearRect() { counts.paints++; }, drawImage() { counts.blits++; }, createRadialGradient() { return gradient; } });
    const tile = fake({ clearRect() { counts.tilePaints++; }, createRadialGradient() { return gradient; } });
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => tile }) } });
    const canvas = { clientWidth: 120, clientHeight: 120, width: 0, height: 0, getContext: () => screen };
    const space = { chunks: [{ sector: 9, x: 0, y: 0 }], roads: [] } as unknown as ContinuousWorldSpace;
    try {
        const renderer = createContinuousWorldRenderer(canvas as unknown as HTMLCanvasElement, space);
        run({ renderer, canvas, images, counts });
        renderer.dispose();
    } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}

/** Draws until a frame is reused: the ring of tiles off screen fills over the first few frames. */
function settle(renderer: ReturnType<typeof createContinuousWorldRenderer>, point: { x: number; y: number }) {
    let view = renderer.draw(point, 9);
    for (let frame = 0; frame < 60; frame++) { const next = renderer.draw(point, 9); if (next === view) return view; view = next; }
    assert.fail('the terrain never settled');
}

test('idle terrain reuses its raster but camera, image arrivals and resize repaint', () => harness(({ renderer, canvas, images, counts }) => {
    const point = { x: 6, y: 6 };
    const first = settle(renderer, point), settled = counts.paints;
    for (let frame = 0; frame < 120; frame++) assert.equal(renderer.draw(point, 9), first);
    assert.equal(counts.paints, settled);
    renderer.draw({ x: 6.1, y: 6 }, 9); assert.equal(counts.paints, settled + 1);
    renderer.draw(point, 9); assert.equal(counts.paints, settled + 2);
    images[0]!.onload?.(); renderer.draw(point, 9); assert.equal(counts.paints, settled + 3);
    canvas.clientWidth = 240; assert.equal(renderer.draw(point, 9).tilePx, 20); assert.equal(counts.paints, settled + 4);
}));

test('walking copies cached terrain tiles instead of repainting the world', () => harness(({ renderer, images, counts }) => {
    settle(renderer, { x: 6, y: 6 });
    const warm = counts.tilePaints;
    assert(warm > 0 && warm <= 16, `${warm} tiles for the first frame and the ring around it`);
    // Three seconds of walking east, one frame at a time.
    counts.blits = 0;
    for (let frame = 1; frame <= 360; frame++) renderer.draw({ x: 6 + frame * 6.5 / 120, y: 6 }, 9);
    assert(counts.blits <= 360 * 4, `${counts.blits} tile copies: a 120px screen spans at most 2x2 tiles`);
    // About 20 cells walked = under one 25.6-cell tile: at most one new column of the ring.
    assert(counts.tilePaints - warm <= 4, `${counts.tilePaints - warm} tiles painted while walking`);
    // A map that arrives repaints the cached tiles, which then hold again.
    const before = counts.tilePaints;
    images[0]!.onload?.(); settle(renderer, { x: 30, y: 6 });
    assert(counts.tilePaints > before);
    const settled = counts.tilePaints;
    for (let frame = 0; frame < 10; frame++) renderer.draw({ x: 30, y: 6 }, 9);
    assert.equal(counts.tilePaints, settled);
}));
