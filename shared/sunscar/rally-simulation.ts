import { clamp } from './random.js';
import { rallyAi } from './rally-ai.js';
import { rallySection, rallyTrack } from './rally-tracks.js';
import { RALLY_SHOT_PROFILES, rallyShotTarget } from './rally-combat.js';
import { RALLY_ATTACK, RALLY_CLEAN_REWARD, RALLY_HZ, RALLY_MAX_TICKS, RALLY_POINTS, RALLY_VERSION, type RallyAction, type RallyEvent, type RallyPet, type RallyRacer, type RallyRaceResult, type RallyState, type RallyTrack } from './rally-types.js';

/** Older saved races resume with an empty charge, without changing their standings. */
export function restoreRallyRace(saved: RallyState): RallyState {
    const state = structuredClone(saved);
    state.version = RALLY_VERSION;
    state.shots ??= [];
    state.events ??= [];
    for (const shot of state.shots) {
        // Preserve already-fired legacy shots at their original strength.
        shot.slowSpeed ??= RALLY_ATTACK.slowSpeed; shot.speed ??= RALLY_ATTACK.speed; shot.width ??= .34;
        shot.targetId ??= null; shot.targetPassed ??= false;
    }
    for (const racer of state.racers) {
        racer.attackCharge ??= 0; racer.recoilTicks ??= 0; racer.slowTicks ??= 0;
        racer.shieldTicks ??= 0; racer.shotsFired ??= 0; racer.shotsHit ??= 0;
        racer.slowSpeed ??= RALLY_ATTACK.slowSpeed; racer.cleanJumps ??= 0; racer.staminaEarned ??= 0;
        racer.shortcutTimeGained ??= 0; racer.attackTimeGained ??= 0;
    }
    return state;
}

export function createRallyRace(seed: number, trackId: string, entrants: { id: string; pet: RallyPet; rivalId: string | null }[]): RallyState {
    rallyTrack(trackId);
    if (entrants.length !== 4 || entrants[0].rivalId !== null || new Set(entrants.map(e => e.id)).size !== 4) throw new Error('A race needs one player and three different rivals.');
    return { version: RALLY_VERSION, seed: seed >>> 0, trackId, tick: 0, finished: false, shots: [], events: [], racers: entrants.map((entry, index) => ({
        ...structuredClone(entry), distance: -index * 1.25, lane: [0, -1, 1, 0][index], targetLane: [0, -1, 1, 0][index],
        speed: 0, stamina: 100, jump: 0, verticalSpeed: 0, jumpCooldown: 0, landing: 0, burst: false,
        techniqueUsed: false, techniqueTicks: 0, armor: false, stagger: 0, finishTick: null, hits: 0, shortcuts: 0, shortcutTicks: 0,
        processed: [], motion: 'ready', aiNextTick: 0, aiDecision: 0,
        attackCharge: 0, recoilTicks: 0, slowTicks: 0, shieldTicks: 0, shotsFired: 0, shotsHit: 0,
        slowSpeed: RALLY_ATTACK.slowSpeed, cleanJumps: 0, staminaEarned: 0, shortcutTimeGained: 0, attackTimeGained: 0,
    })) };
}

function raceEvent(state: RallyState, event: Omit<RallyEvent, 'tick'>): void {
    state.events.push({ tick: state.tick, ...event });
    if (state.events.length > 12) state.events.shift();
}
function cleanReward(state: RallyState, racer: RallyRacer, kind: 'clean-jump' | 'shortcut', amount: number): void {
    const earned = Math.min(amount, 100 - racer.stamina);
    racer.stamina += earned;
    racer.staminaEarned += earned;
    raceEvent(state, { kind, racerId: racer.id, value: earned });
}

