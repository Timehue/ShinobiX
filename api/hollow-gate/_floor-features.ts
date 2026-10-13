import { planUndergroundFloorFeatures, type UndergroundFloorFeature } from '../../shared/underground-floor-features.js';
import { undergroundFeatureWalkable } from '../../shared/underground-floor-collision.js';
import type { HollowGateFloorManifest } from './_floor-manifest.js';
import type { HollowGateRunToken } from './_run-token.js';

export const hollowGateFloorFeatures = (run: HollowGateRunToken) => run.floorFeatures?.[String(run.currentFloor ?? 1)];
export const hollowGatePhysicalBoard = (run: HollowGateRunToken, manifest: HollowGateFloorManifest) => ({ ...manifest, walkable: undergroundFeatureWalkable(manifest.walkable, run.floorFeatures?.[String(manifest.floor)]) });

/** Nodes and walkability come from the validated manifest. Room labels only
 * choose peripheral architecture, which must pass the shared connectivity test. */
export function deriveHollowGateFloorFeatures(manifest: HollowGateFloorManifest, rawTiles: Record<string, unknown>[], protectedTiles: number[] = []): UndergroundFloorFeature[] {
    const tiles = [...manifest.walkable].map((open, index) => ({
        kind: open === '1' ? manifest.nodes[String(index)] ?? 'empty' : 'wall',
        terrain: rawTiles[index]?.terrain === 'door' ? 'door' : open === '1' ? 'room_floor' : 'wall',
        roomId: Number.isInteger(rawTiles[index]?.roomId) && Number(rawTiles[index]?.roomId) >= 0 && Number(rawTiles[index]?.roomId) < 12 ? Number(rawTiles[index].roomId) : null,
    }));
    return planUndergroundFloorFeatures(tiles, manifest.width, true, false, manifest.spawn.y * manifest.width + manifest.spawn.x, protectedTiles);
}
