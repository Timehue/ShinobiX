import type { HollowGateShrineRun } from '../types/character';

/** Delayed work may only affect the run and floor that requested it. */
export const hollowGateRunScopeMatches = (live: HollowGateShrineRun | null, expected: HollowGateShrineRun | null) =>
    !!live && !!expected && live.runToken === expected.runToken && live.floor === expected.floor;
