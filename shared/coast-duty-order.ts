import type { RoomDuty, RoomDutyProgress } from './coast-room-duties.js';

/** Older notebooks alternated two orders. Keep their current reading until the next shift. */
export function dutyOrder(duty: RoomDuty, progress?: RoomDutyProgress): number {
    const saved = progress?.order;
    return saved !== undefined && duty.cases[saved] ? saved : Math.floor((progress?.tick ?? 0) / 4) % 2;
}
