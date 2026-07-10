/*
 * Personal Village Merit — the server-owned, sanitizer-pinned metric that gates
 * a Kage challenge (KAGE_MIN_MERIT = 250 in _kage-challenge.ts). Accrued ONLY by
 * server-authoritative village-support actions; never by a client save write
 * (the save sanitizer pins `villageMerit` with maxDelta 0 — see api/save/[name].ts).
 *
 * Phase 1 sources (all already server-authoritative + idempotent):
 *   - daily village agenda claim   (+MERIT_DAILY_AGENDA, once/day NX marker)
 *   - village-treasury donation    (meritForDonation, scaled by ryo-value; costs
 *                                    real currency, so no free farming)
 *   - map-control claim            (+MERIT_MAP_CONTROL, once/day NX marker)
 *   - war-crate win                (+MERIT_WAR_WIN, once/war via the same NX key
 *                                    that guards the legacy warsWon bump)
 *   - mission / hunt completion    (+MERIT_MISSION, day-capped completions)
 *
 * Phase 2 (documented, not yet wired): sector-war resolve win
 * (api/village/sector-war.ts doResolve), guard-queue defense
 * (api/missions/report-pvp-win.ts guard marker), and enemy-village PvP wins —
 * each needs a fresh mutatePlayerSave plus the anti-farm gates already present
 * in those handlers.
 */
export const MERIT_DAILY_AGENDA = 20;
export const MERIT_MAP_CONTROL = 15;
export const MERIT_WAR_WIN = 40;
export const MERIT_MISSION = 2;
export const MERIT_DONATION_CAP = 25;

/** Village Merit for a treasury donation, scaled by ryo-value, capped per donation. */
export function meritForDonation(ryoValue: number): number {
    return Math.min(MERIT_DONATION_CAP, Math.floor(Math.max(0, ryoValue) / 1000));
}

/** Coerce a possibly-undefined save field to a finite non-negative number. */
export function meritNum(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}
