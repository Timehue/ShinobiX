import { RIFT_WEEKLY_DISTORTIONS } from '../sector/_rift-quest.js';

export type HollowGateFloorManifest = {
    floor: number;
    width: number;
    height: number;
    spawn: { x: number; y: number };
    walkable: string;
    nodes: Record<string, string>;
    /** A naturally off-route chest selected from this immutable board. */
    detour?: { tileIndex: number; extraSteps: number; condition: 'echo-cache' };
    /** One existing point of interest surfaced by this week's Rift rule. */
    riftSignal?: { tileIndex: number; kind: string; distortionId: string };
};

function distancesFrom(start: number, width: number, height: number, walkable: string[]): number[] {
    const distances = Array(width * height).fill(-1) as number[];
    distances[start] = 0;
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const x = current % width, y = Math.floor(current / width);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const next = ny * width + nx;
            if (walkable[next] !== '1' || distances[next] >= 0) continue;
            distances[next] = distances[current] + 1;
            queue.push(next);
        }
    }
    return distances;
}

const ALLOWED_KINDS = new Set([
    'empty', 'wall', 'battle', 'elite', 'trap', 'chest', 'shard_vein',
    'pet_event', 'pet_battle', 'shrine', 'story', 'boss', 'descend', 'npc',
    'exit', 'locked', 'tile_game',
]);

