import { applyDerivedLevel } from '../_xp-engine.js';
import { economyDial, economySwitch } from '../_economy-dials.js';

export type EndlessRun = { runToken: string; wave: number; bankedRyo: number; bankedXp: number; startedAt: number; highestMilestoneClaimed?: number };
const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));

// Economy rebalance dials (2026-10, framework §8.3). Each constant is the code
// default; the display-only preview in shinobij.client/src/lib/endless-tower.ts
// mirrors it, and scripts/endless-wave-parity.test.ts pins the two equal. The
// accessors read the env var of the same name at call time, so a lever can be
// killed on Railway without a deploy. Until a client build carries the same
// value, the lobby preview keeps showing the default.
/** Wave pay stops scaling at this wave; opponent difficulty does not. Kill value 200. */
export const ENDLESS_FACTOR_CAP_WAVE = 20;
/** The level term of the wave pay uses min(level, this). Kill value 1000. */
export const ENDLESS_LEVEL_CAP = 70;
/** Final multiplier on the wave pay. Kill value 1. */
export const ENDLESS_REWARD_MULT = 0.55;
/** Fate Shard milestones pay only on a wave beyond the account's best. Kill value false (re-arm every run). */
export const ENDLESS_FS_LIFETIME_FIRST = true;
/** Bone Charm milestones pay only on the first run of the UTC day. Kill value false. */
export const ENDLESS_BC_FIRST_RUN_OF_DAY = true;
export const endlessFactorCapWave = (): number => Math.floor(economyDial('ENDLESS_FACTOR_CAP_WAVE', ENDLESS_FACTOR_CAP_WAVE, { min: 1, max: 200 }));
export const endlessLevelCap = (): number => Math.floor(economyDial('ENDLESS_LEVEL_CAP', ENDLESS_LEVEL_CAP, { min: 1, max: 1000 }));
export const endlessRewardMult = (): number => economyDial('ENDLESS_REWARD_MULT', ENDLESS_REWARD_MULT, { min: 0.1, max: 1 });
export const endlessFsLifetimeFirst = (): boolean => economySwitch('ENDLESS_FS_LIFETIME_FIRST', ENDLESS_FS_LIFETIME_FIRST);
export const endlessBcFirstRunOfDay = (): boolean => economySwitch('ENDLESS_BC_FIRST_RUN_OF_DAY', ENDLESS_BC_FIRST_RUN_OF_DAY);

