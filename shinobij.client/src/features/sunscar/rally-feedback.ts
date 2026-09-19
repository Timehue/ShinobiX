import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { rallyShotTarget } from '../../../../shared/sunscar/rally-combat';

export function rallyFeedback(state: RallyState) {
    const player = state.racers[0], track = rallyTrack(state.trackId);
    const remaining = Math.max(0, Math.ceil(track.length - player.distance));
    const target = rallyShotTarget(state, player);
    const event = state.events?.findLast(e => state.tick - e.tick <= 120 && (e.racerId === player.id || e.targetId === player.id));
    let message = '';
    if (event) {
        const outgoing = event.racerId === player.id;
        if (event.kind === 'shot-hit') message = outgoing ? 'Hit · rival slowed' : 'Hit · you were slowed';
        if (event.kind === 'shot-blocked') message = outgoing ? 'Blocked · rival guarded' : 'Blocked · your guard held';
        if (event.kind === 'shot-dodged') message = outgoing ? 'Dodged · rival escaped' : 'Dodged · clean escape';
        if (event.kind === 'shot-missed') message = 'Miss · line up a rival';
        if (event.kind === 'clean-jump' || event.kind === 'shortcut') {
            message = `${event.kind === 'clean-jump' ? 'Clean jump' : 'Shortcut'} · ${(event.value ?? 0) >= .5 ? `+${Math.round(event.value!)} Burst` : 'stamina full'}`;
        }
    }
    const obstacle = track.obstacles.find(o => o.at > player.distance + 1 && o.at < player.distance + 55
        && (Math.abs(o.lane - player.targetLane) < .4 || o.kind === 'shortcut' || o.kind === 'ramp'));
    const lane = obstacle?.lane === -1 ? 'left' : obstacle?.lane === 1 ? 'right' : 'center';
    const roadHint = !obstacle || player.finishTick !== null ? '' : `${obstacle.kind === 'shortcut' || obstacle.kind === 'ramp'
        ? `Shortcut ${lane} · Burst + jump` : obstacle.height > 1.6 ? 'Steer around tall load' : 'Jump low barrier'} · ${Math.ceil(obstacle.at - player.distance)} m`;
    return { remaining, finalStretch: remaining <= 140 && player.finishTick === null,
        targetId: target?.id, targetLabel: target ? `${target.armor || target.shieldTicks > 0 ? 'Guarded' : 'In line'} · ${target.pet.name} · ${Math.ceil(target.distance - player.distance)} m` : 'Line up a rival ahead',
        roadHint, message, eventKind: event?.kind ?? '' };
}
