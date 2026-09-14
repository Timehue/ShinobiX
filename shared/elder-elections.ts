import { leadershipNameKey, leadershipVillageKey } from './village-anbu.js';

export const ELDER_TERM_MS = 30 * 86400000;
export const ELDER_WIN_HISTORY_MS = 90 * 86400000;
export type ElderWinDay = { day: string; village: string; pvp: number; pve: number };
export type ElderCouncil = { version: 1; startedAt: number; nextSelectionAt: number; seats: [string, string, string]; winningScores: [number, number]; };
const count = (v: unknown) => Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0;

export function normalizeElderWinDays(value: unknown, now = Date.now()): ElderWinDay[] {
    if (!Array.isArray(value)) return [];
    return value.filter((row): row is ElderWinDay => !!row && typeof row === 'object'
        && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Date.parse(row.day) >= now - ELDER_WIN_HISTORY_MS
        && Date.parse(row.day) <= now && typeof row.village === 'string')
        .map(row => ({ day: row.day, village: leadershipVillageKey(row.village), pvp: count(row.pvp), pve: count(row.pve) }));
}

export function creditElderWins<T extends Record<string, unknown>>(character: T, pvp: number, pve: number, at = Date.now(), now = at): T {
    const village = leadershipVillageKey(character.village);
    if (!village || (!pvp && !pve) || at < now - ELDER_WIN_HISTORY_MS || at > now) return character;
    const days = normalizeElderWinDays(character.elderWinDays, now);
    const day = new Date(at).toISOString().slice(0, 10);
    const existing = days.find(row => row.day === day && row.village === village);
    if (existing) { existing.pvp += count(pvp); existing.pve += count(pve); }
    else days.push({ day, village, pvp: count(pvp), pve: count(pve) });
    return { ...character, elderWinDays: days };
}

/** Called only by server settlements, in the same atomic write as the win counters. */
export function creditElderWinDeltas<T extends Record<string, unknown>>(before: Record<string, unknown>, after: T, at = Date.now()): T {
    return creditElderWins(after, Math.max(0, count(after.totalPvpKills) - count(before.totalPvpKills)),
        Math.max(0, count(after.totalAiKills) - count(before.totalAiKills)), at);
}

export function elderTermScore(days: unknown, village: string, start: number, end: number): { pvp: number; pve: number } {
    const key = leadershipVillageKey(village);
    return normalizeElderWinDays(days, end).filter(row => row.village === key && Date.parse(row.day) >= start && Date.parse(row.day) < end)
        .reduce((sum, row) => ({ pvp: sum.pvp + row.pvp, pve: sum.pve + row.pve }), { pvp: 0, pve: 0 });
}

/** Earned seats stay fixed for a term. A tied score resolves by stable player name. */
export function selectEarnedElders(candidates: { name: string; pvp: number; pve: number }[]): { seats: [string, string]; scores: [number, number] } {
    const rank = (kind: 'pvp' | 'pve', exclude = '') => candidates.filter(p => count(p[kind]) > 0 && leadershipNameKey(p.name) !== exclude)
        .sort((a, b) => count(b[kind]) - count(a[kind]) || leadershipNameKey(a.name).localeCompare(leadershipNameKey(b.name)))[0];
    const pvp = rank('pvp');
    const pve = rank('pve', leadershipNameKey(pvp?.name));
    return { seats: [pvp?.name ?? '', pve?.name ?? ''], scores: [count(pvp?.pvp), count(pve?.pve)] };
}
