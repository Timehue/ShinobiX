/*
 * Weekly Boss ryo payout (2026-10 economy rebalance, framework item #13 with
 * owner amendment A5).
 *
 * The pool used to be read off the spawn's `hpMax`, which drifts with the ISO
 * week (51,900 in W01 to 150,700 in W53), so the same fight paid 2.9x more in
 * December than in January. Rewards now read a fixed reference instead, and
 * each contributor's ryo is capped. The fight's own `hpMax`
 * (api/weekly-boss.ts defaultBossHp) is combat metadata only and is unchanged:
 * the companion damage cap and the enemy AI heal thresholds read it.
 *
 * Pure and shared so a screen can quote the same numbers the server pays. The
 * server reads its env dials (WB_REWARD_REF_HP, WB_PLAYER_CAP, WB_MVP_CAP) in
 * api/weekly-boss.ts and passes them in; these are the code defaults.
 */

/** Reward reference for the pool (framework dial WB_REWARD_REF_HP). */
export const WEEKLY_BOSS_REWARD_REF_HP = 100_000;
/** Per-contributor ryo cap (WB_PLAYER_CAP, owner amendment A5). */
export const WEEKLY_BOSS_PLAYER_RYO_CAP = 60_000;
/** The MVP's ryo cap (WB_MVP_CAP, owner amendment A5). */
export const WEEKLY_BOSS_MVP_RYO_CAP = 90_000;

export type WeeklyBossRewardParams = {
    refHp: number;
    playerCap: number;
    mvpCap: number;
};

export const WEEKLY_BOSS_REWARD_DEFAULTS: Readonly<WeeklyBossRewardParams> = Object.freeze({
    refHp: WEEKLY_BOSS_REWARD_REF_HP,
    playerCap: WEEKLY_BOSS_PLAYER_RYO_CAP,
    mvpCap: WEEKLY_BOSS_MVP_RYO_CAP,
});

export type WeeklyBossRyoDetail = {
    /** What the contributor is paid. */
    ryo: number;
    /** The uncapped formula value; `raw - ryo` is burned, never redistributed. */
    raw: number;
    /** The cap that clipped this payout, when one did. */
    cappedAt?: number;
};

/**
 * One contributor's ryo for a damage `share` in [0, 1]. The MVP (top damage)
 * doubles their share. The two floors (200 ryo and 100 x 0.75) mean any
 * contributor is paid at least 275. Character XP is retired, so the old XP
 * share folds into ryo at 0.75:1 exactly as before.
 */
export function weeklyBossRyoRewardDetail(
    share: number,
    isMvp: boolean,
    params: WeeklyBossRewardParams = WEEKLY_BOSS_REWARD_DEFAULTS,
): WeeklyBossRyoDetail {
    const s = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
    const m = isMvp ? 2 : 1;
    const baseRyo = Math.floor(params.refHp * 0.5);
    const baseXp = Math.floor(params.refHp * 0.25);
    const raw = Math.max(100, Math.floor(baseRyo * s * m + 200))
        + Math.floor(Math.max(50, Math.floor(baseXp * s * m + 100)) * 0.75);
    const cap = Math.max(0, Math.floor(isMvp ? params.mvpCap : params.playerCap));
    return raw > cap ? { ryo: cap, raw, cappedAt: cap } : { ryo: raw, raw };
}

export function weeklyBossRyoReward(
    share: number,
    isMvp: boolean,
    params: WeeklyBossRewardParams = WEEKLY_BOSS_REWARD_DEFAULTS,
): number {
    return weeklyBossRyoRewardDetail(share, isMvp, params).ryo;
}
