"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_SECTOR_EXPLORE_LIMIT = void 0;
exports.sectorExploreReward = sectorExploreReward;
exports.applySectorExploreReward = applySectorExploreReward;
const _xp_engine_js_1 = require("../_xp-engine.js");
exports.DAILY_SECTOR_EXPLORE_LIMIT = 150;
function sectorExploreReward(sectorRaw) {
    const sector = Math.floor(Number(sectorRaw));
    if (!Number.isFinite(sector) || sector < 1 || sector > 60)
        return null;
    return { sector, xp: 20 + Math.floor(sector / 5), ryo: 10 + Math.floor(sector / 4) };
}
function applySectorExploreReward(character, sectorRaw, today) {
    const reward = sectorExploreReward(sectorRaw);
    if (!reward)
        return { ok: false, reason: 'invalid-sector' };
    const storedDate = typeof character.serverExploreDate === 'string' ? character.serverExploreDate : '';
    const count = storedDate === today ? Math.max(0, Math.floor(Number(character.serverExploresToday) || 0)) : 0;
    if (count >= exports.DAILY_SECTOR_EXPLORE_LIMIT)
        return { ok: false, reason: 'daily-limit' };
    const leveled = (0, _xp_engine_js_1.gainXp)(character, reward.xp);
    return {
        ok: true,
        reward,
        character: {
            ...leveled,
            ryo: Math.max(0, Number(leveled.ryo) || 0) + reward.ryo,
            totalTilesExplored: Math.max(0, Math.floor(Number(leveled.totalTilesExplored) || 0)) + 1,
            dailyTilesExplored: count + 1,
            serverExploreDate: today,
            serverExploresToday: count + 1,
        },
    };
}
