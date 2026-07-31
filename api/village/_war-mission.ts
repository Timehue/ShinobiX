/*
 * Village-war DAILY MISSION settlement (the Logbook "Claim" button).
 *
 * The client used to award this mission itself and lean on the autosave. Every
 * part of the award is server-owned, so the sanitizer discarded all of it while
 * KEEPING the `villageWarMissionDate` stamp — the claim was consumed and paid
 * nothing, and because `villageWarMissionsCompleted` never advanced, mission 0
 * was the only mission a player could ever reach.
 *
 * Mirrors lib/world-state.ts `claimVillageWarDailyMission`. The war-HP half is
 * NOT here: `applyVillageWarDamage` already persists through the shared
 * world-state channel, which is server-side. This owns only the character half.
 */

// Keep in sync with lib/world-state.ts (guarded by _war-mission.test.ts).
export const VILLAGE_WAR_DAILY_MISSIONS = 2;
export const VILLAGE_WAR_RAIDS_PER_MISSION = 3;

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type WarMissionRefusal =
    | 'out-of-order'
    | 'not-enough-raids'
    | 'invalid-mission'
    | 'no-village';

export function applyVillageWarMissionClaim(
    character: Record<string, unknown>,
    missionIndexRaw: unknown,
    today: string,
    month: string,
) {
    const missionIndex = Math.floor(Number(missionIndexRaw));
    if (!Number.isFinite(missionIndex) || missionIndex < 0 || missionIndex >= VILLAGE_WAR_DAILY_MISSIONS) {
        return { ok: false as const, reason: 'invalid-mission' as const };
    }
    if (!String(character.village ?? '').trim()) return { ok: false as const, reason: 'no-village' as const };

    // Daily counters reset with the stamp, exactly like the client's read.
    const sameDay = character.villageWarMissionDate === today;
    const progress = sameDay ? Math.max(0, Math.floor(num(character.villageWarRaidProgress))) : 0;
    const completed = sameDay ? Math.max(0, Math.floor(num(character.villageWarMissionsCompleted))) : 0;

    // Claiming out of order is also what makes this idempotent: once the claim
    // commits, `completed` has advanced, so a replay of the same index refuses.
    if (missionIndex !== completed) return { ok: false as const, reason: 'out-of-order' as const, completed };
    const required = (missionIndex + 1) * VILLAGE_WAR_RAIDS_PER_MISSION;
    if (progress < required) {
        return { ok: false as const, reason: 'not-enough-raids' as const, remaining: required - progress };
    }

    return {
        ok: true as const,
        completed: completed + 1,
        character: {
            ...character,
            // War missions deliberately skip dailyMissionsCompleted — they have
            // their own once-per-day-per-mission cap and don't consume the
            // shared daily mission allowance.
            clanMissionContrib: Math.max(0, Math.floor(num(character.clanMissionContrib))) + 1,
            totalMissionsCompleted: Math.max(0, Math.floor(num(character.totalMissionsCompleted))) + 1,
            clanContribMonth: month,
            villageWarMissionDate: today,
            villageWarRaidProgress: progress,
            villageWarMissionsCompleted: completed + 1,
        },
    };
}
