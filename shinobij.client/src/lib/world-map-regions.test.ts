import assert from "node:assert/strict";
import test from "node:test";
import { ATLAS_SECTOR_POINTS } from "../data/sector-points";
import {
    WORLD_MAP_ASPECT_RATIO,
    WORLD_MAP_REGIONS,
    getWorldMapRegionForPoint,
    getWorldMapRegionView,
} from "./world-map-regions";

type Size = { w: number; h: number };
type Point = { id: number | string; x: number; y: number };
type Rectangle = { left: number; right: number; top: number; bottom: number };

const TOUCH_RADIUS = 22;
const EPSILON = 0.000001;
const mapSizes: Size[] = [
    ...[280, 320, 360, 430].flatMap((w) => [180, 240, 320, 500, 700].map((h) => ({ w, h }))),
    ...[500, 640, 740, 850].flatMap((w) => [120, 150, 180, 240, 350].map((h) => ({ w, h }))),
    ...[700, 800, 1000].flatMap((w) => [400, 600, 900].map((h) => ({ w, h }))),
];

// These are the interactive crests in WorldMap, in addition to numbered sectors.
const landmarks: Point[] = [
    { id: "Stormveil Village", x: 16, y: 74 },
    { id: "Ashen Leaf Village", x: 16, y: 20 },
    { id: "Frostfang Village", x: 76, y: 20 },
    { id: "Moonshadow Village", x: 86, y: 64 },
    { id: "Central", x: 48, y: 40 },
    { id: "Hollow Gate", x: 63, y: 65 },
];

function cameras(size: Size) {
    return WORLD_MAP_REGIONS.map((region) => getWorldMapRegionView(size, region.id));
}

function contains(rectangle: Rectangle, x: number, y: number) {
    return x >= rectangle.left - EPSILON && x <= rectangle.right + EPSILON
        && y >= rectangle.top - EPSILON && y <= rectangle.bottom + EPSILON;
}

function visibleSourceRectangles(size: Size): Rectangle[] {
    return cameras(size).map(({ zoom, tx, ty }) => {
        const width = size.w * zoom;
        const height = width / WORLD_MAP_ASPECT_RATIO;
        return {
            left: Math.max(0, -tx / width),
            right: Math.min(1, (size.w - tx) / width),
            top: Math.max(0, -ty / height),
            bottom: Math.min(1, (size.h - ty) / height),
        };
    });
}

test("region controls follow the six map positions in reading order", () => {
    assert.deepEqual(WORLD_MAP_REGIONS.map(({ id, column, row }) => ({ id, column, row })), [
        { id: "ashen", column: 0, row: 0 },
        { id: "gate", column: 1, row: 0 },
        { id: "frost", column: 2, row: 0 },
        { id: "storm", column: 0, row: 1 },
        { id: "central", column: 1, row: 1 },
        { id: "moon", column: 2, row: 1 },
    ]);
    for (const region of WORLD_MAP_REGIONS) {
        assert.equal(getWorldMapRegionForPoint((region.column + 0.5) * 100 / 3, (region.row + 0.5) * 50), region.id);
    }
    assert.equal(getWorldMapRegionForPoint(0, 0), "ashen");
    assert.equal(getWorldMapRegionForPoint(100, 0), "frost");
    assert.equal(getWorldMapRegionForPoint(0, 100), "storm");
    assert.equal(getWorldMapRegionForPoint(100, 100), "moon");
});

test("six cameras cover every part of the source painting across mobile map sizes", () => {
    assert.equal(WORLD_MAP_ASPECT_RATIO, 1672 / 941);
    for (const size of mapSizes) {
        const rectangles = visibleSourceRectangles(size);
        // Rectangle edges partition the painting into cells. Coverage is constant
        // inside each cell, so checking every cell proves the union has no holes.
        const xEdges = [...new Set([0, 1, ...rectangles.flatMap(({ left, right }) => [left, right])])].sort((a, b) => a - b);
        const yEdges = [...new Set([0, 1, ...rectangles.flatMap(({ top, bottom }) => [top, bottom])])].sort((a, b) => a - b);
        for (let xIndex = 1; xIndex < xEdges.length; xIndex++) {
            for (let yIndex = 1; yIndex < yEdges.length; yIndex++) {
                const x = (xEdges[xIndex - 1] + xEdges[xIndex]) / 2;
                const y = (yEdges[yIndex - 1] + yEdges[yIndex]) / 2;
                assert.ok(rectangles.some((rectangle) => contains(rectangle, x, y)), `${size.w}x${size.h} leaves source point ${x},${y} uncovered`);
            }
        }
        for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            assert.ok(rectangles.some((rectangle) => contains(rectangle, x, y)), `${size.w}x${size.h} clips source corner ${x},${y}`);
        }
    }
});

test("all 67 sectors and interactive landmarks fit a full 44px touch target in at least one region", () => {
    assert.equal(ATLAS_SECTOR_POINTS.length, 67);
    const missing: string[] = [];
    for (const size of mapSizes) {
        const views = cameras(size);
        for (const point of [...ATLAS_SECTOR_POINTS, ...landmarks]) {
            const fits = views.some(({ zoom, tx, ty }) => {
                const x = tx + point.x / 100 * size.w * zoom;
                const y = ty + point.y / 100 * size.w * zoom / WORLD_MAP_ASPECT_RATIO;
                return x >= TOUCH_RADIUS - EPSILON && x <= size.w - TOUCH_RADIUS + EPSILON
                    && y >= TOUCH_RADIUS - EPSILON && y <= size.h - TOUCH_RADIUS + EPSILON;
            });
            if (!fits) missing.push(`${size.w}x${size.h}: ${point.id}`);
        }
    }
    assert.deepEqual(missing, [], "A destination must never be stranded outside every region's touchable area");
});

test("rotation and letterboxing use one scale and keep each map axis in bounds", () => {
    for (const size of mapSizes) {
        const views = cameras(size);
        const scale = views[0].zoom;
        for (const { zoom, tx, ty } of views) {
            assert.equal(zoom, scale, `${size.w}x${size.h} changes scale between regions`);
            assert.ok(Number.isFinite(zoom) && zoom > 0);
            assert.ok(Number.isFinite(tx) && Number.isFinite(ty));
            const width = size.w * zoom;
            const height = width / WORLD_MAP_ASPECT_RATIO;
            if (width <= size.w) assert.ok(Math.abs(tx - (size.w - width) / 2) <= EPSILON);
            if (height <= size.h) assert.ok(Math.abs(ty - (size.h - height) / 2) <= EPSILON);
        }
    }
});

test("unmeasured and transient tiny map boxes do not produce invalid transforms", () => {
    for (const size of [{ w: 0, h: 0 }, { w: 320, h: 0 }, { w: 0, h: 480 }, { w: 1, h: 1 }, { w: 20, h: 20 }]) {
        for (const view of cameras(size)) {
            assert.ok(Number.isFinite(view.zoom) && view.zoom > 0, `${size.w}x${size.h}: invalid zoom`);
            assert.ok(Number.isFinite(view.tx) && Number.isFinite(view.ty), `${size.w}x${size.h}: invalid translation`);
        }
    }
});
