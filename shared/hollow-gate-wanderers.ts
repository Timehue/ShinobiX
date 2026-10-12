/** Stable identities; only the API advances positions or grants gifts. */
export type HollowGateWandererRole = 'medic' | 'wayfarer' | 'bandit' | 'night-ninja' | 'patrol';
export type HollowGateWanderer = {
    role: HollowGateWandererRole;
    nodeId: string;
    origin: number;
    tile: number;
    previousTile?: number;
    village?: string;
    spent?: boolean;
    hunting?: boolean;
};
export type HollowGatePendingEncounter = { nodeId: string; kind: 'battle' | 'ambush' | 'boss' | 'card' };
export const hollowGateWandererFriendly = (npc: HollowGateWanderer) => npc.role === 'medic' || npc.role === 'wayfarer';
export const hollowGateWandererName = (npc: HollowGateWanderer) => ({
    medic: 'Wandering Medic', wayfarer: 'Relic Wayfarer', bandit: 'Cavern Bandit',
    'night-ninja': 'Night Ninja', patrol: `${npc.village?.replace(/ Village$/, '') || 'Rival Village'} Patrol`,
})[npc.role];
export const hollowGateWandererArt = (npc: HollowGateWanderer) => `/underground/wanderer-${npc.role}-v1.webp`;
export const hollowGateWandererOrigin = (npcs: readonly HollowGateWanderer[] | undefined, index: number) =>
    npcs?.some(npc => !hollowGateWandererFriendly(npc) && npc.origin === index) === true;

type Board = { floor: number; width: number; height: number; spawn: { x: number; y: number }; walkable: string; nodes: Record<string, string>; riftSignal?: { tileIndex: number } };
const hash = (value: string) => [...value].reduce((n, ch) => Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
const neighbors = (tile: number, b: Board) => [tile - b.width, tile + 1, tile + b.width, tile - 1]
    .filter(n => n >= 0 && n < b.walkable.length && Math.abs(n % b.width - tile % b.width) + Math.abs(Math.floor(n / b.width) - Math.floor(tile / b.width)) === 1 && b.walkable[n] === '1');
export const hollowGateWandererDistance = (a: number, b: number, width: number) => Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width));

export function createHollowGateWanderers(board: Board, seed: string, village?: string): HollowGateWanderer[] {
    const spawn = board.spawn.y * board.width + board.spawn.x;
    const rank = (n: number) => hash(`${seed}:${board.floor}:${n}`);
    const battles = Object.keys(board.nodes).map(Number).filter(n => board.nodes[String(n)] === 'battle' && n !== board.riftSignal?.tileIndex && hollowGateWandererDistance(n, spawn, board.width) >= 5).sort((a, b) => rank(a) - rank(b));
    const empty = [...board.walkable].flatMap((v, n) => v === '1' && !board.nodes[String(n)] && hollowGateWandererDistance(n, spawn, board.width) >= 3 ? [n] : []).sort((a, b) => rank(a) - rank(b));
    const villages = ['Moonshadow Village', 'Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village'].filter(v => v !== village);
    const patrolVillage = villages[hash(`${seed}:patrol:${board.floor}`) % villages.length];
    const result: HollowGateWanderer[] = [];
    const add = (role: HollowGateWandererRole, origin: number | undefined) => {
        if (origin == null) return;
        result.push({ role, origin, tile: origin, nodeId: `floor:${board.floor}:tile:${origin}`, ...(role === 'patrol' ? { village: patrolVillage } : {}) });
    };
    add('medic', empty.shift());
    add('wayfarer', empty.find(n => hollowGateWandererDistance(n, result[0]?.tile ?? spawn, board.width) >= 3));
    (['bandit', 'night-ninja', 'patrol'] as const).forEach(role => add(role, battles.shift()));
    return result;
}

/** Step-paced movement, with shortest-path pursuit through actual passages.
 * Other event nodes stay clear so an NPC cannot hide stairs, loot or the boss. */
export function advanceHollowGateWanderers(board: Board, npcs: readonly HollowGateWanderer[], player: { x: number; y: number }, step: number, withdrawn: readonly string[] = []): HollowGateWanderer[] {
    const target = player.y * board.width + player.x;
    const origins = new Set(npcs.filter(n => !hollowGateWandererFriendly(n)).map(n => n.origin));
    const open = (n: number) => n === target || !board.nodes[String(n)] || origins.has(n);
    const occupied = new Set(npcs.filter(n => !n.spent).map(n => n.tile));
    return npcs.map(npc => {
        if (npc.spent) return npc;
        const friendly = hollowGateWandererFriendly(npc);
        const escaped = withdrawn.includes(`${board.floor}:battle:${npc.nodeId}`);
        const queue = [target], distances = new Map<number, number>([[target, 0]]);
        for (let i = 0; i < queue.length; i++) {
            const n = queue[i], d = distances.get(n)!;
            if (d >= 9) continue;
            for (const next of neighbors(n, board)) if (open(next) && !distances.has(next)) { distances.set(next, d + 1); queue.push(next); }
        }
        const hunting = !friendly && !escaped && distances.has(npc.tile);
        // Neighbors pause for conversation; hunters move at a readable cadence.
        if (hollowGateWandererDistance(npc.tile, target, board.width) <= 1 || escaped
            || step % (friendly ? 4 : npc.role === 'night-ninja' ? 2 : 3) !== 0) return { ...npc, hunting };
        const candidates = neighbors(npc.tile, board).filter(n => open(n) && n !== target && !occupied.has(n));
        candidates.sort((a, b) => hunting ? (distances.get(a) ?? 99) - (distances.get(b) ?? 99)
            : Number(a === npc.previousTile) - Number(b === npc.previousTile) || hash(`${npc.nodeId}:${step}:${a}`) - hash(`${npc.nodeId}:${step}:${b}`));
        const tile = candidates[0] ?? npc.tile;
        occupied.delete(npc.tile); occupied.add(tile);
        return { ...npc, tile, previousTile: npc.tile, hunting };
    });
}