function applyInput(state: RallyState, racer: RallyRacer, action: RallyAction): void {
    if (racer.finishTick !== null) return;
    const element = racer.pet.element;
    const active = racer.techniqueTicks > 0;
    if (action.kind === 'left') racer.targetLane = Math.max(-1, racer.targetLane - 1);
    if (action.kind === 'right') racer.targetLane = Math.min(1, racer.targetLane + 1);
    if (action.kind === 'burst-on') racer.burst = true;
    if (action.kind === 'burst-off') racer.burst = false;
    if (action.kind === 'jump' && racer.jump === 0 && racer.jumpCooldown === 0 && !racer.stagger) {
        racer.verticalSpeed = 7.6 + racer.pet.profile.agility * .018 + (active && element === 'Wind' ? 1.4 : 0);
        racer.jump = .001;
        racer.jumpCooldown = 58;
    }
    if (action.kind === 'technique' && !racer.techniqueUsed) {
        racer.techniqueUsed = true;
        racer.techniqueTicks = (element === 'Water' ? 6 : element === 'Wind' ? 5 : 4) * RALLY_HZ;
        racer.armor = element === 'Earth';
    }
    if (action.kind === 'attack' && racer.attackCharge >= 100 && !racer.stagger && !racer.recoilTicks) {
        const profile = RALLY_SHOT_PROFILES[element];
        const targetId = rallyShotTarget(state, racer)?.id ?? null;
        racer.attackCharge = 0;
        racer.recoilTicks = RALLY_ATTACK.recoilTicks;
        racer.speed *= RALLY_ATTACK.recoilSpeed;
        racer.shotsFired++;
        state.shots.push({ ownerId: racer.id, element, distance: racer.distance, lane: racer.lane,
            remaining: RALLY_ATTACK.range, slowTicks: Math.round((45 + racer.pet.profile.acceleration * .18) * profile.duration),
            slowSpeed: profile.slowSpeed, speed: profile.speed, width: profile.width, targetId, targetPassed: false });
    }
}

function advanceShots(state: RallyState): void {
    for (let i = state.shots.length - 1; i >= 0; i--) {
        const shot = state.shots[i];
        const travel = Math.min(shot.remaining, shot.speed / RALLY_HZ);
        const before = shot.distance;
        shot.distance += travel; shot.remaining -= travel;
        // Swept collision selects the first racer in this lane. Jumping and
        // steering dodge shots; immunity prevents repeated hits from stacking.
        let target: RallyRacer | undefined;
        for (const racer of state.racers) {
            if (racer.id === shot.ownerId || racer.finishTick !== null || racer.jump > 1.05
                || Math.abs(racer.lane - shot.lane) > shot.width || racer.distance < before - .6 || racer.distance > shot.distance + .6) continue;
            if (!target || racer.distance < target.distance) target = racer;
        }
        if (target) {
            const blocked = target.armor || target.shieldTicks > 0;
            if (target.armor) target.armor = false;
            if (blocked) raceEvent(state, { kind: 'shot-blocked', racerId: shot.ownerId, targetId: target.id });
            else {
                target.slowTicks = Math.round(shot.slowTicks * (1 - target.pet.profile.stability * .003));
                target.slowSpeed = shot.slowSpeed;
                target.speed *= shot.slowSpeed;
                raceEvent(state, { kind: 'shot-hit', racerId: shot.ownerId, targetId: target.id });
            }
            if (!blocked || target.shieldTicks === 0) target.shieldTicks = RALLY_ATTACK.immunityTicks;
            const owner = state.racers.find(r => r.id === shot.ownerId);
            if (owner && !blocked) {
                owner.shotsHit++;
                owner.attackTimeGained += target.slowTicks / RALLY_HZ * (1 - shot.slowSpeed);
            }
        } else if (shot.targetId && !shot.targetPassed) {
            const intended = state.racers.find(r => r.id === shot.targetId);
            if (intended && intended.finishTick === null && shot.distance > intended.distance + .6) {
                shot.targetPassed = true;
                raceEvent(state, { kind: 'shot-dodged', racerId: shot.ownerId, targetId: intended.id });
            }
        }
        if (!target && shot.remaining <= 0 && !shot.targetPassed) raceEvent(state, { kind: 'shot-missed', racerId: shot.ownerId });
        if (target || shot.remaining <= 0) state.shots.splice(i, 1);
    }
}

