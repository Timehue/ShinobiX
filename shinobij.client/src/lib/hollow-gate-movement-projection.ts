import { hollowGateFlavorFor } from "../data/hollow-gate-flavor";
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";
import { markHollowGateSeen } from "./hollow-gate-path";
import { wingEntryEffect } from "./hollow-gate-wings";
/** Boss-arena fissure beat (lib/hollow-gate-arena's, kept equal by a test). */
export const FISSURE_BEAT_MS = 1200;
import { undergroundFeatureBlocks } from '../../../shared/underground-floor-collision';

export type HollowGateMoveEffect = {
    wallBump: boolean;
    blockMessage?: string;
    committedTheme?: string;
    torchSputtered: boolean;
    justResolved: { tile: HollowGateTile; nx: number; ny: number } | null;
    ambushImmediate: boolean;
    /** This step broke open a sealed secret passage (lib/hollow-gate-secrets). */
    secretFound?: boolean;
    step?: { requestId: string; fromX: number; fromY: number; toX: number; toY: number };
};

export function projectHollowGateMovement(
    prev: HollowGateShrineRun,
    dx: number,
    dy: number,
    now: number = Date.now(),
): { nextRun: HollowGateShrineRun; effect: HollowGateMoveEffect } | null {
    const nx = prev.playerX + dx;
    const ny = prev.playerY + dy;
    if (nx < 0 || ny < 0 || nx >= prev.width || ny >= prev.height) return null;
    const idx = ny * prev.width + nx;
    const tile = prev.tiles[idx];
    if (!tile) return null;
    if (tile.kind === "wall" || tile.terrain === "wall" || tile.solid || undergroundFeatureBlocks(prev.floorFeatures, idx)) {
        return { nextRun: prev, effect: { wallBump: true, torchSputtered: false, justResolved: null, ambushImmediate: false } };
    }
    // Boss arena (lib/hollow-gate-arena): an erupting fissure holds you back
    // until its fire dies down, while the boss still stands.
    const stripe = prev.arenaFissures?.[idx];
    if (stripe !== undefined && Math.floor(now / FISSURE_BEAT_MS) % 3 === stripe
        && prev.tiles.some((t) => t.kind === "boss" && !t.resolved)) {
        return { nextRun: prev, effect: { wallBump: true, blockMessage: 'Spirit fire erupts from the fissure. Wait for it to die down, then cross.', torchSputtered: false, justResolved: null, ambushImmediate: false } };
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
            ...(tile.secret && !tile.revealed ? { secretFound: true } : {}),
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
