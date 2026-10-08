import layout from './continuous-world-layout.json';
import { buildWorldNavigation, worldGraphVersion } from './continuous-world-navigation';
import type { ContinuousWorldSpace } from './continuous-world-space';
import { createWorldPositionModel } from './world-position';

export const WORLD_LAYOUT_VERSION = worldGraphVersion(layout.layoutVersion);
export const CONTINUOUS_WORLD_SPACE = { ...layout, layoutVersion: WORLD_LAYOUT_VERSION } as ContinuousWorldSpace & { layoutVersion: string };
let model: ReturnType<typeof createWorldPositionModel> | undefined;
export function worldPositionModel() {
    model ??= createWorldPositionModel(WORLD_LAYOUT_VERSION,
        new Map(buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes.map(n => [n.id, n])), CONTINUOUS_WORLD_SPACE.roads);
    return model;
}
