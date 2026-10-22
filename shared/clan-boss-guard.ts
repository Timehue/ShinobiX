export const CLAN_BOSS_GUARDED_MULTIPLIER = .25;
export const CLAN_BOSS_OPEN_MULTIPLIER = .75;
export type ClanBossGuardState = {
    version: 2;
    bossId: string;
    round: number;
    openThroughRound: number;
    contributors: string[];
    openings: Record<string, number>;
    sharedHp: { remainingAtStart: number; poolMax: number; assaultHp: number };
};
export function clanBossGuardMultiplier(state: ClanBossGuardState | undefined, round: number, targetId: string): number {
    if (!state || state.version !== 2 || targetId !== state.bossId) return 1;
    return round <= state.openThroughRound ? CLAN_BOSS_OPEN_MULTIPLIER : CLAN_BOSS_GUARDED_MULTIPLIER;
}
