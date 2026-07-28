import { applyDerivedLevel } from '../_xp-engine.js';

export type EndlessRun = { runToken: string; wave: number; bankedRyo: number; bankedXp: number; startedAt: number; highestMilestoneClaimed?: number };
const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));
export function endlessScaleFactor(waveRaw: unknown): number {
    const wave = Math.max(1, whole(waveRaw));
    return Math.max(1, 1 + (wave - 1) * 0.08 + Math.floor(wave / 5) * 0.10 + Math.floor(wave / 10) * 0.15);
}
export function endlessWaveReward(waveRaw: unknown, levelRaw: unknown) {
    const wave = Math.max(1, whole(waveRaw)); const level = Math.max(1, whole(levelRaw)); const factor = endlessScaleFactor(wave);
    const multiplier = wave % 5 === 0 ? (wave % 10 === 0 ? 3 : 2) : 1;
    // Character XP is retired (leveling-without-xp map): the old xp line folds
    // into banked ryo at ~0.75:1, preserving the bank-or-lose tension without a
    // stat faucet on an infinite-repeat mode. `xp` stays as 0 for old clients.
    return { ryo: Math.floor((40 + level * 6) * factor * multiplier) + Math.floor((15 + level * 2) * factor * multiplier * 0.75), xp: 0 };
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
    const milestoneNew = wave % 5 === 0 && wave > previousMilestone; const milestone = milestoneNew ? endlessMilestoneReward(wave) : { boneCharms: 0, fateShards: 0 };
    const heal = wave % 10 === 0;
    const baseHp = Math.min(whole(character.hp), vitals.hp == null ? whole(character.hp) : whole(vitals.hp));
    const baseChakra = Math.min(whole(character.chakra), vitals.chakra == null ? whole(character.chakra) : whole(vitals.chakra));
    const baseStamina = Math.min(whole(character.stamina), vitals.stamina == null ? whole(character.stamina) : whole(vitals.stamina));
    const nextRun: EndlessRun = { ...run, wave: wave + 1, bankedRyo: whole(run.bankedRyo) + reward.ryo, bankedXp: whole(run.bankedXp) + reward.xp, highestMilestoneClaimed: milestoneNew ? wave : previousMilestone };
    return { reward, milestone, character: { ...character, endlessTowerRun: nextRun, totalEndlessTowerWins: whole(character.totalEndlessTowerWins) + 1, endlessTowerBestWave: Math.max(whole(character.endlessTowerBestWave), wave), boneCharms: whole(character.boneCharms) + milestone.boneCharms, fateShards: whole(character.fateShards) + milestone.fateShards, hp: Math.min(whole(character.maxHp), baseHp + (heal ? Math.floor(whole(character.maxHp) * 0.33) : 0)), chakra: Math.min(whole(character.maxChakra), baseChakra + (heal ? Math.floor(whole(character.maxChakra) * 0.5) : 0)), stamina: Math.min(whole(character.maxStamina), baseStamina + (heal ? Math.floor(whole(character.maxStamina) * 0.5) : 0)) } };
}
export function cashOutEndless(character: Record<string, unknown>, run: EndlessRun, _day: string) {
    // Character XP is retired: banked XP no longer exists (waves bank ryo only),
    // so the whole daily-XP-softcap subsystem is gone. Old in-flight runs may
    // still carry bankedXp — convert it at the same ~0.75:1 fold as the wave
    // rewards so nobody's active run is voided by the deploy.
    const legacyXpAsRyo = Math.floor(whole(run.bankedXp) * 0.75);
    const leveled = applyDerivedLevel(character) as Record<string, unknown>;
    const creditedRyo = whole(run.bankedRyo) + legacyXpAsRyo;
    return { character: { ...leveled, ryo: whole(leveled.ryo) + creditedRyo, endlessTowerBestWave: Math.max(whole(leveled.endlessTowerBestWave), whole(run.wave)), endlessTowerRun: null }, creditedXp: 0, creditedRyo };
}
