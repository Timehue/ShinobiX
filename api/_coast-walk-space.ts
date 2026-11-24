import { COAST_WORLD, COAST_WORLD_VERSION, coastExitById, coastLayout } from '../shared/coast-world.js';
import { worldPositionModel } from '../shared/continuous-world-layout.js';
import { buildWorldNavigation, worldGraphVersion } from '../shared/continuous-world-navigation.js';
import { createWorldPositionModel } from '../shared/world-position.js';
import { isCoastSector } from '../shared/world-maps.js';

export const coastWalkSpace = {
    layoutVersion: worldGraphVersion(COAST_WORLD_VERSION),
    chunks: COAST_WORLD.space.chunks.filter(chunk => coastLayout(chunk.sector)).map(chunk => {
        const layout = coastLayout(chunk.sector)!;
        return { ...chunk, mask: layout.mask, biome: layout.biome, floor: '/coast-map/' + (layout.floor ?? `s${chunk.sector}.webp`) };
    }),
    roads: COAST_WORLD.space.roads.map(road => ({ ...road, a: coastExitById(road.a)!, b: coastExitById(road.b)! }))
        .filter(({ a, b }) => coastLayout(a.sector) && coastLayout(b.sector)),
};

let coastModel: ReturnType<typeof worldPositionModel> | undefined;
export function sectorPositionModel(sector: number) {
    if (!isCoastSector(sector)) return worldPositionModel();
    coastModel ??= createWorldPositionModel(coastWalkSpace.layoutVersion, buildWorldNavigation(coastWalkSpace).byId,
        coastWalkSpace.roads, coastWalkSpace.chunks);
    return coastModel;
}
