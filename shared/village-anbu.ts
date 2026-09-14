export const APPOINTED_ANBU_SEATS = 3;
export const EARNED_ANBU_SEATS = 7;
export const leadershipNameKey = (name: unknown) => String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
export const leadershipVillageKey = (name: unknown) => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function normalizeAnbuSeats(value: unknown): [string, string, string] {
    const raw = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    return Array.from({ length: APPOINTED_ANBU_SEATS }, (_, i) => {
        const name = typeof raw[i] === 'string' ? raw[i].trim().slice(0, 40) : '';
        const key = leadershipNameKey(name);
        if (!key || seen.has(key)) return '';
        seen.add(key);
        return name;
    }) as [string, string, string];
}

export type AnbuCandidate = { name: string; village: string; level?: number; totalPvpKills?: number; monthlyPvpKills?: number; pvpKillMonth?: string };
export function earnedAnbuCandidates(candidates: AnbuCandidate[], village: string, appointed: string[], month: string, limit = EARNED_ANBU_SEATS): AnbuCandidate[] {
    const excluded = new Set(appointed.map(leadershipNameKey));
    const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
    const ranked = candidates.filter(player => leadershipVillageKey(player.village) === leadershipVillageKey(village)
        && player.pvpKillMonth === month && count(player.monthlyPvpKills) > 0 && leadershipNameKey(player.name)
        && !excluded.has(leadershipNameKey(player.name)))
        .sort((a, b) => count(b.monthlyPvpKills) - count(a.monthlyPvpKills) || count(b.totalPvpKills) - count(a.totalPvpKills)
            || count(b.level) - count(a.level) || leadershipNameKey(a.name).localeCompare(leadershipNameKey(b.name)));
    const seen = new Set<string>();
    return ranked.filter(player => {
        const key = leadershipNameKey(player.name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, limit);
}
