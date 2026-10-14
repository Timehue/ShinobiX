import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContinuousWorldRenderer } from './continuous-world-renderer';
import type { ContinuousWorldSpace } from '../../../shared/continuous-world-space';
import { sectorBiomeOf } from '../../../shared/sector-geo';
import { sectorWalkMask } from '../../../shared/sector-walk-mask';

type Fixture = { renderer: ReturnType<typeof createContinuousWorldRenderer>; canvas: { clientWidth: number }; images: { src: string; onload: (() => void) | null }[];
    counts: { paints: number; tilePaints: number; blits: number; canvases: number } };
/**
 * A renderer on fake canvases: `paints` counts screen repaints, `tilePaints` cached-tile rasters,
 * `blits` tiles copied to screen, `canvases` every offscreen canvas created. An image whose
 * src passes `arrived` is decoded at once; any other stays loading.
 */
function harness(run: (fixture: Fixture) => void, options: { chunks?: { sector: number; x: number; y: number }[]; arrived?: (src: string) => boolean } = {}) {
    const originals = ['Image', 'devicePixelRatio', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    const images: Fixture['images'] = [], arrived = options.arrived ?? (() => false);
    class FakeImage {
        complete = false; naturalWidth = 0; onload: (() => void) | null = null; #src = '';
        constructor() { images.push(this); }
        get src() { return this.#src; }
        set src(value: string) { this.#src = value; if (arrived(value)) { this.complete = true; this.naturalWidth = 1536; } }
    }
    const counts = { paints: 0, tilePaints: 0, blits: 0, canvases: 0 }, gradient = { addColorStop() {} };
    const fake = (methods: Record<string, () => unknown>) => new Proxy(methods, { get(target, key) { return target[key as string] ?? (() => {}); } });
    const screen = fake({ clearRect() { counts.paints++; }, drawImage() { counts.blits++; }, createRadialGradient() { return gradient; } });
    const tile = fake({ clearRect() { counts.tilePaints++; }, createRadialGradient() { return gradient; }, createLinearGradient() { return gradient; } });
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => { counts.canvases++; return { width: 0, height: 0, getContext: () => tile }; } } });
    const canvas = { clientWidth: 120, clientHeight: 120, width: 0, height: 0, getContext: () => screen };
    const space = { chunks: options.chunks ?? [{ sector: 9, x: 0, y: 0 }], roads: [] } as unknown as ContinuousWorldSpace;
    try {
        const renderer = createContinuousWorldRenderer(canvas as unknown as HTMLCanvasElement, space);
        run({ renderer, canvas, images, counts });
        renderer.dispose();
    } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}

/** Draws until a frame is reused: the ring of tiles off screen fills over the first few frames. */
function settle(renderer: ReturnType<typeof createContinuousWorldRenderer>, point: { x: number; y: number }, sector = 9) {
    let view = renderer.draw(point, sector);
    for (let frame = 0; frame < 60; frame++) { const next = renderer.draw(point, sector); if (next === view) return view; view = next; }
    assert.fail('the terrain never settled');
}

test('two maps of one biome settle while the shared ground material is still loading', () => {
    // Before, each map rebuilt the biome's ground field from its own art on every frame,
    // and each rebuild repainted the world: an idle screen never stopped drawing, and a
    // material that never loads (a dropped request) kept it drawing for good.
    const painted = Array.from({ length: 66 }, (_, i) => i + 1).filter(sector => sectorWalkMask(sector));
    const [a, b] = painted.flatMap(first => painted.filter(second => second > first && sectorBiomeOf(second) === sectorBiomeOf(first)).map(second => [first, second]))[0]!;
    harness(({ renderer, counts }) => {
        const point = { x: 12, y: 6 };
        const first = settle(renderer, point, a!), canvases = counts.canvases, paints = counts.paints;
        for (let frame = 0; frame < 120; frame++) assert.equal(renderer.draw(point, a!), first);
        assert.equal(counts.paints, paints, 'an idle frame repainted');
        assert.equal(counts.canvases, canvases, 'an idle frame built a canvas');
    }, { chunks: [{ sector: a!, x: 0, y: 0 }, { sector: b!, x: 12, y: 0 }], arrived: src => !src.includes('world-terrain') });
});

