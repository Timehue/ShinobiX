import { rallyPath } from '../../../../shared/sunscar/rally-tracks';
import type { RallyTrack } from '../../../../shared/sunscar/rally-types';

export const RALLY_ECONOMY_VIEW = { behind: -12, ahead: 125 } as const;

/** Four separate finish spots keep every companion visible on portrait phones. */
export function rallyEconomyFinishSlot(place: number) { return { distance: 18, lane: (place - 1.5) * 1.05 }; }

/** Same distances and three lanes as the authoritative track, in a cheap chase view. */
export function rallyEconomyProjection(track: RallyTrack, playerDistance: number, distance: number, lane: number, width: number, height: number) {
    const gap = distance - playerDistance;
    const scale = 28 / Math.max(16, 28 + gap);
    const unit = Math.min(width * .085, 54);
    const bend = rallyPath(track, distance).x - rallyPath(track, playerDistance).x;
    return { x: width / 2 + (bend + lane * 2.65) * unit * scale,
        y: height * .24 + height * .49 * scale, scale, unit,
        visible: gap >= RALLY_ECONOMY_VIEW.behind && gap <= RALLY_ECONOMY_VIEW.ahead };
}