export function validateHollowGateFloorManifest(raw: {
    floor: unknown;
    finalFloor: boolean;
    width: unknown;
    height: unknown;
    playerX: unknown;
    playerY: unknown;
    tiles: unknown;
    riftDistortionId?: unknown;
    deriveDetour?: boolean;
}): { ok: true; manifest: HollowGateFloorManifest } | { ok: false; reason: string } {
    const floor = Math.floor(Number(raw.floor));
    const width = Math.floor(Number(raw.width));
    const height = Math.floor(Number(raw.height));
    const playerX = Math.floor(Number(raw.playerX));
    const playerY = Math.floor(Number(raw.playerY));
    if (!Number.isInteger(floor) || floor < 1 || floor > 5 || !Number.isInteger(width) || width < 15 || width > 31
        || !Number.isInteger(height) || height < 11 || height > 21 || !Array.isArray(raw.tiles)
        || raw.tiles.length !== width * height || playerX < 0 || playerX >= width || playerY < 0 || playerY >= height) {
        return { ok: false, reason: 'invalid-shape' };
    }
    const nodes: Record<string, string> = {};
    const walkable: string[] = [];
    const counts: Record<string, number> = {};
    const chestIndices: number[] = [];
    for (let index = 0; index < raw.tiles.length; index += 1) {
        const tile: Record<string, unknown> = raw.tiles[index] && typeof raw.tiles[index] === 'object'
            ? raw.tiles[index] as Record<string, unknown>
            : {};
        const kind = String(tile.kind ?? '');
        if (!ALLOWED_KINDS.has(kind)) return { ok: false, reason: 'invalid-kind' };
        const canWalk = kind !== 'wall' && tile.terrain !== 'wall';
        walkable.push(canWalk ? '1' : '0');
        counts[kind] = (counts[kind] ?? 0) + 1;
        if (kind === 'chest') chestIndices.push(index);
        if (kind !== 'empty' && kind !== 'wall') nodes[String(index)] = kind;
    }
    const spawnIndex = playerY * width + playerX;
    if (walkable[spawnIndex] !== '1') return { ok: false, reason: 'blocked-spawn' };
    if ((raw.tiles[spawnIndex] as Record<string, unknown> | undefined)?.kind !== 'empty') return { ok: false, reason: 'unsafe-spawn' };
    if (counts.exit !== 1 || (raw.finalFloor ? counts.boss !== 1 || (counts.descend ?? 0) !== 0 : counts.descend !== 1 || (counts.boss ?? 0) !== 0)) {
        return { ok: false, reason: 'invalid-targets' };
    }
    const limits: Record<string, number> = {
        chest: 3,
        shard_vein: 1 + Math.floor(floor / 2),
        locked: 1,
        shrine: 1,
        npc: 1,
        trap: 3 + Math.floor(floor / 2),
    };
    for (const [kind, limit] of Object.entries(limits)) {
        if ((counts[kind] ?? 0) > limit) return { ok: false, reason: `too-many-${kind}` };
    }
    const exactCounts: Record<string, number> = {
        battle: 4 + Math.min(5, floor),
        elite: 1 + Math.floor(floor / 2),
        chest: 3,
        shard_vein: 1 + Math.floor(floor / 2),
        locked: 1,
        shrine: 1,
        story: 1,
        npc: 1,
        pet_battle: 0,
        pet_event: 0,
        tile_game: 0,
    };
    for (const [kind, expected] of Object.entries(exactCounts)) {
        if ((counts[kind] ?? 0) !== expected) return { ok: false, reason: `invalid-${kind}-count` };
    }
    const combatCount = ['battle', 'elite', 'pet_battle', 'tile_game', 'boss'].reduce((sum, kind) => sum + (counts[kind] ?? 0), 0);
    if (combatCount > 16) return { ok: false, reason: 'too-many-combats' };

    const targets = Object.entries(nodes).filter(([, kind]) => kind === 'exit' || kind === (raw.finalFloor ? 'boss' : 'descend')).map(([index]) => Number(index));
    const seen = new Set<number>([spawnIndex]);
    const queue = [spawnIndex];
    while (queue.length) {
        const current = queue.shift()!;
        const x = current % width;
        const y = Math.floor(current / width);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const next = ny * width + nx;
            if (walkable[next] !== '1' || seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    if (targets.some((index) => !seen.has(index))) return { ok: false, reason: 'unreachable-target' };
    const walkableCount = walkable.reduce((sum, value) => sum + (value === '1' ? 1 : 0), 0);
    if (seen.size !== walkableCount) return { ok: false, reason: 'disconnected-floor' };
    const target = targets.find((index) => (nodes[String(index)] === (raw.finalFloor ? 'boss' : 'descend')));
    if (target == null) return { ok: false, reason: 'missing-target' };
    const targetX = target % width;
    const targetY = Math.floor(target / width);
    if (Math.abs(targetX - playerX) + Math.abs(targetY - playerY) < 3) return { ok: false, reason: 'target-too-close' };
    const fromSpawn = distancesFrom(spawnIndex, width, height, walkable);
    const fromTarget = distancesFrom(target, width, height, walkable);
    const directSteps = fromSpawn[target];
    const detour = raw.deriveDetour === false ? undefined : chestIndices
        .map((tileIndex) => ({ tileIndex, extraSteps: fromSpawn[tileIndex] + fromTarget[tileIndex] - directSteps }))
        .filter((candidate) => candidate.extraSteps >= 4)
        .sort((a, b) => b.extraSteps - a.extraSteps || a.tileIndex - b.tileIndex)[0];
    const distortion = RIFT_WEEKLY_DISTORTIONS.find((entry) => entry.id === raw.riftDistortionId);
    const riftSignalNode = distortion
        ? Object.entries(nodes)
            .filter(([, kind]) => kind === distortion.kind)
            .map(([index, kind]) => ({ tileIndex: Number(index), kind, distance: fromSpawn[Number(index)] }))
            .filter((node) => node.distance >= 0)
            .sort((a, b) => b.distance - a.distance || a.tileIndex - b.tileIndex)[0]
        : undefined;
    return {
        ok: true,
        manifest: {
            floor, width, height, spawn: { x: playerX, y: playerY }, walkable: walkable.join(''), nodes,
            ...(detour ? { detour: { ...detour, condition: 'echo-cache' as const } } : {}),
            ...(distortion && riftSignalNode ? { riftSignal: { tileIndex: riftSignalNode.tileIndex, kind: riftSignalNode.kind, distortionId: distortion.id } } : {}),
        },
    };
}

export function hollowGateManifestNode(manifest: HollowGateFloorManifest | null | undefined, nodeId: string): string | null {
    const match = /^floor:(\d{1,2}):tile:(\d{1,5})$/.exec(nodeId);
    if (!manifest || !match || Number(match[1]) !== manifest.floor) return null;
    const index = Number(match[2]);
    return manifest.nodes[String(index)] ?? (manifest.walkable[index] === '1' ? 'empty' : 'wall');
}

/**
 * The run's per-floor record of stepped-on tiles: a '0'/'1' mask the shape of
 * the manifest's walkable mask, keyed by floor. It is presentation memory, not
 * gameplay authority. It lets a reload rebuild the explored board from the
 * server instead of from a client-saved one. Returns `visited` unchanged when
 * the tile is already marked or lies off the floor.
 */
export function hollowGateMarkVisited(
    visited: Record<string, string> | undefined,
    manifest: Pick<HollowGateFloorManifest, 'floor' | 'width' | 'height'>,
    position: { x: number; y: number } | null | undefined,
): Record<string, string> | undefined {
    if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.y)
        || position.x < 0 || position.x >= manifest.width || position.y < 0 || position.y >= manifest.height) return visited;
    const size = manifest.width * manifest.height;
    const key = String(manifest.floor);
    const current = visited?.[key];
    const mask = typeof current === 'string' && current.length === size && /^[01]*$/.test(current) ? current : '0'.repeat(size);
    const index = position.y * manifest.width + position.x;
    if (mask[index] === '1' && mask === current) return visited;
    return { ...(visited ?? {}), [key]: `${mask.slice(0, index)}1${mask.slice(index + 1)}` };
}

export function hollowGatePositionNodeId(
    manifest: HollowGateFloorManifest | null | undefined,
    position: { x: number; y: number } | null | undefined,
): string {
    if (!manifest || !position || !Number.isInteger(position.x) || !Number.isInteger(position.y)
        || position.x < 0 || position.x >= manifest.width || position.y < 0 || position.y >= manifest.height) return '';
    return `floor:${manifest.floor}:tile:${position.y * manifest.width + position.x}`;
}