/** Opponent difficulty. Uncapped: _wave-opponent.ts clamps stats and HP itself. */
export function endlessScaleFactor(waveRaw: unknown): number {
    const wave = Math.max(1, whole(waveRaw));
    return Math.max(1, 1 + (wave - 1) * 0.08 + Math.floor(wave / 5) * 0.10 + Math.floor(wave / 10) * 0.15);
}
/** Reward-only factor: past ENDLESS_FACTOR_CAP_WAVE every wave pays the cap wave's base. */
export function endlessRewardFactor(waveRaw: unknown): number {
    return endlessScaleFactor(Math.min(Math.max(1, whole(waveRaw)), endlessFactorCapWave()));
}
export function endlessWaveReward(waveRaw: unknown, levelRaw: unknown) {
    const wave = Math.max(1, whole(waveRaw)); const level = Math.min(endlessLevelCap(), Math.max(1, whole(levelRaw))); const factor = endlessRewardFactor(wave);
    const multiplier = wave % 5 === 0 ? (wave % 10 === 0 ? 3 : 2) : 1;
    // Character XP is retired (leveling-without-xp map): the old xp line folds
    // into banked ryo at ~0.75:1, preserving the bank-or-lose tension without a
    // stat faucet on an infinite-repeat mode. `xp` stays as 0 for old clients.
    const raw = Math.floor((40 + level * 6) * factor * multiplier) + Math.floor((15 + level * 2) * factor * multiplier * 0.75);
    return { ryo: Math.floor(raw * endlessRewardMult()), xp: 0 };
}
export function endlessMilestoneReward(waveRaw: unknown) {
    const wave = whole(waveRaw); if (wave <= 0 || wave % 5 !== 0) return { boneCharms: 0, fateShards: 0 };
    const pos = (Math.floor(wave / 5) - 1) % 4;
    return pos === 0 || pos === 1 ? { boneCharms: 5, fateShards: 0 }
        : pos === 2 ? { boneCharms: 0, fateShards: 5 } : { boneCharms: 5, fateShards: 5 };
}
export function endlessEntryCost(character: Record<string, unknown>, day: string): number {
    const used = character.dailyEndlessDate === day ? whole(character.dailyEndlessRuns) : 0;
    return used * 3000;
}
export function startEndlessRun(character: Record<string, unknown>, token: string, day: string, now = Date.now()) {
    const existing = character.endlessTowerRun && typeof character.endlessTowerRun === 'object' ? character.endlessTowerRun as Partial<EndlessRun> : null;
    if (existing?.runToken && existing.wave && existing.wave > 0) return { ok: true as const, character, run: existing as EndlessRun, resumed: true, cost: 0 };
    const cost = endlessEntryCost(character, day); if (whole(character.ryo) < cost) return { ok: false as const, reason: 'insufficient-entry-ryo' as const };
    const used = character.dailyEndlessDate === day ? whole(character.dailyEndlessRuns) : 0;
    const run: EndlessRun = { runToken: token, wave: 1, bankedRyo: 0, bankedXp: 0, startedAt: now, highestMilestoneClaimed: 0 };
    return { ok: true as const, run, resumed: false, cost, character: { ...character, ryo: whole(character.ryo) - cost, dailyEndlessRuns: used + 1, dailyEndlessDate: day, endlessTowerRun: run } };
}
export function recordEndlessWin(character: Record<string, unknown>, run: EndlessRun, waveRaw: unknown, vitals: { hp?: unknown; chakra?: unknown; stamina?: unknown }) {
    const wave = whole(waveRaw); if (wave !== run.wave || wave < 1 || wave > 200) return null;
    const reward = endlessWaveReward(wave, character.level); const previousMilestone = whole(run.highestMilestoneClaimed);
    // highestMilestoneClaimed advances even on a milestone that pays 0, so no wave pays twice in one run.
    const milestoneNew = wave % 5 === 0 && wave > previousMilestone; const table = milestoneNew ? endlessMilestoneReward(wave) : { boneCharms: 0, fateShards: 0 };
    // Fate Shards pay once per account per wave: the best wave is read before this win stamps it.
    const lifetimeFirst = wave > whole(character.endlessTowerBestWave);
    // Only startEndlessRun writes dailyEndlessRuns, and a live run blocks a new start, so the counter
    // belongs to this run's start day: 1 is that day's free run, 0 a run older than the counter.
    const firstRunOfDay = whole(character.dailyEndlessRuns) <= 1;
    const milestone = {
        boneCharms: endlessBcFirstRunOfDay() && !firstRunOfDay ? 0 : table.boneCharms,
        fateShards: endlessFsLifetimeFirst() && !lifetimeFirst ? 0 : table.fateShards,
    };
    const heal = wave % 10 === 0;
    const baseHp = Math.min(whole(character.hp), vitals.hp == null ? whole(character.hp) : whole(vitals.hp));
    const baseChakra = Math.min(whole(character.chakra), vitals.chakra == null ? whole(character.chakra) : whole(vitals.chakra));
    const baseStamina = Math.min(whole(character.stamina), vitals.stamina == null ? whole(character.stamina) : whole(vitals.stamina));
    const nextRun: EndlessRun = { ...run, wave: wave + 1, bankedRyo: whole(run.bankedRyo) + reward.ryo, bankedXp: whole(run.bankedXp) + reward.xp, highestMilestoneClaimed: milestoneNew ? wave : previousMilestone };
    return { reward, milestone, lifetimeFirst, character: { ...character, endlessTowerRun: nextRun, totalEndlessTowerWins: whole(character.totalEndlessTowerWins) + 1, endlessTowerBestWave: Math.max(whole(character.endlessTowerBestWave), wave), boneCharms: whole(character.boneCharms) + milestone.boneCharms, fateShards: whole(character.fateShards) + milestone.fateShards, hp: Math.min(whole(character.maxHp), baseHp + (heal ? Math.floor(whole(character.maxHp) * 0.33) : 0)), chakra: Math.min(whole(character.maxChakra), baseChakra + (heal ? Math.floor(whole(character.maxChakra) * 0.5) : 0)), stamina: Math.min(whole(character.maxStamina), baseStamina + (heal ? Math.floor(whole(character.maxStamina) * 0.5) : 0)) } };
}
export function cashOutEndless(character: Record<string, unknown>, run: EndlessRun, _day: string) {
    // Character XP is retired: banked XP no longer exists (waves bank ryo only),
    // so the whole daily-XP-softcap subsystem is gone. Old in-flight runs may
    // still carry bankedXp — convert it at the same ~0.75:1 fold as the wave
    // rewards so nobody's active run is voided by the deploy.
    const legacyXpAsRyo = Math.floor(whole(run.bankedXp) * 0.75);
    const leveled = applyDerivedLevel(character) as Record<string, unknown>;
    const creditedRyo = whole(run.bankedRyo) + legacyXpAsRyo;
    // run.wave is the NEXT, unfought wave, so the best is the one before it (the
    // same wave recordEndlessWin stamps). Stamping run.wave handed out the
    // endless-wave achievements and blocked a lifetime-first Fate Shard milestone
    // one wave early. Never lowers a stored best.
    const wonWave = Math.max(0, whole(run.wave) - 1);
    return { character: { ...leveled, ryo: whole(leveled.ryo) + creditedRyo, endlessTowerBestWave: Math.max(whole(leveled.endlessTowerBestWave), wonWave), endlessTowerRun: null }, creditedXp: 0, creditedRyo };
}
