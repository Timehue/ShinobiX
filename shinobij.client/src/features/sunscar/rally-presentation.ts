import type { RallyRacer, RallyState, RallyTrack } from '../../../../shared/sunscar/rally-types';
import { rallyLanePosition, rallyPath, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { rallyResult } from '../../../../shared/sunscar/rally-simulation';

/** Separate finish spaces keep all four real pets visible while their result
 * animations play. This affects presentation only, never the race result. */
export function rallyPetPosition(state: RallyState, index: number) {
    const racer = state.racers[index], track = rallyTrack(state.trackId);
    if (!state.finished) {
        return rallyLanePosition(track, racer.distance, racer.lane * 2.65);
    }
    const place = rallyResult(state).placements.findIndex(p => p.id === racer.id);
    return rallyLanePosition(track, track.length + [6, 2, 2, -2][place], [0, -3.4, 3.4, 0][place]);
}

/** Where the chase camera heads for and looks at this frame; it eases toward
 * both. At the finish it pulls back far enough to frame the podium on a
 * portrait phone. */
export function rallyCameraGoal(track: RallyTrack, player: Pick<RallyRacer, 'distance' | 'lane' | 'jump'>, finished: boolean, aspect: number, reducedMotion: boolean) {
    const path = rallyPath(track, player.distance);
    const cameraLane = rallyLanePosition(track, player.distance - 10, player.lane * (reducedMotion ? .7 : 1.2));
    const cameraLook = rallyLanePosition(track, player.distance + 6, player.lane * .7);
    const finishDistance = Math.max(13, 9 / aspect);
    return {
        position: [finished ? path.x : cameraLane.x, (finished ? path.y : cameraLane.y) + (finished ? 7 : 5) + player.jump * .25, finished ? path.z + finishDistance : cameraLane.z] as [number, number, number],
        look: [finished ? path.x : cameraLook.x, (finished ? path.y : cameraLook.y) + 1.45 + player.jump * .6, finished ? path.z - 2 : cameraLook.z] as [number, number, number],
    };
}
