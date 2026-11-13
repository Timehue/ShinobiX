import type { WorldPoint } from '../../../shared/continuous-world-space';

/** World headings of the open world's movement keys (lower-cased `KeyboardEvent.key`). */
export const MOVEMENT_KEYS: Readonly<Record<string, WorldPoint>> = { w:{x:0,y:-1}, a:{x:-1,y:0}, s:{x:0,y:1}, d:{x:1,y:0}, arrowup:{x:0,y:-1}, arrowleft:{x:-1,y:0}, arrowdown:{x:0,y:1}, arrowright:{x:1,y:0} };

/** A held diagonal leans this little toward the newest key. It still picks the
 *  diagonal step and faces diagonally, but where a corner is shut the walker slides
 *  along the newest key's axis instead of whichever neighbour is listed first. */
const SIDE = .98, NORM = 1 / Math.hypot(1, SIDE);

/** The heading for the movement keys held, oldest first. The newest key leads; the
 *  most recent older key at right angles to it makes the step diagonal (W+D is
 *  north-east). Opposite keys do not cancel: the newer one wins. */
export function heldDirection(keys: readonly string[]): WorldPoint | null {
    const lead = MOVEMENT_KEYS[keys.at(-1) ?? ''];
    if (!lead) return null;
    for (let i = keys.length - 2; i >= 0; i--) {
        const side = MOVEMENT_KEYS[keys[i]!];
        if (side && side.x * lead.x + side.y * lead.y === 0)
            return { x: (lead.x + side.x * SIDE) * NORM, y: (lead.y + side.y * SIDE) * NORM };
    }
    return lead;
}
