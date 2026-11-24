import { sectorBiomeOf } from '../../../shared/sector-geo';
import { sectorFloorImage } from './sector-floor-layout';
import { sectorLifePainting } from './sector-life-art';

/** The painted floor the world renderer draws for a sector: its life painting when it has one. */
export const worldFloorSource = (sector: number) => sectorLifePainting(sector) ?? sectorFloorImage(sector);
/** The ground material that fills the land between floors, by biome. */
export const worldTerrainName = (sector: number, biome: string = sectorBiomeOf(sector)) => biome === 'snow' ? 'snow' : biome === 'volcano' || biome === 'shadow' ? 'cinder' : 'forest';
export const worldTerrainSource = (sector: number) => `/sector-map/world-terrain/${worldTerrainName(sector)}.webp`;

/** Images decoded during the travel wait, by source, until the arriving renderer takes them. */
const warm = new Map<string, HTMLImageElement>();
const decoding = new Set<string>();

function start(source: string) {
    if (warm.has(source) || decoding.has(source)) return;
    const image = new Image();
    image.src = source;
    // Without decode() (an older engine) the request alone still warms the HTTP cache. A failed
    // decode is forgotten, and the renderer loads that image as before. One nobody takes is let
    // go after 30 s: decoded, each floor is several MB.
    if (!image.decode) return;
    decoding.add(source);
    image.decode().then(() => {
        decoding.delete(source);
        warm.set(source, image);
        setTimeout(() => { if (warm.get(source) === image) warm.delete(source); }, 30_000);
    }, () => { decoding.delete(source); });
}

/**
 * Fetch and decode, during the travel wait, what the arriving world draws first: the
 * destination's floor and its biome ground, so the first frame paints them instead of an
 * empty field. Sectors sit far apart in the world, so no neighbour's floor is on screen at
 * arrival. Best effort: nothing here changes what is drawn.
 */
export function warmWorldFloors(sector: number) {
    start(worldFloorSource(sector));
    start(worldTerrainSource(sector));
}

/** The road's current life painting (from its sector-life reply), which replaces the base floor. */
export const warmLifePainting = (key: string) => start(`/sector-life/${key}.webp`);

/** An image already decoded for `source`, handed over once. */
export function takeWarmImage(source: string) {
    const image = warm.get(source);
    warm.delete(source);
    return image;
}
