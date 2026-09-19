import { RALLY_ATTACK, type RallyElement, type RallyRacer, type RallyState } from './rally-types.js';

// Strength × duration stays close across elements. Wind gives up some impact
// for its wider aim; Lightning trades width for faster travel.
export const RALLY_SHOT_PROFILES: Record<RallyElement, { speed: number; width: number; slowSpeed: number; duration: number; description: string }> = {
    Fire: { speed: 38, width: .34, slowSpeed: .70, duration: .72, description: 'A sharp, short slow.' },
    Lightning: { speed: 46, width: .28, slowSpeed: .76, duration: .9, description: 'A fast bolt that rewards precise aim.' },
    Wind: { speed: 38, width: .48, slowSpeed: .82, duration: 1, description: 'A wider gust with a gentler slow.' },
    Earth: { speed: 32, width: .34, slowSpeed: .68, duration: .68, description: 'A slower projectile with a brief, heavy impact.' },
    Water: { speed: 38, width: .34, slowSpeed: .84, duration: 1.35, description: 'A gentle slow that lingers longer.' },
};

/** Aim hint only: predicts reach at current pace, never steers or homes a shot. */
export function rallyShotTarget(state: RallyState, shooter: RallyRacer): RallyRacer | undefined {
    if (shooter.finishTick !== null) return undefined;
    const shot = RALLY_SHOT_PROFILES[shooter.pet.element];
    let target: RallyRacer | undefined;
    for (const racer of state.racers) {
        const gap = racer.distance - shooter.distance;
        const reach = RALLY_ATTACK.range * Math.max(0, 1 - racer.speed / shot.speed);
        if (racer.id === shooter.id || racer.finishTick !== null || racer.jump > 1.05 || gap <= .6 || gap > reach
            || Math.abs(racer.lane - shooter.lane) > shot.width) continue;
        if (!target || racer.distance < target.distance) target = racer;
    }
    return target;
}
