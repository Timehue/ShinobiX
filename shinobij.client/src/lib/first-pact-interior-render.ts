import {
    FirstPactInteriorTile,
    firstPactInteriorDoor,
    firstPactInteriorSize,
    firstPactInteriorTileAt,
    type FirstPactInterior,
} from "./first-pact-interiors";
import { FIRST_PACT_TILE_SIZE, type FirstPactPoint } from "./first-pact-world";

export type FirstPactInteriorCamera = { x: number; y: number; width: number; height: number };

/** Deterministic per-cell jitter, so a room renders identically every frame. */
function cellNoise(x: number, y: number, salt: number): number {
    const hashed = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
    return hashed - Math.floor(hashed);
}

/**
 * Centres a room that fits, and follows the player in one that does not.
 *
 * A phone viewport is narrower than every room in the city, so a camera that
 * always centres would let the player walk straight off the screen. On the axis
 * that does not fit, the camera tracks the player and clamps to the room's own
 * walls, so the room edge is the furthest the view ever travels.
 */
export function firstPactInteriorCamera(
    interior: FirstPactInterior,
    viewport: { width: number; height: number },
    follow?: FirstPactPoint,
): FirstPactInteriorCamera {
    const { width, height } = firstPactInteriorSize(interior);
    const roomWidth = width * FIRST_PACT_TILE_SIZE;
    const roomHeight = height * FIRST_PACT_TILE_SIZE;
    const axis = (room: number, view: number, at: number | undefined) => {
        if (room <= view || at == null) return (room - view) / 2;
        const centred = (at + .5) * FIRST_PACT_TILE_SIZE - view / 2;
        return Math.max(0, Math.min(room - view, centred));
    };
    return {
        x: axis(roomWidth, viewport.width, follow?.x),
        y: axis(roomHeight, viewport.height, follow?.y),
        width: viewport.width,
        height: viewport.height,
    };
}

function drawFloorSlab(context: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    const shade = cellNoise(x, y, 11);
    context.fillStyle = `hsl(30 13% ${19 + shade * 5}%)`;
    context.fillRect(sx, sy, size, size);
    // Grout, drawn on two edges only so slabs read as laid rather than tiled.
    context.strokeStyle = "rgba(0,0,0,.46)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(sx + .5, sy + .5);
    context.lineTo(sx + size - .5, sy + .5);
    context.moveTo(sx + .5, sy + .5);
    context.lineTo(sx + .5, sy + size - .5);
    context.stroke();
    context.strokeStyle = "rgba(255,226,180,.085)";
    context.beginPath();
    context.moveTo(sx + 1.5, sy + size - 1.5);
    context.lineTo(sx + size - 1.5, sy + size - 1.5);
    context.stroke();
    if (shade > .82) {
        context.fillStyle = "rgba(255,214,150,.035)";
        context.fillRect(sx + 6, sy + 7, size - 14, size - 16);
    }
}

function drawMat(context: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    context.fillStyle = "hsl(64 16% 26%)";
    context.fillRect(sx, sy, size, size);
    const woven = (x + y) % 2 === 0;
    context.strokeStyle = "rgba(0,0,0,.16)";
    context.lineWidth = 1;
    context.beginPath();
    for (let offset = 4; offset < size; offset += 5) {
        if (woven) {
            context.moveTo(sx + offset, sy + 2);
            context.lineTo(sx + offset, sy + size - 2);
        } else {
            context.moveTo(sx + 2, sy + offset);
            context.lineTo(sx + size - 2, sy + offset);
        }
    }
    context.stroke();
    // Binding: only on the mat's outer edges, so a run of mats reads as one court.
    context.strokeStyle = "rgba(24,18,10,.75)";
    context.lineWidth = 2;
    context.strokeRect(sx + 1, sy + 1, size - 2, size - 2);
}

function drawWall(
    context: CanvasRenderingContext2D,
    interior: FirstPactInterior,
    x: number,
    y: number,
    sx: number,
    sy: number,
): void {
    const size = FIRST_PACT_TILE_SIZE;
    context.fillStyle = `hsl(28 9% ${25 + cellNoise(x, y, 41) * 5}%)`;
    context.fillRect(sx, sy, size, size);
    // Coursed stone, offset every other row.
    const offset = y % 2 === 0 ? 0 : size / 2;
    context.strokeStyle = "rgba(0,0,0,.62)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(sx, sy + size / 2 + .5);
    context.lineTo(sx + size, sy + size / 2 + .5);
    context.moveTo(sx + offset + .5, sy);
    context.lineTo(sx + offset + .5, sy + size / 2);
    context.moveTo(sx + ((offset + size / 2) % size) + .5, sy + size / 2);
    context.lineTo(sx + ((offset + size / 2) % size) + .5, sy + size);
    context.stroke();
    context.fillStyle = `rgba(226,198,158,${.05 + cellNoise(x, y, 29) * .06})`;
    context.fillRect(sx, sy, size, size);
    // The face the room's light actually reaches: the inner lip of the shell.
    const openBelow = firstPactInteriorTileAt(interior, x, y + 1) !== FirstPactInteriorTile.Wall
        && firstPactInteriorTileAt(interior, x, y + 1) !== FirstPactInteriorTile.Void;
    if (openBelow) {
        const lip = context.createLinearGradient(0, sy + size - 12, 0, sy + size);
        lip.addColorStop(0, "rgba(0,0,0,0)");
        lip.addColorStop(1, "rgba(255,206,142,.16)");
        context.fillStyle = lip;
        context.fillRect(sx, sy + size - 12, size, 12);
        context.fillStyle = "rgba(0,0,0,.45)";
        context.fillRect(sx, sy + size - 2, size, 2);
    }
}

