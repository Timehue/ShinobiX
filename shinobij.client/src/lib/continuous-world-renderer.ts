import type { ContinuousWorldSpace, WorldChunk, WorldPoint } from '../../../shared/continuous-world-space';
import type { WorldNavigation } from '../../../shared/continuous-world-navigation';
import { sectorWalkMask } from '../../../shared/sector-walk-mask';
import { sectorBiomeOf } from '../../../shared/sector-geo';
import { sectorFloorImage } from './sector-floor-layout';
import { worldRoadCrossings } from '../../../shared/world-road-crossings';

const colors: Record<string, string> = { forest: '#495338', central: '#747052', snow: '#b5bdba', shadow: '#55505c', volcano: '#4a3d36' };
const hash = (x: number, y: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
/** Side of a cached terrain tile, in device pixels. */
const TILE = 256;

/** Nearby-only painted terrain. No simulation, authority, timers or DOM HUD live here. */
export function createContinuousWorldRenderer(canvas: HTMLCanvasElement, space: ContinuousWorldSpace,
    navigation: Pick<WorldNavigation, 'terrain' | 'boundaries' | 'walls'> = { terrain: { kind: () => 0 }, boundaries: [], walls: [] }) {
    const { terrain, boundaries, walls } = navigation;
    /** True when no walkable or painted ground lies within `r` cells: safe to draw closed terrain. */
    const closedAround = (x: number, y: number, r: number) => {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (terrain.kind(x + dx, y + dy)) return false;
        return true;
    };
    const output = canvas.getContext('2d')!;
    const images = new Map<number, HTMLImageElement>(), ground = new Map<string, HTMLCanvasElement>(), rock = new Map<string, HTMLCanvasElement>();
    const roadTextures = new Map<number, CanvasPattern>(), chunks = new Map(space.chunks.map(c => [c.sector, c]));
    const materials = new Map<string, HTMLImageElement>(), fieldSources = new Map<string, string>();
    const paintings = new Map<number, HTMLCanvasElement>();
    const crossings = worldRoadCrossings(space.roads);
    // The painted world never moves, only the camera does. It is rastered once into
    // fixed world tiles, so a walking frame copies a few tiles instead of repainting
    // every layer: that repaint was most of a phone's frame while walking.
    type Tile = { surface: HTMLCanvasElement; revision: number; i: number; j: number };
    const tiles = new Map<number, Tile>(), tileKey = (i: number, j: number) => (i + 4096) * 8192 + j + 4096;
    // Canvases leaving the ring are reused. A dropped canvas keeps its GPU memory until a
    // garbage collection, and a long walk churned through hundreds of them. Cached plus
    // spare canvases stay within the largest ring this screen can need, so walking makes
    // no new ones; a canvas over that is shrunk to nothing, which frees its memory at once.
    const spare: HTMLCanvasElement[] = [];
    let canvasBudget = 0;
    const shrink = (surface: HTMLCanvasElement) => { surface.width = surface.height = 0; };
    const release = (surface: HTMLCanvasElement) => { if (tiles.size + spare.length < canvasBudget) spare.push(surface); else shrink(surface); };
    let tileScale = 0, tileRange = NaN;
    // Read on resize, not per frame: a per-frame clientWidth forced a layout every frame.
    let width = canvas.clientWidth, height = canvas.clientHeight;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { width = canvas.clientWidth; height = canvas.clientHeight; });
    resize?.observe(canvas);
    let revision = 0, lastDraw = '';
    let lastView: { tilePx: number; chunk: WorldChunk; crossings: typeof crossings; x: number; y: number } | undefined;
    const material = (name: string) => { let image = materials.get(name); if (!image) { image = new Image(); image.onload = () => { revision++; }; image.src = `/sector-map/world-terrain/${name}.webp`; materials.set(name, image); } return image; };
    const roads = space.roads.map(r => ({ ...r, left: Math.min(...r.points.map(p => p.x)), right: Math.max(...r.points.map(p => p.x)),
        top: Math.min(...r.points.map(p => p.y)), bottom: Math.max(...r.points.map(p => p.y)) }));
    const nearestChunk = (x: number, y: number) => space.chunks.reduce((best, chunk) =>
        Math.hypot(chunk.x + 6 - x, chunk.y + 6 - y) < Math.hypot(best.x + 6 - x, best.y + 6 - y) ? chunk : best, space.chunks[0]!);
    const blockBiome = new Map<number, string>();
    const biomeNear = (x: number, y: number) => {
        const key = Math.floor(x / 4) * 4096 + Math.floor(y / 4);
        let biome = blockBiome.get(key);
        if (!biome) { biome = sectorBiomeOf(nearestChunk(Math.floor(x / 4) * 4 + 2, Math.floor(y / 4) * 4 + 2).sector); blockBiome.set(key, biome); }
        return biome;
    };
    const imageFor = (sector: number) => {
        let image = images.get(sector);
        if (!image) { image = new Image(); image.onload = () => { revision++; }; image.src = sectorFloorImage(sector); images.set(sector, image); }
        return image;
    };
    function painting(sector: number, image: HTMLImageElement) {
        let result = paintings.get(sector);
        if (!result) {
            result = document.createElement('canvas'); result.width = result.height = image.naturalWidth;
            const context = result.getContext('2d')!, size = result.width, feather = size / 12 * .65;
            context.drawImage(image, 0, 0); context.globalCompositeOperation = 'destination-in';
            for (const horizontal of [true, false]) {
                const fade = context.createLinearGradient(0, 0, horizontal ? size : 0, horizontal ? 0 : size);
                fade.addColorStop(0, '#fff0'); fade.addColorStop(feather / size, '#fff'); fade.addColorStop(1 - feather / size, '#fff'); fade.addColorStop(1, '#fff0');
                context.fillStyle = fade; context.fillRect(0, 0, size, size);
            }
            paintings.set(sector, result);
        }
        return result;
    }
    function patch(image: HTMLImageElement, tile: number, feather = false, span = 1) {
        const result = document.createElement('canvas'); result.width = result.height = 128 * span;
        const context = result.getContext('2d')!, size = image.naturalWidth / 12;
        context.drawImage(image, tile % 12 * size, Math.floor(tile / 12) * size, size * span, size * span, 0, 0, result.width, result.height);
        if (feather) {
            context.globalCompositeOperation = 'destination-in';
            const radius = result.width / 2;
            const gradient = context.createRadialGradient(radius, radius, radius * .75, radius, radius, radius); gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, '#fff0');
            context.fillStyle = gradient; context.fillRect(0, 0, result.width, result.height);
        }
        return result;
    }
    function texture(chunk: WorldChunk, image: HTMLImageElement) {
        const biome = sectorBiomeOf(chunk.sector), mask = sectorWalkMask(chunk.sector);
        if (!mask || !image.complete || !image.naturalWidth) return;
        const terrain = material(biome === 'snow' ? 'snow' : biome === 'volcano' || biome === 'shadow' ? 'cinder' : 'forest');
        const ready = terrain.complete && terrain.naturalWidth > 0, sourceKey = ready ? terrain.src : image.src;
        // Until the material arrives, the first map's stand-in holds. Each map of the biome
        // used to rebuild it from its own art in turn, every frame, so the screen never went
        // idle (and never would, had the material's request failed).
        if (fieldSources.get(biome) !== sourceKey && (ready || !fieldSources.has(biome))) {
            const candidates = mask.flatMap((row, y) => [...row].flatMap((c, x) => c === '.' ? [{ tile: y * 12 + x,
                score: [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => mask[y + dy]?.[x + dx] === '.' ? 1 : 0)).reduce<number>((a, b) => a + b, 0) }] : []));
            candidates.sort((a, b) => b.score - a.score);
            const tile = candidates[0]?.tile ?? 78, field = document.createElement('canvas'); field.width = field.height = 768;
            const fieldContext = field.getContext('2d')!;
            if (sourceKey === terrain.src) fieldContext.drawImage(terrain, 0, 0, 768, 768);
            else { const pattern = fieldContext.createPattern(patch(image, tile), 'repeat')!; fieldContext.fillStyle = pattern; fieldContext.fillRect(0, 0, 768, 768); }
            fieldContext.globalCompositeOperation = 'destination-in';
            const fade = fieldContext.createRadialGradient(384, 384, 310, 384, 384, 384); fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#fff0');
            fieldContext.fillStyle = fade; fieldContext.fillRect(0, 0, 768, 768);
            const replaced = ground.get(biome); if (replaced) shrink(replaced);
            ground.set(biome, field); fieldSources.set(biome, sourceKey);
            let cliff = 0, score = -1;
            for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
                const rank = [0, 1, 2].flatMap(dy => [0, 1, 2].map(dx => mask[y + dy]?.[x + dx] === '#' ? 1 : 0)).reduce<number>((a, b) => a + b, 0);
                if (rank > score) { score = rank; cliff = y * 12 + x; }
            }
            if (score > 0) { const old = rock.get(biome); if (old) shrink(old); rock.set(biome, patch(image, cliff, true, 3)); }
            revision++;
        }
    }
    /** Paints the world rectangle [left, right) x [top, bottom) through `ctx`, already in world units. */
    function paint(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number) {
        const visible = space.chunks.filter(c => c.x < right + 2 && c.x + 12 > left - 2 && c.y < bottom + 2 && c.y + 12 > top - 2);
        // Overlapping feathered fields have fixed world coordinates and blend biome boundaries.
        ctx.fillStyle = '#3b4238'; ctx.fillRect(left, top, right - left, bottom - top);
        for (let y = Math.floor(top / 8) * 8 - 8; y < bottom + 8; y += 8) for (let x = Math.floor(left / 8) * 8 - 8; x < right + 8; x += 8) {
            const biome = sectorBiomeOf(nearestChunk(x, y).sector), field = ground.get(biome);
            if (field) ctx.drawImage(field, x - 8, y - 8, 16, 16);
            else { const fade = ctx.createRadialGradient(x, y, 5.5, x, y, 8); fade.addColorStop(0, colors[biome]!); fade.addColorStop(1, `${colors[biome]}00`); ctx.fillStyle = fade; ctx.fillRect(x - 8, y - 8, 16, 16); }
        }
        // Closed terrain is visible as organic cliff clusters; open land and roads stay clear.
        for (let y = Math.floor(top / 3) * 3 - 3; y < bottom + 3; y += 3) for (let x = Math.floor(left / 3) * 3 - 3; x < right + 3; x += 3) {
            const n = hash(x, y), px = x + n * 1.3, py = y + hash(y, x) * 1.3;
            if (!closedAround(Math.floor(px), Math.floor(py), 2)) continue;
            const sprite = rock.get(biomeNear(px, py)); if (!sprite) continue;
            const size = 3.6 + n * .5; ctx.save(); ctx.translate(px, py); ctx.rotate(Math.floor(n * 4) * Math.PI / 2); ctx.drawImage(sprite, -size / 2, -size / 2, size, size); ctx.restore();
        }
        // A rocky rim on closed ground beside open land, so every edge reads as a wall.
        for (let y = Math.floor(top) - 1; y < bottom + 1; y++) for (let x = Math.floor(left) - 1; x < right + 1; x++) {
            if (terrain.kind(x, y) || closedAround(x, y, 1)) continue;
            const sprite = rock.get(biomeNear(x, y)); if (!sprite) continue;
            const n = hash(x, y), size = 1.55 + n * .45;
            ctx.save(); ctx.translate(x + .5 + (n - .5) * .3, y + .5 + (hash(y, x) - .5) * .3); ctx.rotate(Math.floor(n * 4) * Math.PI / 2);
            ctx.drawImage(sprite, -size / 2, -size / 2, size, size); ctx.restore();
        }
        for (const road of roads) {
            if (road.left > right + 2 || road.right < left - 2 || road.top > bottom + 2 || road.bottom < top - 2) continue;
            const image = images.get(road.a.sector) ?? images.get(road.b.sector);
            const source = images.has(road.a.sector) ? road.a : road.b;
            let pattern = roadTextures.get(source.sector);
            if (!pattern && image?.complete && image.naturalWidth) { pattern = ctx.createPattern(patch(image, source.tile), 'repeat')!; pattern.setTransform(new DOMMatrix().scale(1 / 128)); roadTextures.set(source.sector, pattern); }
            ctx.beginPath(); road.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.strokeStyle = '#28291f66'; ctx.lineWidth = 1.45; ctx.stroke(); ctx.strokeStyle = pattern ?? '#8f8773'; ctx.lineWidth = 1.1; ctx.stroke();
        }
        for (const crossing of crossings) {
            if (crossing.x < left - 2 || crossing.x > right + 2 || crossing.y < top - 2 || crossing.y > bottom + 2) continue;
            const road = roads.find(r => `${r.a.sector}-${r.b.sector}` === crossing.over)!;
            const pattern = roadTextures.get(road.a.sector) ?? roadTextures.get(road.b.sector);
            ctx.save(); ctx.translate(crossing.x, crossing.y); if (!crossing.horizontal) ctx.rotate(Math.PI / 2);
            ctx.fillStyle = '#101715a8'; ctx.fillRect(-1.7, -.8, 3.4, 1.9);
            ctx.fillStyle = pattern ?? '#8f8773'; ctx.fillRect(-1.7, -.65, 3.4, 1.3);
            // Paired stone parapets and their cast shadows identify a raised deck.
            for (const y of [-.7, .6]) { ctx.fillStyle = '#302e25'; ctx.fillRect(-1.75, y, 3.5, .16); ctx.fillStyle = pattern ?? '#aaa392'; ctx.fillRect(-1.75, y - .06, 3.5, .12); }
            ctx.restore();
        }
        // Only maps already requested: the camera's own neighbourhood decides what loads (see draw).
        for (const chunk of visible) { const image = images.get(chunk.sector); if (image?.complete && image.naturalWidth) ctx.drawImage(painting(chunk.sector, image), chunk.x, chunk.y, 12, 12); }
        // A low rock line where two walkable-looking strips touch without a step between them.
        for (const wall of walls) {
            if (wall.x < left - 1 || wall.x > right + 1 || wall.y < top - 1 || wall.y > bottom + 1) continue;
            const sprite = rock.get(biomeNear(wall.x, wall.y)); if (!sprite) continue;
            for (const offset of [-.25, .25]) {
                const x = wall.horizontal ? wall.x + offset : wall.x, y = wall.horizontal ? wall.y : wall.y + offset;
                ctx.drawImage(sprite, x - .38, y - .38, .76, .76);
            }
        }
        // A small dotted line wherever walkable ground passes into another sector.
        const seams = boundaries.filter(b => b.x > left - 1 && b.x < right + 1 && b.y > top - 1 && b.y < bottom + 1);
        if (seams.length) {
            ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash([.001, .249]); ctx.beginPath();
            for (const b of seams) {
                if (b.horizontal) { ctx.moveTo(b.x - .5, b.y); ctx.lineTo(b.x + .5, b.y); } else { ctx.moveTo(b.x, b.y - .5); ctx.lineTo(b.x, b.y + .5); }
            }
            ctx.strokeStyle = '#120e08a6'; ctx.lineWidth = .17; ctx.stroke();
            ctx.strokeStyle = '#fff0c8f0'; ctx.lineWidth = .09; ctx.stroke(); ctx.restore();
        }
    }
    /** Rasters one fixed world tile at the current scale. Tiles meet exactly: each is the whole picture, shifted by whole pixels. */
    function renderTile(i: number, j: number) {
        let tile = tiles.get(tileKey(i, j));
        if (!tile) {
            const surface = spare.pop() ?? document.createElement('canvas'); surface.width = surface.height = TILE;
            tile = { surface, revision, i, j }; tiles.set(tileKey(i, j), tile);
        }
        const context = tile.surface.getContext('2d')!;
        context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, TILE, TILE);
        context.setTransform(tileScale, 0, 0, tileScale, -i * TILE, -j * TILE);
        paint(context, i * TILE / tileScale, j * TILE / tileScale, (i + 1) * TILE / tileScale, (j + 1) * TILE / tileScale);
        tile.revision = revision;
        return tile;
    }
    function draw(position: WorldPoint, sector: number) {
        if (!resize) { width = canvas.clientWidth; height = canvas.clientHeight; }
        const tilePx = width / 12, dpr = Math.min(devicePixelRatio, 2), scale = tilePx * dpr;
        // The painting is static: actors/weather animate in separate DOM layers.
        // Keep the raster while idle; image arrivals, camera, zone or size invalidate it.
        const signature = `${position.x}:${position.y}:${sector}:${width}:${height}:${dpr}:${revision}`;
        if (signature === lastDraw && lastView) return lastView;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
        if (scale !== tileScale) { for (const tile of tiles.values()) release(tile.surface); tiles.clear(); tileScale = scale; tileRange = NaN; }
        const left = position.x - width / tilePx / 2, right = position.x + width / tilePx / 2;
        const top = position.y - height / tilePx / 2, bottom = position.y + height / tilePx / 2;
        const visible = space.chunks.filter(c => c.x < right + 2 && c.x + 12 > left - 2 && c.y < bottom + 2 && c.y + 12 > top - 2);
        const current = chunks.get(sector)!; texture(current, imageFor(sector));
        for (const chunk of visible) texture(chunk, imageFor(chunk.sector));
        // The terrain snaps to whole device pixels (at most half a pixel off), so cached
        // tiles land crisply and meet exactly. The DOM overlay keeps the exact camera.
        const originX = Math.round(position.x * scale - canvas.width / 2), originY = Math.round(position.y * scale - canvas.height / 2);
        const i0 = Math.floor(originX / TILE), i1 = Math.floor((originX + canvas.width - 1) / TILE);
        const j0 = Math.floor(originY / TILE), j1 = Math.floor((originY + canvas.height - 1) / TILE);
        // Only the screen and the ring around it stay cached, checked when the screen
        // crosses into a new tile rather than every frame. This runs before any tile is
        // painted, so the tiles it lets go are the canvases the new ground reuses.
        if (tileKey(i0, j0) !== tileRange) {
            tileRange = tileKey(i0, j0); canvasBudget = (Math.ceil(canvas.width / TILE) + 3) * (Math.ceil(canvas.height / TILE) + 3);
            for (const [key, tile] of tiles) if (tile.i < i0 - 1 || tile.i > i1 + 1 || tile.j < j0 - 1 || tile.j > j1 + 1) { tiles.delete(key); release(tile.surface); }
            while (spare.length && tiles.size + spare.length > canvasBudget) shrink(spare.pop()!);
        }
        output.setTransform(1, 0, 0, 1, 0, 0); output.clearRect(0, 0, canvas.width, canvas.height);
        // A tile on screen is always drawn; a stale one (a map or texture arrived since)
        // is repainted within a few milliseconds a frame, then the ring just off screen,
        // so walking onto new ground rarely waits for a tile.
        const started = performance.now(), budget = () => performance.now() - started < 4;
        let behind = false;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            let tile = tiles.get(tileKey(i, j));
            if (!tile || (tile.revision !== revision && budget())) tile = renderTile(i, j);
            else if (tile.revision !== revision) behind = true;
            output.drawImage(tile.surface, i * TILE - originX, j * TILE - originY);
        }
        for (let j = j0 - 1; j <= j1 + 1; j++) for (let i = i0 - 1; i <= i1 + 1; i++) {
            if (tiles.get(tileKey(i, j))?.revision === revision) continue;
            if (budget()) renderTile(i, j); else behind = true;
        }
        const keep = new Set(visible.map(c => c.sector)); keep.add(sector);
        for (const id of images.keys()) if (!keep.has(id) && images.size > 4) {
            // A floor painting is the size of its map (several MB); free it now, not at the next GC.
            const art = paintings.get(id); if (art) shrink(art);
            images.delete(id); paintings.delete(id); roadTextures.delete(id);
        }
        // With tiles still stale, the next frame repaints even if nothing moved.
        lastDraw = behind ? '' : signature;
        return lastView = { tilePx, chunk: current, crossings, x: width / 2 + (current.x - position.x) * tilePx, y: height / 2 + (current.y - position.y) * tilePx };
    }
    return { draw, chunks, get imageCount() { return images.size; }, dispose() {
        resize?.disconnect();
        // Shrink every offscreen canvas this renderer made, so leaving the world returns its GPU memory at once.
        for (const surface of [...[...tiles.values()].map(tile => tile.surface), ...spare, ...paintings.values(), ...ground.values(), ...rock.values()]) shrink(surface);
        tiles.clear(); spare.length = 0; images.clear(); paintings.clear(); materials.clear(); ground.clear(); rock.clear(); roadTextures.clear(); blockBiome.clear();
    } };
}
