import type { RallyMotion } from '../../../../shared/sunscar/rally-types';

/** The baked contact surface in each square cell, measured from its top. */
export const RALLY_ECONOMY_CONTACT_ANCHOR = .92;

/** Rivals start behind zero; keep their running crop inside the four-frame strip. */
export function rallyEconomyRunFrame(distance: number): number {
    return ((Math.floor(distance / 5 * 4) % 4) + 4) % 4;
}

/** Place baked feet on the road; only physics supplies the airborne gap.
 * Landing squash pivots around that contact instead of lifting the whole pet. */
export function rallyEconomyPose({ groundY, spriteHeight, jumpLift, motion, landingTicks, reducedMotion }: {
    groundY: number;
    spriteHeight: number;
    jumpLift: number;
    motion: RallyMotion;
    landingTicks: number;
    reducedMotion: boolean;
}) {
    const lift = Math.max(0, jumpLift);
    const landing = motion === 'land' && !reducedMotion ? Math.max(0, Math.min(1, landingTicks / 11)) : 0;
    const height = spriteHeight * (1 - landing * .08);
    const width = spriteHeight * (1 + landing * .04);
    const contactY = groundY - lift;
    const airborne = Math.min(1, lift / Math.max(1, spriteHeight));
    return {
        top: contactY - height * RALLY_ECONOMY_CONTACT_ANCHOR,
        width,
        height,
        contactY,
        shadowScale: 1 - airborne * .45,
        shadowOpacity: 1 - airborne * .6,
    };
}