test('walking a long way keeps a bounded set of tile canvases', () => harness(({ renderer, counts }) => {
    settle(renderer, { x: 6, y: 6 });
    // Ten minutes of walking east and back: tiles are recycled, never piled up.
    for (let frame = 0; frame < 72_000; frame++) {
        const lap = (frame * 6.5 / 120) % 400;
        renderer.draw({ x: 6 + (lap < 200 ? lap : 400 - lap), y: 6 + Math.sin(frame / 500) * 30 }, 9);
    }
    // The largest ring a 120px screen can need: (ceil(120 / 256) + 3)² tiles.
    assert(counts.canvases <= 16, `${counts.canvases} tile canvases created`);
}));

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

test('a floor map decodes off the frame: a draw never decodes it or builds its painting', async () => {
    // Drawing a loaded-but-undecoded 1024px webp decodes it inside that frame, and
    // its feathered painting (a full-size canvas, two full-canvas fills) used to be
    // built by the same frame: one visible hitch per new map while walking.
    const originals = ['Image', 'devicePixelRatio', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    const images: DecodingImage[] = [];
    let built = 0, finishDecode!: () => void;
    const decoding = new Promise<void>(resolve => { finishDecode = resolve; });
    class DecodingImage {
        complete = false; naturalWidth = 0; onload: (() => void) | null = null; src = '';
        constructor() { images.push(this); }
        decode() { return decoding; }
        arrive() { this.complete = true; this.naturalWidth = 1536; this.onload?.(); }
    }
    const gradient = { addColorStop() {} };
    const fake = (methods: Record<string, (...args: unknown[]) => unknown>) => new Proxy(methods, { get(target, key) { return target[key as string] ?? (() => {}); } });
    const drawn: unknown[] = [];
    const screen = fake({ createRadialGradient() { return gradient; } });
    const surface = fake({ drawImage(source: unknown) { drawn.push(source); }, createRadialGradient() { return gradient; }, createLinearGradient() { return gradient; } });
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: DecodingImage });
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => { built++; return { width: 0, height: 0, getContext: () => surface }; } } });
    const canvas = { clientWidth: 120, clientHeight: 120, width: 0, height: 0, getContext: () => screen };
    const space = { chunks: [{ sector: 9, x: 0, y: 0 }], roads: [] } as unknown as ContinuousWorldSpace;
    try {
        const renderer = createContinuousWorldRenderer(canvas as unknown as HTMLCanvasElement, space);
        const point = { x: 6, y: 6 };
        settle(renderer, point);
        const map = images.find(image => !image.src.includes('world-terrain'))!;
        map.arrive();
        const canvasesBeforeDecode = built;
        drawn.length = 0;
        for (let frame = 0; frame < 5; frame++) renderer.draw({ x: 6 + frame * .05, y: 6 }, 9);
        assert.equal(drawn.includes(map), false, 'no frame draws (and so decodes) the map before its decode settles');
        assert.equal(built, canvasesBeforeDecode, 'no frame builds a painting before the decode settles');
        finishDecode();
        await decoding; await Promise.resolve();
        assert.equal(built, canvasesBeforeDecode + 1, 'the decode task builds the painting itself');
        // The biome's ground field and rock patch are then cut from the map once,
        // as before; after that, frames build nothing.
        settle(renderer, point);
        const settled = built;
        for (let frame = 0; frame < 60; frame++) renderer.draw(point, 9);
        assert.equal(built, settled, 'settled frames reuse the painting and the ground');
        assert.equal(drawn.includes(map), true, 'the decoded map is drawn');
        renderer.dispose();
    } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});