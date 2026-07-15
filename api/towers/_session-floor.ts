import { getFloor, type TowerFloor } from './_floor-catalog.js';
import type { TowerSession } from './_tower-session.js';

/** Resolve the immutable rules sealed onto a dynamic PvE run, or a catalog floor. */
export function floorForSession(session: TowerSession): TowerFloor | undefined {
    return session.encounterFloor ?? getFloor(session.floor);
}