function advanceRacer(state: RallyState, racer: RallyRacer, track: RallyTrack): void {
    if (racer.finishTick !== null) return;
    const dt = 1 / RALLY_HZ;
    const profile = racer.pet.profile;
    const element = racer.pet.element;
    const active = racer.techniqueTicks > 0;
    const section = rallySection(track, Math.max(0, racer.distance));
    const handling = (3.2 + profile.agility * .045) * (active && element === 'Lightning' ? 2.5 : active && element === 'Water' ? 1.4 : 1);
    racer.lane += clamp(racer.targetLane - racer.lane, -handling * dt, handling * dt);
    let terrain = section.terrain === 'deep-sand' ? .7 + profile.endurance * .0014 : section.terrain === 'alley' ? .96 : 1;
    if (racer.jump > .2 || active && (element === 'Water' || element === 'Wind')) terrain = 1;
    const bursting = racer.burst && racer.stamina > 0 && racer.stagger === 0;
    const pace = (12.8 + profile.speed * .036) * terrain * (bursting ? 1.28 : 1) * (racer.stagger > 0 ? .48 : 1);
    const techniquePace = active && element === 'Fire' ? 3.2 : active && element === 'Lightning' ? 1.8 : 0;
    const target = (pace * (racer.shortcutTicks > 0 ? 1.48 : 1) + techniquePace)
        * (racer.recoilTicks > 0 ? RALLY_ATTACK.recoilSpeed : 1) * (racer.slowTicks > 0 ? racer.slowSpeed : 1);
    // Nominal pace-equivalent seconds, shown as estimates in the finish board.
    if (racer.shortcutTicks > 0) racer.shortcutTimeGained += pace * .48 / (pace + techniquePace) * dt;
    const accel = (5 + profile.acceleration * .07) * (active && element === 'Fire' ? 2 : 1);
    racer.speed += clamp(target - racer.speed, -22 * dt, accel * dt);
    racer.stamina = clamp(racer.stamina + (bursting ? -(27 - profile.endurance * .12) : 7 + profile.endurance * .035) * dt, 0, 100);
    if (racer.stamina === 0) racer.burst = false;
    racer.jumpCooldown = Math.max(0, racer.jumpCooldown - 1);
    racer.landing = Math.max(0, racer.landing - 1);
    racer.stagger = Math.max(0, racer.stagger - (active && element === 'Water' ? 2 : 1));
    racer.shortcutTicks = Math.max(0, racer.shortcutTicks - 1);
    racer.attackCharge = Math.min(100, racer.attackCharge + 100 / RALLY_ATTACK.chargeTicks);
    // Snap the final fractional step so charge is ready on exactly tick 480.
    if (racer.attackCharge > 100 - 1e-8) racer.attackCharge = 100;
    racer.recoilTicks = Math.max(0, racer.recoilTicks - 1);
    racer.slowTicks = Math.max(0, racer.slowTicks - (active && element === 'Water' ? 2 : 1));
    racer.shieldTicks = Math.max(0, racer.shieldTicks - 1);
    if (racer.jump > 0) {
        racer.verticalSpeed -= (active && element === 'Wind' ? 17 : 21) * dt;
        racer.jump = Math.max(0, racer.jump + racer.verticalSpeed * dt);
        if (racer.jump === 0) { racer.verticalSpeed = 0; racer.landing = 11; }
    }
    const before = racer.distance;
    racer.distance += racer.speed * dt;
    for (const obstacle of track.obstacles) {
        if (obstacle.at <= before || obstacle.at > racer.distance || racer.processed.includes(obstacle.id)) continue;
        racer.processed.push(obstacle.id);
        if (Math.abs(racer.lane - obstacle.lane) > .31) continue;
        if (obstacle.kind === 'ramp') {
            if (racer.jump > .05 && racer.verticalSpeed > 0) racer.verticalSpeed += 2.1;
        } else if (obstacle.kind === 'shortcut') {
            if (Math.abs(racer.lane - obstacle.lane) < .18 && racer.jump > .65 && racer.speed >= (obstacle.minSpeed ?? 14)) {
                racer.shortcutTicks = Math.round((obstacle.gain ?? 15) / Math.max(1, racer.speed * .48) * RALLY_HZ);
                racer.shortcuts++;
                cleanReward(state, racer, 'shortcut', RALLY_CLEAN_REWARD.shortcut);
            } else {
                racer.speed *= .75;
                racer.stagger = 18;
            }
        } else if (racer.jump < obstacle.height) {
            if (racer.armor && obstacle.breakable) { racer.armor = false; }
            else {
                racer.speed *= .5 + profile.stability * .0025;
                racer.stagger = Math.round(70 - profile.stability * .4);
                racer.hits++;
            }
        } else if (obstacle.height > 0 && obstacle.height <= 1.6) {
            racer.cleanJumps++;
            cleanReward(state, racer, 'clean-jump', RALLY_CLEAN_REWARD.jump);
        }
    }
    racer.motion = racer.stagger > 0 ? 'stagger' : racer.jump > 0 ? (racer.verticalSpeed > 3 ? 'jump' : 'airborne')
        : racer.landing > 0 ? 'land' : active ? 'technique' : bursting ? 'sprint' : state.tick < 45 ? 'start' : 'run';
    racer.techniqueTicks = Math.max(0, racer.techniqueTicks - 1);
    if (racer.distance >= track.length) {
        racer.finishTick = state.tick + clamp((track.length - before) / (racer.distance - before), 0, 1);
        racer.distance = track.length;
        racer.burst = false;
    }
}

