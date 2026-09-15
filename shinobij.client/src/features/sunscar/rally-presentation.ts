import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyPath, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { rallyResult } from '../../../../shared/sunscar/rally-simulation';

/** Separate finish spaces keep all four real pets visible while their result
 * animations play. This affects presentation only, never the race result. */
export function rallyPetPosition(state: RallyState, index: number) {
    const racer = state.racers[index], track = rallyTrack(state.trackId);
    if (!state.finished) {
        const path = rallyPath(track, racer.distance);
        return { ...path, x: path.x + racer.lane * 2.65 };
    }
    const place = rallyResult(state).placements.findIndex(p => p.id === racer.id);
    const path = rallyPath(track, track.length + [6, 2, 2, -2][place]);
    return { ...path, x: path.x + [0, -3.4, 3.4, 0][place] };
}
