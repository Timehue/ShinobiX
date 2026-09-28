/** Seeded Tower environment shared by encounter creation and the visual preview. */
export type TowerEnvironmentFeature =
    | { kind: 'pylon'; tiles: number[]; element: string; weakenElement: string; percent: number; label?: string }
    | { kind: 'ward'; tiles: number[]; percent: number; label?: string }
    | { kind: 'hazard'; tiles: number[]; percent: number; label?: string };

export const TOWER_ENVIRONMENT_RADIUS = 1; // Seven hexes keeps tactical zones readable.
export const TOWER_ENVIRONMENT_PROP_SCALE = 1.5;

function randomStream(seed: number) {
    let state = (seed >>> 0) || 1;
    return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
}

/** Retains the legacy seeded element ordering for callers that use the full pool. */
export function pickTowerElements(seed: number): string[] {
    return shuffle(['Fire', 'Water', 'Earth', 'Lightning', 'Wind'], randomStream(seed)).slice(0, 3);
}

export function rollTowerEnvironment(pool: readonly TowerEnvironmentFeature[], seed: number): TowerEnvironmentFeature[] {
    if (!pool.length) return [];
    const random = randomStream(seed ^ 0x7a39b145);
    const defaults: TowerEnvironmentFeature[] = [
        { kind: 'pylon', tiles: [], element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Flame Pylon' },
        { kind: 'ward', tiles: [], percent: 22, label: 'Warded Stone' },
        { kind: 'hazard', tiles: [], percent: 12, label: 'Hazard' },
    ];
    return defaults.map(fallback => {
        const candidates = pool.filter(feature => feature.kind === fallback.kind);
        const selected = candidates[Math.floor(random() * candidates.length)] ?? fallback;
        const feature = { ...selected, tiles: [] };
        if (feature.kind === 'pylon') {
            const element = pickTowerElements(seed)[0]!;
            const names: Record<string, [string, string]> = {
                Fire: ['Flame Pylon', 'Water'], Water: ['Tide Pylon', 'Earth'],
                Earth: ['Stone Pylon', 'Lightning'], Lightning: ['Storm Pylon', 'Wind'], Wind: ['Gale Pylon', 'Fire'],
            };
            feature.element = element;
            [feature.label, feature.weakenElement] = names[element]!;
        }
        return feature;
    });
}

export function towerEnvironmentZone(center: number, width: number, height: number): number[] {
    const tiles = new Set([center]);
    let frontier = [center];
    for (let radius = 0; radius < TOWER_ENVIRONMENT_RADIUS; radius++) {
        const next: number[] = [];
        for (const tile of frontier) {
            const x = tile % width, y = Math.floor(tile / width);
            const offsets = x % 2 === 0
                ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
                : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
            for (const [dx, dy] of offsets) {
                const nx = x + dx!, ny = y + dy!, neighbor = ny * width + nx;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height || tiles.has(neighbor)) continue;
                tiles.add(neighbor);
                next.push(neighbor);
            }
        }
        frontier = next;
    }
    return [...tiles]; // Center first: the prop anchors to the actual zone center.
}

function centerDistance(a: number, b: number, width: number): number {
    const ax = a % width, bx = b % width;
    const ar = Math.floor(a / width) - (ax - (ax & 1)) / 2;
    const br = Math.floor(b / width) - (bx - (bx & 1)) / 2;
    return (Math.abs(ax - bx) + Math.abs(ar - br) + Math.abs(ax + ar - bx - br)) / 2;
}

/** Place complete, well-spaced zones away from squad spawns and reserved objectives. */
export function placeTowerEnvironment(
    features: readonly TowerEnvironmentFeature[], width: number, height: number, seed: number, reserved: readonly number[],
): TowerEnvironmentFeature[] {
    if (!features.length) return [];
    const taken = new Set(reserved);
    const zoneSize = 1 + 3 * TOWER_ENVIRONMENT_RADIUS * (TOWER_ENVIRONMENT_RADIUS + 1);
    const candidates = shuffle(Array.from({ length: width * height }, (_, tile) => towerEnvironmentZone(tile, width, height))
        .filter(zone => zone.length === zoneSize && zone.every(tile => tile % width > 3 && !taken.has(tile))), randomStream(seed ^ 0x9e3779b9));
    const chosen: number[][] = [];
    // Prefer two clear hexes between radius-two zones. Backtracking considers
    // other first placements before relaxing the gap on a constrained arena.
    function place(from: number, minimumDistance: number, keepArtInside: boolean): boolean {
        if (chosen.length === features.length) return true;
        for (let index = from; index < candidates.length; index++) {
            const zone = candidates[index]!;
            // Keep the smaller prop art inside the top edge of the arena.
            if (keepArtInside && Math.floor(zone[0]! / width) < 2) continue;
            if (zone.some(tile => taken.has(tile))) continue;
            if (chosen.some(other => centerDistance(zone[0]!, other[0]!, width) < minimumDistance)) continue;
            zone.forEach(tile => taken.add(tile));
            chosen.push(zone);
            if (place(index + 1, minimumDistance, keepArtInside)) return true;
            chosen.pop();
            zone.forEach(tile => taken.delete(tile));
        }
        return false;
    }
    // Keep the zones apart where possible; compact layouts are the fallback so
    // authored objectives cannot block entry.
    if (![true, false].some(keepArtInside => [7, 6, 5].some(distance => place(0, distance, keepArtInside)))) {
        throw new Error('Tower arena cannot fit its environmental zones safely.');
    }
    return features.map((feature, index) => ({ ...feature, tiles: chosen[index]! }));
}