function drawShelf(context: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    const grain = cellNoise(x, y, 17);
    const inset = 2 + Math.round(grain * 2);
    const timber = 15 + grain * 8;
    context.fillStyle = "rgba(0,0,0,.42)";
    context.fillRect(sx + inset + 1, sy + size - 7, size - inset * 2 - 2, 7);
    context.fillStyle = `hsl(${24 + grain * 8} 30% ${timber}%)`;
    context.fillRect(sx + inset, sy + 3, size - inset * 2, size - 8);
    context.fillStyle = `hsl(${24 + grain * 8} 32% ${timber + 6}%)`;
    context.fillRect(sx + inset, sy + 3, size - inset * 2, 4);
    // Some racks stand emptied; a wall of identical full shelves reads as wallpaper.
    const emptyShelf = cellNoise(x, y, 63) > .78 ? 1 : -1;
    for (let shelf = 0; shelf < 2; shelf += 1) {
        const shelfY = sy + 12 + shelf * 15;
        context.fillStyle = "rgba(0,0,0,.5)";
        context.fillRect(sx + inset + 2, shelfY + 10, size - inset * 2 - 4, 2);
        if (shelf === emptyShelf) continue;
        const rolls = cellNoise(x, y, 91) > .6 ? 4 : 5;
        const step = (size - inset * 2 - 6) / rolls;
        for (let roll = 0; roll < rolls; roll += 1) {
            const rollX = sx + inset + 3 + roll * step;
            const tint = cellNoise(x * 7 + roll, y * 3 + shelf, 5);
            context.fillStyle = `hsl(${38 + tint * 14} ${22 + tint * 16}% ${34 + tint * 16}%)`;
            context.fillRect(rollX, shelfY + 1, step - 2.2, 9);
            context.fillStyle = "rgba(255,232,190,.18)";
            context.fillRect(rollX, shelfY + 1, step - 2.2, 2);
        }
    }
    context.strokeStyle = "rgba(0,0,0,.55)";
    context.lineWidth = 1;
    context.strokeRect(sx + inset + .5, sy + 3.5, size - inset * 2 - 1, size - 9);
}

