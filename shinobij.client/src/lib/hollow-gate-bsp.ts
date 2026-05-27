/*
 * Pure geometry + pathfinding helpers for Hollow Gate shrine generation.
 *
 *   • hollowGateReachableSet  — flood-fill BFS used to validate that no
 *                               locked tile ever sits on the only path to
 *                               the boss / exit.
 *   • bspSplit                — recursive binary-space partition of a rect.
 *   • bspRoomInNode           — pick a randomly-sized room inside a BSP leaf.
 *   • bspRoomCenter           — integer center of a rect.
 *   • bspCarveCorridor        — L-shaped corridor cutter (writes into a
 *                               flat terrain array; only overwrites walls).
 *
 * All functions are deterministic given their inputs except for the random
 * picks; they take everything via parameters and never close over App
 * state.
 *
 * Extracted from App.tsx.
 */

import type { HollowGateTerrain } from "../types/character";

export type BSPRect = { x: number; y: number; w: number; h: number };

/**
 * BFS — returns the set of tile indices reachable from `start` if all tiles
 * in `blocked` are treated as walls. Used to validate that locked tiles
 * never stand on the only path to the boss or exit.
 */
export function hollowGateReachableSet(w: number, h: number, start: number, blocked: Set<number>): Set<number> {
    const seen = new Set<number>([start]);
    const queue: number[] = [start];
    while (queue.length) {
        const idx = queue.shift()!;
        const x = idx % w;
        const y = Math.floor(idx / w);
        const neighbors = [
            [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y],
        ];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (seen.has(nIdx) || blocked.has(nIdx)) continue;
            seen.add(nIdx);
            queue.push(nIdx);
        }
    }
    return seen;
}

/**
 * Recursively split a rectangle into a list of leaf rectangles using
 * Binary Space Partitioning. Each call randomly picks an axis (with a
 * mild bias toward the longer dimension) and a split point that keeps
 * both children at least `minLeaf` tall/wide. Stops at `depth === 0` or
 * when no axis can be split further.
 */
export function bspSplit(rect: BSPRect, depth: number, minLeaf: number): BSPRect[] {
    if (depth <= 0) return [rect];
    // Stop splitting if neither axis has room for two minLeaf-sized children.
    const canSplitX = rect.w >= minLeaf * 2 + 1;
    const canSplitY = rect.h >= minLeaf * 2 + 1;
    if (!canSplitX && !canSplitY) return [rect];
    // Prefer to split the longer axis 70% of the time so rooms stay roughly square.
    let splitVertical: boolean;
    if (canSplitX && canSplitY) {
        const preferVertical = rect.w >= rect.h;
        splitVertical = preferVertical ? Math.random() < 0.7 : Math.random() < 0.3;
    } else {
        splitVertical = canSplitX;
    }
    if (splitVertical) {
        const splitAt = minLeaf + Math.floor(Math.random() * (rect.w - minLeaf * 2));
        return [
            ...bspSplit({ x: rect.x, y: rect.y, w: splitAt, h: rect.h }, depth - 1, minLeaf),
            ...bspSplit({ x: rect.x + splitAt, y: rect.y, w: rect.w - splitAt, h: rect.h }, depth - 1, minLeaf),
        ];
    } else {
        const splitAt = minLeaf + Math.floor(Math.random() * (rect.h - minLeaf * 2));
        return [
            ...bspSplit({ x: rect.x, y: rect.y, w: rect.w, h: splitAt }, depth - 1, minLeaf),
            ...bspSplit({ x: rect.x, y: rect.y + splitAt, w: rect.w, h: rect.h - splitAt }, depth - 1, minLeaf),
        ];
    }
}

/**
 * Pick a randomly-sized room rectangle that sits strictly inside a BSP
 * leaf node, with at least one tile of wall padding on each side. The
 * minimum room size is 3×3.
 */
export function bspRoomInNode(node: BSPRect): BSPRect {
    // Pad inward by 1 so rooms have wall borders inside the BSP node.
    const padding = 1;
    const maxW = Math.max(3, node.w - padding * 2);
    const maxH = Math.max(3, node.h - padding * 2);
    const minW = Math.min(3, maxW);
    const minH = Math.min(3, maxH);
    const roomW = minW + Math.floor(Math.random() * Math.max(1, maxW - minW + 1));
    const roomH = minH + Math.floor(Math.random() * Math.max(1, maxH - minH + 1));
    const roomX = node.x + padding + Math.floor(Math.random() * Math.max(1, node.w - padding * 2 - roomW + 1));
    const roomY = node.y + padding + Math.floor(Math.random() * Math.max(1, node.h - padding * 2 - roomH + 1));
    return { x: roomX, y: roomY, w: roomW, h: roomH };
}

/**
 * Integer center coordinate of a rect.
 */
export function bspRoomCenter(r: BSPRect): { x: number; y: number } {
    return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

/**
 * Carve an L-shaped corridor between two cell centers, randomly choosing
 * whether to run horizontal-first or vertical-first. Mutates the terrain
 * array in place; only `wall` cells are overwritten — existing
 * `room_floor` / `door` / `corridor_floor` cells are preserved so doors
 * stay connected to their rooms.
 */
export function bspCarveCorridor(
    terrain: HollowGateTerrain[],
    w: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
): void {
    // L-shape: horizontal then vertical (or vice versa), random choice.
    const horizontalFirst = Math.random() < 0.5;
    const cells: Array<{ x: number; y: number }> = [];
    if (horizontalFirst) {
        const [x1, x2] = from.x <= to.x ? [from.x, to.x] : [to.x, from.x];
        for (let x = x1; x <= x2; x += 1) cells.push({ x, y: from.y });
        const [y1, y2] = from.y <= to.y ? [from.y, to.y] : [to.y, from.y];
        for (let y = y1; y <= y2; y += 1) cells.push({ x: to.x, y });
    } else {
        const [y1, y2] = from.y <= to.y ? [from.y, to.y] : [to.y, from.y];
        for (let y = y1; y <= y2; y += 1) cells.push({ x: from.x, y });
        const [x1, x2] = from.x <= to.x ? [from.x, to.x] : [to.x, from.x];
        for (let x = x1; x <= x2; x += 1) cells.push({ x, y: to.y });
    }
    for (const c of cells) {
        const idx = c.y * w + c.x;
        // Only overwrite wall — never overwrite an existing room floor or door.
        if (terrain[idx] === "wall") terrain[idx] = "corridor_floor";
    }
}