/** Mutable fixed-step simulation for render loops and identical server replay. */
export function stepRally(state: RallyState, actions: readonly RallyAction[] = [], difficulty = 0): void {
    if (state.finished) return;
    while (state.events.length && state.tick - state.events[0].tick > 150) state.events.shift();
    const track = rallyTrack(state.trackId);
    for (const action of actions) if (action.tick === state.tick) applyInput(state, state.racers[0], action);
    for (const racer of state.racers) {
        if (racer.rivalId) for (const action of rallyAi(state, racer, track, difficulty)) applyInput(state, racer, action);
        advanceRacer(state, racer, track);
    }
    advanceShots(state);
    state.tick++;
    if (state.tick >= RALLY_MAX_TICKS || state.racers.every(r => r.finishTick !== null)) {
        state.finished = true;
        for (const [index, racer] of rallyOrder(state).entries()) racer.motion = index === 0 ? 'victory' : 'defeat';
    }
}
export function rallyOrder(state: RallyState): RallyRacer[] {
    return [...state.racers].sort((a, b) => (a.finishTick ?? Infinity) - (b.finishTick ?? Infinity) || b.distance - a.distance || a.id.localeCompare(b.id));
}
export function rallyResult(state: RallyState): RallyRaceResult {
    if (!state.finished) throw new Error('The race has not finished.');
    return { trackId: state.trackId, placements: rallyOrder(state).map((r, i) => ({ id: r.id, tick: r.finishTick ?? RALLY_MAX_TICKS, points: RALLY_POINTS[i], hits: r.hits, shortcuts: r.shortcuts })) };
}

/** Reject malformed, unordered, excessive and out-of-window input before replay. */
export function validateRallyActions(raw: unknown, from: number, to: number): RallyAction[] {
    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from > 600 || to > RALLY_MAX_TICKS || !Array.isArray(raw) || raw.length > 180) throw new Error('Invalid race checkpoint.');
    const kinds = ['left', 'right', 'jump', 'burst-on', 'burst-off', 'technique', 'attack'];
    let last = from;
    const seen = new Set<string>();
    return raw.map(value => {
        if (!value || typeof value !== 'object') throw new Error('Invalid race input.');
        const a = value as RallyAction;
        if (!Number.isInteger(a.tick) || a.tick < last || a.tick >= to || !kinds.includes(a.kind) || seen.has(`${a.tick}:${a.kind}`)) throw new Error('Invalid race input.');
        last = a.tick;
        seen.add(`${a.tick}:${a.kind}`);
        return { tick: a.tick, kind: a.kind };
    });
}
export function replayRallyCheckpoint(state: RallyState, to: number, raw: unknown, difficulty = 0): RallyState {
    const actions = validateRallyActions(raw, state.tick, to);
    const next = restoreRallyRace(state);
    let index = 0;
    while (next.tick < to && !next.finished) {
        const frame: RallyAction[] = [];
        while (index < actions.length && actions[index].tick === next.tick) frame.push(actions[index++]);
        stepRally(next, frame, difficulty);
    }
    return next;
}
