export const PET_EGG_CHANCE_PERCENT = 80;
export const PET_EGG_GAMEPLAY_MS = 12 * 60 * 60 * 1000;
export const PET_EGG_TICK_MS = 15_000;
export const PET_EGG_ACTIVITY_LEASE_MS = 45_000;

export type PetIncubation = {
    location?: 'sanctuary';
    incubationRemainingMs?: number;
    incubationUpdatedAt?: number;
    incubationActivityId?: string;
};

/** Only continuous, foreground gameplay earns time. A new tab/session or a
 * missed lease starts a new interval; offline gaps never catch up on return. */
export function tickPetIncubation<T extends PetIncubation>(session: T, now: number,
    activity: { id: string; active: boolean; elapsedMs: number }): T {
    if (session.incubationRemainingMs === undefined) return session;
    const gap = now - Number(session.incubationUpdatedAt ?? now);
    const continuous = activity.active && activity.id === session.incubationActivityId && gap >= 0 && gap <= PET_EGG_ACTIVITY_LEASE_MS;
    const elapsed = continuous ? Math.min(gap, Math.max(0, Math.min(PET_EGG_ACTIVITY_LEASE_MS, activity.elapsedMs))) : 0;
    return { ...session, incubationRemainingMs: Math.max(0, session.incubationRemainingMs - elapsed),
        incubationUpdatedAt: now, incubationActivityId: activity.active ? activity.id : undefined };
}
