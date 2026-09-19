import { sunscarHash, sunscarRandom } from './random.js';
import { RALLY_RIVALS } from './rally-rivals.js';
import { rallyShotTarget } from './rally-combat.js';
import type { RallyAction, RallyRacer, RallyState, RallyTrack } from './rally-types.js';

/** Rivals make inputs, then obey the same physics, collisions and stamina as the player. */
export function rallyAi(state: RallyState, racer: RallyRacer, track: RallyTrack, difficulty = 0): RallyAction[] {
    if (state.tick < racer.aiNextTick || racer.finishTick !== null) return [];
    const rival = RALLY_RIVALS.find(entry => entry.id === racer.rivalId)!;
    const random = sunscarRandom(sunscarHash(`${state.seed}:${racer.id}:${racer.aiDecision++}`));
    const skill = Math.min(.97, rival.skill + difficulty * .025);
    racer.aiNextTick = state.tick + Math.max(9, rival.reaction - difficulty * 2) + Math.floor(random() * 12);
    const actions: RallyAction[] = [];
    const push = (kind: RallyAction['kind']) => actions.push({ tick: state.tick, kind });
    const ahead = track.obstacles.filter(o => o.at > racer.distance && o.at < racer.distance + Math.max(16, racer.speed * 1.55));
    const closest = ahead[0];
    if (closest && random() < skill) {
        const delta = closest.at - racer.distance;
        if (closest.kind === 'shortcut' || closest.kind === 'ramp') {
            if (random() < rival.shortcuts && racer.speed >= (closest.minSpeed ?? 13) - 1) {
                if (racer.targetLane !== closest.lane) push(closest.lane < racer.targetLane ? 'left' : 'right');
                // Arrive at the ramp while rising; an early jump lands before
                // the shortcut ring and never receives the ramp's lift.
                if (delta < racer.speed * (closest.kind === 'ramp' ? .28 : .5) && Math.abs(racer.lane - closest.lane) < .25) push('jump');
            }
        } else if (Math.abs(closest.lane - racer.targetLane) < .4) {
            if (closest.height <= 1.6 && delta < racer.speed * .42 && random() < skill) push('jump');
            else if (closest.height > 1.6 || random() < .3) {
                const lanes = [-1, 0, 1].filter(lane => lane !== closest.lane);
                lanes.sort((a, b) => ahead.filter(o => o.lane === a && o.height > 0).length - ahead.filter(o => o.lane === b && o.height > 0).length);
                push(lanes[0] < racer.targetLane ? 'left' : 'right');
            }
        }
    }
    const finishing = track.length - racer.distance < 190;
    const clear = !closest || closest.kind === 'ramp' || closest.kind === 'shortcut' || closest.lane !== racer.targetLane;
    const wantsBurst = clear && (finishing ? racer.stamina > 3 : racer.stamina > 32 + (1 - rival.aggression) * 28);
    if (wantsBurst !== racer.burst) push(wantsBurst ? 'burst-on' : 'burst-off');
    if (!racer.techniqueUsed && racer.distance > track.length * (.28 + (1 - rival.aggression) * .28)
        && (clear || racer.pet.element === 'Earth' || racer.pet.element === 'Water')) push('technique');
    const takingShortcut = ahead.some(o => (o.kind === 'ramp' || o.kind === 'shortcut') && o.lane === racer.targetLane);
    if (!takingShortcut && racer.attackCharge >= 100 && !racer.stagger && rallyShotTarget(state, racer) && random() < skill) push('attack');
    return actions;
}