function drawTable(context: CanvasRenderingContext2D, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    context.fillStyle = "rgba(0,0,0,.44)";
    context.beginPath();
    context.ellipse(sx + size / 2, sy + size - 7, size * .42, 7, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "hsl(28 26% 20%)";
    context.fillRect(sx + 5, sy + 10, size - 10, size - 22);
    context.fillStyle = "hsl(30 28% 26%)";
    context.fillRect(sx + 5, sy + 10, size - 10, 5);
    context.strokeStyle = "rgba(0,0,0,.5)";
    context.lineWidth = 1;
    context.strokeRect(sx + 5.5, sy + 10.5, size - 11, size - 23);
    context.fillStyle = "rgba(255,222,170,.10)";
    context.fillRect(sx + 9, sy + 18, size - 18, 6);
}

function drawHearth(context: CanvasRenderingContext2D, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    const cx = sx + size / 2;
    const cy = sy + size / 2;
    context.fillStyle = "hsl(24 10% 15%)";
    context.beginPath();
    context.arc(cx, cy, size * .42, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(0,0,0,.6)";
    context.lineWidth = 3;
    context.stroke();
    const ember = context.createRadialGradient(cx, cy, 1, cx, cy, size * .38);
    ember.addColorStop(0, "rgba(255,214,140,.95)");
    ember.addColorStop(.45, "rgba(226,122,48,.55)");
    ember.addColorStop(1, "rgba(120,40,10,0)");
    context.fillStyle = ember;
    context.beginPath();
    context.arc(cx, cy, size * .38, 0, Math.PI * 2);
    context.fill();
}

function drawDais(context: CanvasRenderingContext2D, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    context.fillStyle = "hsl(32 12% 31%)";
    context.fillRect(sx + 1, sy + 1, size - 2, size - 2);
    context.fillStyle = "rgba(255,232,190,.10)";
    context.fillRect(sx + 1, sy + 1, size - 2, 5);
    context.strokeStyle = "rgba(255,206,132,.55)";
    context.lineWidth = 2;
    context.strokeRect(sx + 4.5, sy + 4.5, size - 9, size - 9);
    context.strokeStyle = "rgba(0,0,0,.5)";
    context.lineWidth = 1;
    context.strokeRect(sx + 1.5, sy + 1.5, size - 3, size - 3);
    context.strokeStyle = "rgba(255,196,110,.42)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(sx + size / 2, sy + size / 2, size * .22, 0, Math.PI * 2);
    context.stroke();
}

function drawPillar(context: CanvasRenderingContext2D, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    const cx = sx + size / 2;
    context.fillStyle = "rgba(0,0,0,.45)";
    context.beginPath();
    context.ellipse(cx, sy + size - 8, size * .34, 7, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "hsl(26 28% 18%)";
    context.fillRect(cx - size * .22, sy + 4, size * .44, size - 12);
    context.fillStyle = "rgba(255,224,178,.13)";
    context.fillRect(cx - size * .22, sy + 4, size * .13, size - 12);
    context.fillStyle = "hsl(28 24% 24%)";
    context.fillRect(cx - size * .30, sy + 2, size * .60, 6);
    context.strokeStyle = "rgba(0,0,0,.5)";
    context.lineWidth = 1;
    context.strokeRect(cx - size * .22 + .5, sy + 4.5, size * .44, size - 13);
}

function drawDoor(context: CanvasRenderingContext2D, sx: number, sy: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    context.fillStyle = "hsl(26 14% 11%)";
    context.fillRect(sx, sy, size, size);
    // Street light falling in, which is what tells the player this is the way out.
    const spill = context.createLinearGradient(0, sy + size, 0, sy - size * .4);
    spill.addColorStop(0, "rgba(255,206,140,.44)");
    spill.addColorStop(1, "rgba(255,206,140,0)");
    context.fillStyle = spill;
    context.fillRect(sx, sy - size * .4, size, size * 1.4);
    context.fillStyle = "hsl(28 30% 20%)";
    context.fillRect(sx + 1, sy + 2, 5, size - 4);
    context.fillRect(sx + size - 6, sy + 2, 5, size - 4);
}

/** The one object the room is built around, drawn so it cannot be mistaken
 * for ordinary shelving even before the player is close enough to light it. */
function drawFocusCase(context: CanvasRenderingContext2D, sx: number, sy: number, lit: boolean): void {
    const size = FIRST_PACT_TILE_SIZE;
    context.fillStyle = "rgba(0,0,0,.5)";
    context.fillRect(sx + 2, sy + size - 8, size - 4, 8);
    context.fillStyle = "hsl(30 22% 26%)";
    context.fillRect(sx + 3, sy + 5, size - 6, size - 12);
    context.fillStyle = "hsl(34 26% 34%)";
    context.fillRect(sx + 3, sy + 5, size - 6, 5);
    // A glazed case: the pale plate is the page, the brass frame holds it.
    const glass = context.createLinearGradient(sx, sy + 10, sx + size, sy + size - 10);
    glass.addColorStop(0, lit ? "rgba(214,240,255,.72)" : "rgba(206,224,240,.34)");
    glass.addColorStop(1, lit ? "rgba(150,206,244,.42)" : "rgba(140,170,196,.16)");
    context.fillStyle = glass;
    context.fillRect(sx + 8, sy + 12, size - 16, size - 26);
    context.strokeStyle = lit ? "rgba(255,224,168,.95)" : "rgba(226,186,120,.62)";
    context.lineWidth = 2;
    context.strokeRect(sx + 8, sy + 12, size - 16, size - 26);
    context.strokeStyle = "rgba(0,0,0,.5)";
    context.lineWidth = 1;
    context.strokeRect(sx + 3.5, sy + 5.5, size - 7, size - 13);
}

export type FirstPactInteriorRenderOptions = {
    /** Highlighted when the player stands next to it. */
    focusLit?: boolean;
};

export function renderFirstPactInterior(
    canvas: HTMLCanvasElement,
    interior: FirstPactInterior,
    camera: FirstPactInteriorCamera,
    options: FirstPactInteriorRenderOptions = {},
): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(camera.width * ratio);
    const pixelHeight = Math.round(camera.height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    context.fillStyle = "#07060a";
    context.fillRect(0, 0, camera.width, camera.height);

    const { width, height } = firstPactInteriorSize(interior);
    const size = FIRST_PACT_TILE_SIZE;
    const originX = -camera.x;
    const originY = -camera.y;

    // A soft floor-plate shadow so the room sits on the dark rather than floating.
    context.fillStyle = "rgba(0,0,0,.55)";
    context.fillRect(originX - 18, originY - 18, width * size + 36, height * size + 36);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const sx = originX + x * size;
            const sy = originY + y * size;
            if (sx + size < 0 || sy + size < 0 || sx > camera.width || sy > camera.height) continue;
            const tile = firstPactInteriorTileAt(interior, x, y);
            if (tile === FirstPactInteriorTile.Wall) { drawWall(context, interior, x, y, sx, sy); continue; }
            if (tile === FirstPactInteriorTile.Door) { drawDoor(context, sx, sy); continue; }
            if (tile === FirstPactInteriorTile.Mat) { drawMat(context, x, y, sx, sy); continue; }
            drawFloorSlab(context, x, y, sx, sy);
            if (x === interior.focus.position.x && y === interior.focus.position.y) {
                drawFocusCase(context, sx, sy, options.focusLit === true);
                continue;
            }
            if (tile === FirstPactInteriorTile.Shelf) drawShelf(context, x, y, sx, sy);
            else if (tile === FirstPactInteriorTile.Table) drawTable(context, sx, sy);
            else if (tile === FirstPactInteriorTile.Hearth) drawHearth(context, sx, sy);
            else if (tile === FirstPactInteriorTile.Dais) drawDais(context, sx, sy);
            else if (tile === FirstPactInteriorTile.Pillar) drawPillar(context, sx, sy);
        }
    }

    // Warm pools under every fire, laid over the furnishings so light wraps them.
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const tile = firstPactInteriorTileAt(interior, x, y);
            if (tile !== FirstPactInteriorTile.Hearth && tile !== FirstPactInteriorTile.Dais) continue;
            const cx = originX + (x + .5) * size;
            const cy = originY + (y + .5) * size;
            const reach = tile === FirstPactInteriorTile.Hearth ? size * 3.1 : size * 2.4;
            const pool = context.createRadialGradient(cx, cy, size * .2, cx, cy, reach);
            pool.addColorStop(0, tile === FirstPactInteriorTile.Hearth ? "rgba(255,178,92,.30)" : "rgba(255,206,140,.18)");
            pool.addColorStop(1, "rgba(255,150,60,0)");
            context.fillStyle = pool;
            context.beginPath();
            context.arc(cx, cy, reach, 0, Math.PI * 2);
            context.fill();
        }
    }
    context.restore();

    if (options.focusLit) {
        const cx = originX + (interior.focus.position.x + .5) * size;
        const cy = originY + (interior.focus.position.y + .5) * size;
        context.save();
        context.globalCompositeOperation = "lighter";
        const halo = context.createRadialGradient(cx, cy, size * .1, cx, cy, size * 1.5);
        halo.addColorStop(0, "rgba(150,220,255,.34)");
        halo.addColorStop(1, "rgba(150,220,255,0)");
        context.fillStyle = halo;
        context.beginPath();
        context.arc(cx, cy, size * 1.5, 0, Math.PI * 2);
        context.fill();
        context.restore();
        context.strokeStyle = "rgba(176,232,255,.75)";
        context.lineWidth = 2;
        context.strokeRect(cx - size / 2 + 2, cy - size / 2 + 2, size - 4, size - 4);
    }

    // Cool spill along the shell, so warm lamplight has something to fall off into.
    const chill = context.createLinearGradient(originX, originY, originX, originY + height * size);
    chill.addColorStop(0, "rgba(96,132,176,.16)");
    chill.addColorStop(.45, "rgba(96,132,176,0)");
    chill.addColorStop(1, "rgba(70,104,150,.10)");
    context.fillStyle = chill;
    context.fillRect(originX, originY, width * size, height * size);

    // Vignette, matched to the exterior's night grade.
    const vignette = context.createRadialGradient(
        camera.width / 2, camera.height / 2, Math.min(camera.width, camera.height) * .32,
        camera.width / 2, camera.height / 2, Math.max(camera.width, camera.height) * .78,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,.72)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, camera.width, camera.height);

    canvas.setAttribute(
        "data-fp-interior-proof",
        JSON.stringify({
            interior: interior.id,
            width,
            height,
            door: firstPactInteriorDoor(interior),
            focus: interior.focus.position,
            focusLit: options.focusLit === true,
        }),
    );
}

/** Screen position for an actor standing on a room cell. */
export function firstPactInteriorActorOffset(point: FirstPactPoint, camera: FirstPactInteriorCamera): { x: number; y: number } {
    return {
        x: point.x * FIRST_PACT_TILE_SIZE + FIRST_PACT_TILE_SIZE / 2 - camera.x,
        y: point.y * FIRST_PACT_TILE_SIZE + FIRST_PACT_TILE_SIZE / 2 - camera.y,
    };
}
