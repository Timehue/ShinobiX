import { createHash } from 'node:crypto';
import { GRID_H, GRID_W } from './constants.js';
import { axial, hexDistance, hexNeighbors, posFromXY } from './grid.js';

/** Translate an authored group as one unit. Hex-space translation preserves
 * every attack/AOE distance instead of scattering a balanced pack apart. */
export function combatFormationPositions(seed: string, formation: {
    allies: readonly number[];
    enemies: readonly number[];
    blockedTiles?: readonly number[];
}): { allies: number[]; enemies: number[] } {
    const original = [...formation.allies, ...formation.enemies];
    if (!formation.allies.length || !formation.enemies.length || new Set(original).size !== original.length
        || original.some(tile => !Number.isInteger(tile) || tile < 0 || tile >= GRID_W * GRID_H)) {
        throw new RangeError('Invalid combat formation.');
    }
    const blocked = new Set(formation.blockedTiles);
    const xs = original.map(tile => tile % GRID_W);
    // Prefer breathing room for retreat. If terrain leaves only an edge
    // placement, keep the formation intact there before considering a scatter.
    for (const margin of [1, 0]) {
        const candidates: { allies: number[]; enemies: number[]; rank: number }[] = [];
        for (let dx = margin - Math.min(...xs); dx <= GRID_W - 1 - margin - Math.max(...xs); dx++) {
            const shifted = original.map(tile => {
                const { q, r } = axial(tile);
                return { x: q + dx, y: r + Math.floor((q + dx) / 2) };
            });
            const ys = shifted.map(p => p.y);
            for (let dy = -Math.min(...ys); dy <= GRID_H - 1 - Math.max(...ys); dy++) {
                const tiles = shifted.map(p => posFromXY(p.x, p.y + dy));
                if (tiles.some(tile => tile < 0 || blocked.has(tile))) continue;
                const reachable = new Set([tiles[0]!]);
                for (const tile of reachable) for (const next of hexNeighbors(tile)) if (!blocked.has(next)) reachable.add(next);
                if (!tiles.every(tile => reachable.has(tile))) continue;
                candidates.push({
                    allies: tiles.slice(0, formation.allies.length),
                    enemies: tiles.slice(formation.allies.length),
                    rank: createHash('sha256').update(`combat-formation:${seed}:${dx}:${dy}`).digest().readUInt32LE(),
                });
            }
        }
        const chosen = candidates.sort((a, b) => a.rank - b.rank)[0];
        if (chosen) return { allies: chosen.allies, enemies: chosen.enemies };
    }
    // An obstacle can make every translation impossible. Still require clear,
    // connected positions instead of putting an actor in an authored wall.
    return combatSpawnPositions(seed, { allies: formation.allies.length, enemies: formation.enemies.length, blockedTiles: formation.blockedTiles });
}

/** Choose once at encounter creation, then persist the positions with the actors.
 * A separate random stream leaves damage rolls and turn order unchanged. */
export function combatSpawnPositions(seed: string, options: {
    allies?: number;
    enemies?: number;
    blockedTiles?: readonly number[];
    mirrored?: boolean;
    openingDistance?: number;
} = {}): { allies: number[]; enemies: number[] } {
    const allyCount = options.allies ?? 1;
    const enemyCount = options.enemies ?? 1;
    const openingDistance = options.openingDistance ?? 7;
    if (!Number.isInteger(allyCount) || !Number.isInteger(enemyCount) || allyCount < 1 || enemyCount < 1
        || !Number.isSafeInteger(openingDistance) || openingDistance < 1 || openingDistance > GRID_W + GRID_H - 2
        || (options.mirrored && allyCount !== enemyCount)) throw new RangeError('Invalid combat spawn counts.');
    const blocked = new Set(options.blockedTiles);
    let state = createHash('sha256').update(`combat-spawns:${seed}`).digest().readUInt32LE();
    const random = () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const tiles = Array.from({ length: GRID_W * GRID_H }, (_, i) => i).filter(i => !blocked.has(i));
    for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
    }
    const left = tiles.filter(tile => tile % GRID_W < GRID_W / 2);
    const right = tiles.filter(tile => tile % GRID_W >= GRID_W / 2);
    const mirror = (tile: number) => GRID_W * GRID_H - 1 - tile;
    const reachableFrom = (start: number) => {
        const seen = new Set([start]);
        for (const tile of seen) for (const next of hexNeighbors(tile)) {
            if (!blocked.has(next)) seen.add(next);
        }
        return seen;
    };
    // Preserve the mode's opening distance (seven by default). Mirrored PvP formations have
    // equal board reach; additional PvE opponents stay at least five hexes away.
    for (const first of left) {
        const opposite = mirror(first);
        if (blocked.has(opposite) || hexDistance(first, opposite) !== openingDistance) continue;
        const reachable = reachableFrom(first);
        if (!reachable.has(opposite)) continue;
        const allies = [first];
        const enemies = [opposite];
        for (const tile of left) {
            if (allies.length === allyCount) break;
            if (!reachable.has(tile) || allies.includes(tile) || allies.some(a => hexDistance(a, tile) < 2)
                || enemies.some(e => hexDistance(e, tile) < 5)) continue;
            const other = mirror(tile);
            if (options.mirrored && (!reachable.has(other) || enemies.includes(other)
                || hexDistance(tile, other) !== openingDistance || allies.some(a => hexDistance(a, other) < 5))) continue;
            allies.push(tile);
            if (options.mirrored) enemies.push(other);
        }
        if (allies.length !== allyCount) continue;
        if (!options.mirrored) for (const tile of right) {
            if (enemies.length === enemyCount) break;
            if (reachable.has(tile) && !enemies.includes(tile) && allies.every(a => hexDistance(a, tile) >= 5)) enemies.push(tile);
        }
        if (enemies.length === enemyCount) return { allies, enemies };
    }
    // Dense authored terrain can remove every mirrored pair. Use a connected
    // formation with the largest available gap rather than spawning in a wall.
    // Competitive arenas are empty and must always retain their symmetry.
    if (!options.mirrored) for (let gap = openingDistance; gap >= 1; gap--) for (const first of left) {
        const reachable = reachableFrom(first);
        const allies = [first, ...left.filter(t => t !== first && reachable.has(t))].slice(0, allyCount);
        const enemies = right.filter(t => reachable.has(t) && allies.every(a => hexDistance(a, t) >= gap)).slice(0, enemyCount);
        if (allies.length === allyCount && enemies.length === enemyCount) return { allies, enemies };
    }
    // A valid connected room may occupy only one half of the board. PvE can
    // use that room too; it must not fail simply because the other half is walls.
    if (!options.mirrored) for (let gap = openingDistance; gap >= 1; gap--) for (const first of tiles) {
        const reachable = reachableFrom(first);
        const allies = [first, ...tiles.filter(t => t !== first && reachable.has(t))].slice(0, allyCount);
        const enemies = tiles.filter(t => reachable.has(t) && !allies.includes(t)
            && allies.every(a => hexDistance(a, t) >= gap)).slice(0, enemyCount);
        if (allies.length === allyCount && enemies.length === enemyCount) return { allies, enemies };
    }
    throw new Error('The battlefield has no connected combat spawn formation.');
}
