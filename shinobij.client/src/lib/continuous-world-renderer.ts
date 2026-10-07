import type { ContinuousWorldSpace, WorldChunk, WorldPoint } from '../../../shared/continuous-world-space';
import { sectorWalkMask } from '../../../shared/sector-walk-mask';
import { sectorBiomeOf } from '../../../shared/sector-geo';
import { sectorFloorImage } from './sector-floor-layout';
import { worldRoadCrossings } from '../../../shared/world-road-crossings';

const colors: Record<string, string> = { forest: '#495338', central: '#747052', snow: '#b5bdba', shadow: '#55505c', volcano: '#4a3d36' };
const hash = (x: number, y: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;

/** Nearby-only painted terrain. No simulation, authority, timers or DOM HUD live here. */
export function createContinuousWorldRenderer(canvas: HTMLCanvasElement, space: ContinuousWorldSpace) {
    const ctx = canvas.getContext('2d')!;
    const images = new Map<number, HTMLImageElement>(), ground = new Map<string, HTMLCanvasElement>(), rock = new Map<string, HTMLCanvasElement>();
    const roadTextures = new Map<number, CanvasPattern>(), chunks = new Map(space.chunks.map(c => [c.sector, c]));
    const materials = new Map<string, HTMLImageElement>(), fieldSources = new Map<string, string>();
    const paintings = new Map<number, HTMLCanvasElement>();
    const crossings = worldRoadCrossings(space.roads);
    let revision = 0, lastDraw = '';
    let lastView: { tilePx: number; chunk: WorldChunk; crossings: typeof crossings; x: number; y: number } | undefined;
    const material = (name: string) => { let image = materials.get(name); if (!image) { image = new Image(); image.onload = () => { revision++; }; image.src = `/sector-map/world-terrain/${name}.webp`; materials.set(name, image); } return image; };
    const roads = space.roads.map(r => ({ ...r, left: Math.min(...r.points.map(p => p.x)), right: Math.max(...r.points.map(p => p.x)),
        top: Math.min(...r.points.map(p => p.y)), bottom: Math.max(...r.points.map(p => p.y)) }));
    const corridorCells = new Set<string>();
    const nearestChunk = (x: number, y: number) => space.chunks.reduce((best, chunk) =>
        Math.hypot(chunk.x + 6 - x, chunk.y + 6 - y) < Math.hypot(best.x + 6 - x, best.y + 6 - y) ? chunk : best, space.chunks[0]!);
    for (const road of roads) for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!, b = road.points[i]!, length = Math.hypot(b.x - a.x, b.y - a.y);
        for (let step = 0; step <= length; step++) {
            const x = Math.floor(a.x + (b.x - a.x) * step / (length || 1)), y = Math.floor(a.y + (b.y - a.y) * step / (length || 1));
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) corridorCells.add(`${x + dx}:${y + dy}`);
        }
    }
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
        const sourceKey = terrain.complete && terrain.naturalWidth ? terrain.src : image.src;
        if (fieldSources.get(biome) !== sourceKey) {
            const candidates = mask.flatMap((row, y) => [...row].flatMap((c, x) => c === '.' ? [{ tile: y * 12 + x,
                score: [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => mask[y + dy]?.[x + dx] === '.' ? 1 : 0)).reduce<number>((a, b) => a + b, 0) }] : []));
            candidates.sort((a, b) => b.score - a.score);
            const tile = candidates[0]?.tile ?? 78, field = document.createElement('canvas'); field.width = field.height = 768;
            const fieldContext = field.getContext('2d')!;
            if (sourceKey === terrain.src) fieldContext.drawImage(terrain, 0, 0, 768, 768);
            else { const pattern = fieldContext.createPattern(patch(image, tile), 'repeat')!; fieldContext.fillStyle = pattern; fieldContext.fillRect(0, 0, 768, 768); }
            fieldContext.globalCompositeOperation = 'destination-in';
            const fade = fieldContext.createRadialGradient(384, 384, 310, 384, 384, 384); fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#fff0');
            fieldContext.fillStyle = fade; fieldContext.fillRect(0, 0, 768, 768); ground.set(biome, field); fieldSources.set(biome, sourceKey);
            let cliff = 0, score = -1;
            for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
                const rank = [0, 1, 2].flatMap(dy => [0, 1, 2].map(dx => mask[y + dy]?.[x + dx] === '#' ? 1 : 0)).reduce<number>((a, b) => a + b, 0);
                if (rank > score) { score = rank; cliff = y * 12 + x; }
            }
            if (score > 0) rock.set(biome, patch(image, cliff, true, 3));
        }
    }
    function draw(position: WorldPoint, sector: number) {
        const width = canvas.clientWidth, height = canvas.clientHeight, tilePx = width / 12, dpr = Math.min(devicePixelRatio, 2);
        // The painting is static: actors/weather animate in separate DOM layers.
        // Keep the raster while idle; image arrivals, camera, zone or size invalidate it.
        const signature = `${position.x}:${position.y}:${sector}:${width}:${height}:${dpr}:${revision}`;
        if (signature === lastDraw && lastView) return lastView;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
        const left = position.x - width / tilePx / 2, right = position.x + width / tilePx / 2;
        const top = position.y - height / tilePx / 2, bottom = position.y + height / tilePx / 2;
        const visible = space.chunks.filter(c => c.x < right + 2 && c.x + 12 > left - 2 && c.y < bottom + 2 && c.y + 12 > top - 2);
        const current = chunks.get(sector)!; texture(current, imageFor(sector));
        for (const chunk of visible) texture(chunk, imageFor(chunk.sector));
        ctx.translate(width / 2, height / 2); ctx.scale(tilePx, tilePx); ctx.translate(-position.x, -position.y);
        // Overlapping feathered fields have fixed world coordinates and blend biome boundaries.
        ctx.fillStyle = '#3b4238'; ctx.fillRect(left, top, right - left, bottom - top);
        for (let y = Math.floor(top / 8) * 8 - 8; y < bottom + 8; y += 8) for (let x = Math.floor(left / 8) * 8 - 8; x < right + 8; x += 8) {
            const biome = sectorBiomeOf(nearestChunk(x, y).sector), field = ground.get(biome);
            if (field) ctx.drawImage(field, x - 8, y - 8, 16, 16);
            else { const fade = ctx.createRadialGradient(x, y, 5.5, x, y, 8); fade.addColorStop(0, colors[biome]!); fade.addColorStop(1, `${colors[biome]}00`); ctx.fillStyle = fade; ctx.fillRect(x - 8, y - 8, 16, 16); }
        }
        // Closed terrain is visible as organic cliff clusters, with a clear road corridor.
        for (let y = Math.floor(top / 3) * 3 - 3; y < bottom + 3; y += 3) for (let x = Math.floor(left / 3) * 3 - 3; x < right + 3; x += 3) {
            const n = hash(x, y), px = x + n * 1.3, py = y + hash(y, x) * 1.3;
            if (corridorCells.has(`${Math.floor(px)}:${Math.floor(py)}`) || space.chunks.some(c => px > c.x - 1 && px < c.x + 13 && py > c.y - 1 && py < c.y + 13)) continue;
            const sprite = rock.get(sectorBiomeOf(nearestChunk(px, py).sector)); if (!sprite) continue;
            const size = 3.6 + n * .5; ctx.save(); ctx.translate(px, py); ctx.rotate(Math.floor(n * 4) * Math.PI / 2); ctx.drawImage(sprite, -size / 2, -size / 2, size, size); ctx.restore();
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
        for (const chunk of visible) { const image = imageFor(chunk.sector); if (image.complete && image.naturalWidth) ctx.drawImage(painting(chunk.sector, image), chunk.x, chunk.y, 12, 12); }
        const keep = new Set(visible.map(c => c.sector)); keep.add(sector);
        for (const id of images.keys()) if (!keep.has(id) && images.size > 4) { images.delete(id); paintings.delete(id); roadTextures.delete(id); }
        lastDraw = signature;
        return lastView = { tilePx, chunk: current, crossings, x: width / 2 + (current.x - position.x) * tilePx, y: height / 2 + (current.y - position.y) * tilePx };
    }
    return { draw, chunks, get imageCount() { return images.size; }, dispose() { images.clear(); paintings.clear(); materials.clear(); ground.clear(); rock.clear(); roadTextures.clear(); } };
}
