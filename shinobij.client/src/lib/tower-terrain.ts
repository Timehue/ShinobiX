import { HEX_H, HEX_W, towerHexPixel, towerNeighbors } from './tower-grid';

export const TERRAIN_ATLAS_CELLS = {
    fire: 0, water: 1, earth: 2, wind: 3, lightning: 4, ward: 5, frost: 6, poison: 7,
    strike: 8, collapse: 9, healing: 10, shrine: 11, curse: 12, recoil: 13, objective: 14, eruption: 15,
} as const;
export type TowerTerrainKind = keyof typeof TERRAIN_ATLAS_CELLS;
export const TERRAIN_PROP_CELLS = {
    fire: 0, water: 1, earth: 2, wind: 3, lightning: 4, ward: 5, frost: 6, font: 7,
    shrine: 8, geyser: 9, forest: 10, snow: 11, volcano: 12, shadow: 13, central: 14, trap: 15,
} as const;
export type TowerPropKind = keyof typeof TERRAIN_PROP_CELLS;

export const TOWER_HEX_POINTS = [[.25, .04], [.75, .04], [1, .5], [.75, .96], [.25, .96], [0, .5]] as const;

/** Split only the sealed tiles into connected patches. Art never expands a zone. */
export function towerTerrainPatches(tiles: readonly number[], width: number, height: number) {
    const remaining = new Set(tiles.filter(tile => Number.isInteger(tile) && tile >= 0 && tile < width * height));
    const patches: number[][] = [];
    while (remaining.size > 0) {
        const first = remaining.values().next().value!;
        const patch = [first];
        remaining.delete(first);
        for (let i = 0; i < patch.length; i++) {
            for (const next of towerNeighbors(patch[i]!, width, height)) {
                if (remaining.delete(next)) patch.push(next);
            }
        }
        patches.push(patch.sort((a, b) => a - b));
    }
    return patches.map(patch => {
        const positions = patch.map(tile => ({ tile, ...towerHexPixel(tile, width) }));
        const left = Math.min(...positions.map(pos => pos.left));
        const top = Math.min(...positions.map(pos => pos.top));
        return {
            tiles: patch, left, top,
            width: Math.max(...positions.map(pos => pos.left)) + HEX_W - left,
            height: Math.max(...positions.map(pos => pos.top)) + HEX_H - top,
            polygons: positions.map(pos => TOWER_HEX_POINTS.map(([x, y]) =>
                `${pos.left - left + x * HEX_W},${pos.top - top + y * HEX_H}`).join(' ')),
        };
    });
}

export function towerFeatureTerrain(kind: string, element?: string, label = ''): TowerTerrainKind {
    if (kind === 'ward') return 'ward';
    if (kind === 'hazard') {
        if (/frost|ice|snow/i.test(label)) return 'frost';
        if (/poison|toxic|venom/i.test(label)) return 'poison';
        return 'fire';
    }
    const elementKind = element?.toLowerCase();
    return elementKind && ['fire', 'water', 'earth', 'wind', 'lightning'].includes(elementKind)
        ? elementKind as TowerTerrainKind : 'shrine';
}

export function towerFeatureProp(kind: string, element?: string, label = ''): TowerPropKind {
    const terrain = towerFeatureTerrain(kind, element, label);
    if (kind === 'hazard') return terrain === 'frost' ? 'frost' : 'trap';
    return terrain in TERRAIN_PROP_CELLS ? terrain as TowerPropKind : 'shrine';
}

export function towerObstacleProp(biome?: string): TowerPropKind {
    return biome && ['forest', 'snow', 'volcano', 'shadow', 'central'].includes(biome)
        ? biome as TowerPropKind : 'central';
}
