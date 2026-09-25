import { hollowGateFlavorFor } from "../data/hollow-gate-flavor";
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";
import { markHollowGateSeen } from "./hollow-gate-path";
import { wingEntryEffect } from "./hollow-gate-wings";

export type HollowGateMoveEffect = {
    wallBump: boolean;
    blockMessage?: string;
    committedTheme?: string;
    torchSputtered: boolean;
    justResolved: { tile: HollowGateTile; nx: number; ny: number } | null;
    ambushImmediate: boolean;
    step?: { requestId: string; fromX: number; fromY: number; toX: number; toY: number };
};

export function projectHollowGateMovement(
    prev: HollowGateShrineRun,
    dx: number,
    dy: number,
): { nextRun: HollowGateShrineRun; effect: HollowGateMoveEffect } | null {
    const nx = prev.playerX + dx;
    const ny = prev.playerY + dy;
    if (nx < 0 || ny < 0 || nx >= prev.width || ny >= prev.height) return null;
    const idx = ny * prev.width + nx;
    const tile = prev.tiles[idx];
    if (!tile) return null;
    if (tile.kind === "wall" || tile.terrain === "wall") {
        return { nextRun: prev, effect: { wallBump: true, torchSputtered: false, justResolved: null, ambushImmediate: false } };
    }
    const wingEff = wingEntryEffect(prev, tile.wing);
    if (wingEff.blocked) {
        return { nextRun: prev, effect: { wallBump: true, blockMessage: wingEff.message, torchSputtered: false, justResolved: null, ambushImmediate: false } };
    }
    const tiles = prev.tiles.slice();
    tiles[idx] = { ...tile, revealed: true, flavor: tile.flavor ?? hollowGateFlavorFor(tile.kind) };
    const nextRun = markHollowGateSeen({
        ...prev,
        ...(wingEff.patch ?? {}),
        playerX: nx,
        playerY: ny,
        tiles,
    });
    return {
        nextRun,
        effect: {
            wallBump: false,
            committedTheme: wingEff.committedTheme,
            torchSputtered: false,
            justResolved: !tile.resolved ? { tile: { ...tile, revealed: true }, nx, ny } : null,
            ambushImmediate: false,
            step: {
                requestId: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : "hg-step-" + Date.now() + "-" + Math.random().toString(36).slice(2),
                fromX: prev.playerX,
                fromY: prev.playerY,
                toX: nx,
                toY: ny,
            },
        },
    };
}
