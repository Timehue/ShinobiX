import type { RallyRacer, RallyState, RallyTrack } from '../../../../shared/sunscar/rally-types';
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

/** Where the chase camera heads for and looks at this frame; it eases toward
 * both. At the finish it pulls back far enough to frame the podium on a
 * portrait phone. */
export function rallyCameraGoal(track: RallyTrack, player: Pick<RallyRacer, 'distance' | 'lane' | 'jump'>, finished: boolean, aspect: number, reducedMotion: boolean) {
    const path = rallyPath(track, player.distance);
    const preview = rallyPath(track, player.distance + 20);
    const finishDistance = Math.max(13, 9 / aspect);
    return {
        position: [path.x + (finished ? 0 : player.lane * (reducedMotion ? .7 : 1.2)), path.y + (finished ? 7 : 5) + player.jump * .25, path.z + (finished ? finishDistance : 10)] as [number, number, number],
        look: [finished ? path.x : preview.x * .2 + path.x * .8 + player.lane * .7, path.y + 1.45 + player.jump * .6, path.z - (finished ? 2 : 6)] as [number, number, number],
    };
}
