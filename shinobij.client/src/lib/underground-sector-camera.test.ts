import assert from 'node:assert/strict';
import { test } from 'node:test';
import { undergroundCamera, undergroundRenderWindow, undergroundRooms, undergroundTileSize } from './underground-sector-camera';
import { buildStrongholdTiles, STRONGHOLD_DIMS } from '../../../shared/sector-stronghold';

test('room bounds come from the same walkable tiles as the authoritative stronghold', () => {
    const rooms = undergroundRooms(buildStrongholdTiles(), STRONGHOLD_DIMS.width);
    assert.equal(rooms.size, 12);
    assert.deepEqual(rooms.get(0), { x: 2, y: 2, width: 7, height: 5 });
});
test('chambers fill the field at world scale on desktop and phone without changing tile counts', () => {
    const rooms = undergroundRooms(buildStrongholdTiles(), 37);
    assert(undergroundTileSize({ width: 1300, height: 650 }, rooms) >= 160);
    assert(undergroundTileSize({ width: 374, height: 440 }, rooms) >= 74);
    assert(undergroundTileSize({ width: 1076, height: 558 }, new Map([[0, { x: 1, y: 1, width: 5, height: 3 }]])) >= 180);
});
test('a small entry cavern remains spacious when the floor also has larger chambers', () => {
    const rooms = new Map([[0, { x: 1, y: 1, width: 5, height: 3 }], [1, { x: 8, y: 1, width: 9, height: 8 }]]);
    assert(undergroundTileSize({ width: 356, height: 380 }, rooms) >= 97);
});

test('desktop architecture framing shows both station rows from the chamber center; phones retain world scale', () => {
    const rooms = undergroundRooms(buildStrongholdTiles(), 37), view = { width: 1300, height: 650 };
    const tileSize = undergroundTileSize(view, rooms, true), room = rooms.get(0)!;
    const camera = undergroundCamera({ view, width: 37, height: 23, tileSize, room, playerX: 5, playerY: 4 });
    assert(room.y * tileSize + camera.y >= 0);
    assert((room.y + room.height) * tileSize + camera.y <= view.height);
    assert(tileSize >= 110, 'the complete room remains large enough to read');
    const phone = { width: 374, height: 440 };
    assert.equal(undergroundTileSize(phone, rooms, true), undergroundTileSize(phone, rooms));
});
test('room camera keeps the player in view at both walls of a room wider than the viewport', () => {
    const args = { view: { width: 390, height: 400 }, width: 37, height: 23, tileSize: 90,
        room: { x: 2, y: 2, width: 7, height: 5 }, playerY: 4 };
    for (const playerX of [2, 5, 8]) {
        const camera = undergroundCamera({ ...args, playerX });
        const screenX = (playerX + .5) * args.tileSize + camera.x;
        assert(screenX > 0 && screenX < args.view.width);
        assert(-camera.x >= args.tileSize);
        assert(-camera.x <= 10 * args.tileSize - args.view.width);
    }
});
test('a chamber axis that fits is centered independent of player position', () => {
    const args = { view: { width: 1000, height: 600 }, width: 25, height: 17, tileSize: 80,
        room: { x: 2, y: 2, width: 5, height: 3 }, playerY: 3 };
    assert.deepEqual(undergroundCamera({ ...args, playerX: 2 }), undergroundCamera({ ...args, playerX: 6 }));
});
test('passages use the whole-floor boundary and tiny floors remain centered', () => {
    const camera = undergroundCamera({ view: { width: 1000, height: 600 }, width: 5, height: 3, tileSize: 80, playerX: 0, playerY: 0 });
    assert.deepEqual(camera, { x: 300, y: 180 });
});

test('camera raster windows cover the screen and movement overscan at every world edge', () => {
    const view = { width: 320, height: 440 }, tileSize = 80, width = 37, height = 23;
    for (const [playerX, playerY] of [[0, 0], [18, 11], [36, 22], [0, 22], [36, 0]]) {
        const camera = undergroundCamera({ view, tileSize, width, height, playerX, playerY });
        const crop = undergroundRenderWindow({ view, tileSize, width, height, camera });
        assert(crop.left >= 0 && crop.top >= 0 && crop.left + crop.width <= width && crop.top + crop.height <= height);
        assert(crop.left * tileSize + camera.x <= 0);
        assert(crop.top * tileSize + camera.y <= 0);
        assert((crop.left + crop.width) * tileSize + camera.x >= view.width);
        assert((crop.top + crop.height) * tileSize + camera.y >= view.height);
        assert(crop.width * crop.height < width * height / 5, 'raster allocation is bounded by the phone, not the full dungeon');
        if (playerX === 18) assert(crop.left * tileSize <= -camera.x - tileSize && (crop.left + crop.width) * tileSize >= -camera.x + view.width + tileSize);
    }
});

test('cropping preserves exact screen coordinates of floor art and collision footprints', () => {
    const args = { view: { width: 390, height: 490 }, width: 37, height: 23, tileSize: 96, camera: { x: -1560, y: -864 } };
    const crop = undergroundRenderWindow(args), mapWidth = args.width * args.tileSize, mapHeight = args.height * args.tileSize;
    const svgLeft = crop.left / args.width * mapWidth, svgTop = crop.top / args.height * mapHeight;
    const svgWidth = crop.width / args.width * mapWidth, svgHeight = crop.height / args.height * mapHeight;
    for (const point of [[18, 10], [18.5, 10.5], [21, 13]]) {
        const projectedX = (point[0] - crop.left) / crop.width * svgWidth + svgLeft + args.camera.x;
        const projectedY = (point[1] - crop.top) / crop.height * svgHeight + svgTop + args.camera.y;
        assert(Math.abs(projectedX - (point[0] * args.tileSize + args.camera.x)) < 1e-8);
        assert(Math.abs(projectedY - (point[1] * args.tileSize + args.camera.y)) < 1e-8);
    }
});

test('unmeasured views defer terrain instead of rasterizing a full-size initial atlas', () => {
    assert.deepEqual(undergroundRenderWindow({ view: { width: 0, height: 0 }, width: 37, height: 23, tileSize: 96, camera: { x: 0, y: 0 } }), { left: 0, top: 0, width: 0, height: 0 });
});
