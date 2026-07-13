"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.endlessScaleFactor = endlessScaleFactor;
exports.endlessWaveReward = endlessWaveReward;
exports.endlessMilestoneReward = endlessMilestoneReward;
exports.endlessEntryCost = endlessEntryCost;
exports.startEndlessRun = startEndlessRun;
exports.recordEndlessWin = recordEndlessWin;
exports.cashOutEndless = cashOutEndless;
const _xp_engine_js_1 = require("../_xp-engine.js");
const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));
function endlessScaleFactor(waveRaw) {
    const wave = Math.max(1, whole(waveRaw));
    return Math.max(1, 1 + (wave - 1) * 0.08 + Math.floor(wave / 5) * 0.10 + Math.floor(wave / 10) * 0.15);
}
function endlessWaveReward(waveRaw, levelRaw) {
    const wave = Math.max(1, whole(waveRaw));
    const level = Math.max(1, whole(levelRaw));
    const factor = endlessScaleFactor(wave);
    const multiplier = wave % 5 === 0 ? (wave % 10 === 0 ? 3 : 2) : 1;
    return { ryo: Math.floor((40 + level * 6) * factor * multiplier), xp: Math.floor((15 + level * 2) * factor * multiplier) };
}
function endlessMilestoneReward(waveRaw) {
    const wave = whole(waveRaw);
    if (wave <= 0 || wave % 5 !== 0)
        return { boneCharms: 0, fateShards: 0 };
    const pos = (Math.floor(wave / 5) - 1) % 4;
    return pos === 0 || pos === 1 ? { boneCharms: 5, fateShards: 0 }
        : pos === 2 ? { boneCharms: 0, fateShards: 5 } : { boneCharms: 5, fateShards: 5 };
}
function endlessEntryCost(character, day) {
    const used = character.dailyEndlessDate === day ? whole(character.dailyEndlessRuns) : 0;
    return used * 3000;
}
function startEndlessRun(character, token, day, now = Date.now()) {
    const existing = character.endlessTowerRun && typeof character.endlessTowerRun === 'object' ? character.endlessTowerRun : null;
    if (existing?.runToken && existing.wave && existing.wave > 0)
        return { ok: true, character, run: existing, resumed: true, cost: 0 };
    const cost = endlessEntryCost(character, day);
    if (whole(character.ryo) < cost)
        return { ok: false, reason: 'insufficient-entry-ryo' };
    const used = character.dailyEndlessDate === day ? whole(character.dailyEndlessRuns) : 0;
    const run = { runToken: token, wave: 1, bankedRyo: 0, bankedXp: 0, startedAt: now, highestMilestoneClaimed: 0 };
    return { ok: true, run, resumed: false, cost, character: { ...character, ryo: whole(character.ryo) - cost, dailyEndlessRuns: used + 1, dailyEndlessDate: day, endlessTowerRun: run } };
}
function recordEndlessWin(character, run, waveRaw, vitals) {
    const wave = whole(waveRaw);
    if (wave !== run.wave || wave < 1 || wave > 200)
        return null;
    const reward = endlessWaveReward(wave, character.level);
    const previousMilestone = whole(run.highestMilestoneClaimed);
    const milestoneNew = wave % 5 === 0 && wave > previousMilestone;
    const milestone = milestoneNew ? endlessMilestoneReward(wave) : { boneCharms: 0, fateShards: 0 };
    const heal = wave % 10 === 0;
    const baseHp = Math.min(whole(character.hp), vitals.hp == null ? whole(character.hp) : whole(vitals.hp));
    const baseChakra = Math.min(whole(character.chakra), vitals.chakra == null ? whole(character.chakra) : whole(vitals.chakra));
    const baseStamina = Math.min(whole(character.stamina), vitals.stamina == null ? whole(character.stamina) : whole(vitals.stamina));
    const nextRun = { ...run, wave: wave + 1, bankedRyo: whole(run.bankedRyo) + reward.ryo, bankedXp: whole(run.bankedXp) + reward.xp, highestMilestoneClaimed: milestoneNew ? wave : previousMilestone };
    return { reward, milestone, character: { ...character, endlessTowerRun: nextRun, totalEndlessTowerWins: whole(character.totalEndlessTowerWins) + 1, endlessTowerBestWave: Math.max(whole(character.endlessTowerBestWave), wave), boneCharms: whole(character.boneCharms) + milestone.boneCharms, fateShards: whole(character.fateShards) + milestone.fateShards, hp: Math.min(whole(character.maxHp), baseHp + (heal ? Math.floor(whole(character.maxHp) * 0.33) : 0)), chakra: Math.min(whole(character.maxChakra), baseChakra + (heal ? Math.floor(whole(character.maxChakra) * 0.5) : 0)), stamina: Math.min(whole(character.maxStamina), baseStamina + (heal ? Math.floor(whole(character.maxStamina) * 0.5) : 0)) } };
}
function cashOutEndless(character, run, day) {
    const todayRaw = character.lastDailyReset === day ? whole(character.dailyTowerXp) : 0;
    const raw = whole(run.bankedXp);
    const cap = 450 + Math.max(1, whole(character.level)) * 60;
    const under = Math.min(raw, Math.max(0, cap - todayRaw));
    const creditedXp = under + Math.floor((raw - under) * 0.2);
    const leveled = (0, _xp_engine_js_1.gainXp)(character, creditedXp);
    return { character: { ...leveled, ryo: whole(leveled.ryo) + whole(run.bankedRyo), dailyTowerXp: todayRaw + raw, lastDailyReset: day, endlessTowerBestWave: Math.max(whole(leveled.endlessTowerBestWave), whole(run.wave)), endlessTowerRun: null }, creditedXp, creditedRyo: whole(run.bankedRyo) };
}
