import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * One stacking layer per board for every NPC (road wanderers, residents, the
 * weekly boss), so they can be layered by depth among themselves.
 *
 * Each NPC used to be its own overlay at z-index 6, so every one was a separate
 * stacking context with the same value and drew in mount order: a resident
 * further up the board could stand in front of one below it, wherever they
 * walked. The board renders `.sector-npc-layer` (z 6, the band NPCs always had
 * against landmarks and buildings) and each NPC portals its overlay into it,
 * with a z-index from its foot row.
 *
 * Context: undefined means no board layer, so the NPC draws in place as before.
 * Null means the board's layer has not mounted yet, so the NPC waits one commit.
 */
export const SectorNpcLayer = createContext<HTMLElement | null | undefined>(undefined);
export const useSectorNpcLayer = () => useContext(SectorNpcLayer);

/** Mount an NPC overlay in the board's layer, or in place when there is none. */
export const inNpcLayer = (layer: HTMLElement | null | undefined, node: ReactNode): ReactNode =>
    layer === undefined ? node : layer && createPortal(node, layer);

/** The board an NPC measures: the layer's board, or the overlay's own parent. */
export const npcBoard = (overlay: HTMLElement | null, layer: HTMLElement | null | undefined) =>
    layer ? layer.parentElement : overlay?.parentElement ?? null;

/** Lower on the board draws in front. Only written inside the shared layer. */
export function layerNpcByDepth(overlay: HTMLElement | null, row: number) {
    if (!overlay?.parentElement?.classList.contains('sector-npc-layer')) return;
    const z = String(1000 + Math.round(row * 16));
    if (overlay.style.zIndex !== z) overlay.style.zIndex = z;
}
