"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISALLOWED_CLAN_POINT_SOURCES = exports.CLAN_POINT_SOURCES = exports.MAX_CLAN_POINTS_AWARD = exports.CLAN_POINT_HISTORY_LIMIT = exports.CLAN_POINTS_WEEKLY_CAP = void 0;
exports.clanPointWeekKey = clanPointWeekKey;
exports.clanPointMonthKey = clanPointMonthKey;
exports.isAllowedClanPointSource = isAllowedClanPointSource;
exports.awardClanPoints = awardClanPoints;
exports.awardClanPointsToPlayerSave = awardClanPointsToPlayerSave;
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const _utils_js_1 = require("./_utils.js");
const _save_version_js_1 = require("./save/_save-version.js");
exports.CLAN_POINTS_WEEKLY_CAP = 1_000;
exports.CLAN_POINT_HISTORY_LIMIT = 30;
exports.MAX_CLAN_POINTS_AWARD = 250;
exports.CLAN_POINT_SOURCES = [
    'clanMissionContribution',
    'clanMissionClaim',
    'clanBossParticipation',
    'clanBossDefeat',
    'clanWarParticipation',
    'clanWarWin',
    'territoryCapture',
    'territoryDefense',
    'guardDuty',
    'mentorMilestone',
    'clanRaid',
];
exports.DISALLOWED_CLAN_POINT_SOURCES = [
    'missionComplete',
    'trainingComplete',
    'jutsuTrainingComplete',
    'pveWin',
    'storyBoss',
    'donation',
    'login',
    'shopPurchase',
    'bankAction',
];
const SOURCE_SET = new Set(exports.CLAN_POINT_SOURCES);
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function floorNonNegative(v) {
    return Math.max(0, Math.floor(num(v)));
}
function isoWeekParts(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
}
function clanPointWeekKey(date = new Date()) {
    const { year, week } = isoWeekParts(date);
    return `${year}-W${String(week).padStart(2, '0')}`;
}
function clanPointMonthKey(date = new Date()) {
    return date.toISOString().slice(0, 7);
}
function isAllowedClanPointSource(source) {
    return typeof source === 'string' && SOURCE_SET.has(source);
}
function awardClanPoints(character, source, amount, metadata = {}, now = new Date()) {
    const weekKey = clanPointWeekKey(now);
    const requested = Math.min(exports.MAX_CLAN_POINTS_AWARD, Math.max(0, Math.floor(Number(amount) || 0)));
    if (!character.clan) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: floorNonNegative(character.weeklyClanPoints), weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP, reason: 'not-in-clan' };
    }
    if (!isAllowedClanPointSource(source)) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: floorNonNegative(character.weeklyClanPoints), weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP, reason: 'invalid-source' };
    }
    if (requested <= 0) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: floorNonNegative(character.weeklyClanPoints), weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP, reason: 'invalid-amount' };
    }
    const prevWeek = String(character.weeklyClanPointsWeek ?? '');
    const currentWeekly = prevWeek === weekKey ? floorNonNegative(character.weeklyClanPoints) : 0;
    const existingHistory = Array.isArray(character.clanPointHistory)
        ? character.clanPointHistory.filter((entry) => !!entry && typeof entry === 'object')
        : [];
    const ts = now.getTime();
    const eventId = typeof metadata.eventId === 'string' && metadata.eventId.trim()
        ? metadata.eventId.trim()
        : `${source}:${ts}`;
    if (existingHistory.some((entry) => entry.id === eventId)) {
        return { character, awarded: 0, requested, weekKey, weeklyEarned: currentWeekly, weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP, reason: 'duplicate-event' };
    }
    if (currentWeekly >= exports.CLAN_POINTS_WEEKLY_CAP || currentWeekly + requested > exports.CLAN_POINTS_WEEKLY_CAP) {
        return {
            character: { ...character, weeklyClanPointsWeek: weekKey, weeklyClanPoints: currentWeekly },
            awarded: 0,
            requested,
            weekKey,
            weeklyEarned: currentWeekly,
            weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP,
            reason: 'weekly-cap',
        };
    }
    const historyEntry = {
        id: eventId,
        ts,
        source,
        amount: requested,
        weekKey,
        metadata: Object.keys(metadata).length ? metadata : undefined,
    };
    const next = {
        ...character,
        clanPoints: floorNonNegative(character.clanPoints) + requested,
        weeklyClanPoints: currentWeekly + requested,
        weeklyClanPointsWeek: weekKey,
        lifetimeClanPoints: floorNonNegative(character.lifetimeClanPoints) + requested,
        clanPointHistory: [historyEntry, ...existingHistory].slice(0, exports.CLAN_POINT_HISTORY_LIMIT),
    };
    return { character: next, awarded: requested, requested, weekKey, weeklyEarned: currentWeekly + requested, weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP };
}
async function awardClanPointsToPlayerSave(playerNameRaw, source, amount, metadata = {}) {
    const playerName = (0, _utils_js_1.safeName)(playerNameRaw);
    if (!playerName) {
        const weekKey = clanPointWeekKey();
        return { playerName, found: false, character: {}, awarded: 0, requested: 0, weekKey, weeklyEarned: 0, weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP, reason: 'invalid-amount' };
    }
    return await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
        const record = await _storage_js_1.kv.get(`save:${playerName}`);
        const character = (record?.character ?? null);
        if (!record || !character) {
            const weekKey = clanPointWeekKey();
            return { playerName, found: false, character: {}, awarded: 0, requested: 0, weekKey, weeklyEarned: 0, weeklyCap: exports.CLAN_POINTS_WEEKLY_CAP };
        }
        const result = awardClanPoints(character, source, amount, metadata);
        const changed = result.character !== character;
        if (changed) {
            await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...record, character: result.character }), record));
        }
        if (result.awarded > 0) {
            await _storage_js_1.kv.set(`audit:clan-points:${playerName}:${Date.now()}`, {
                ts: Date.now(),
                playerName,
                source,
                amount: result.awarded,
                weekKey: result.weekKey,
                metadata,
            }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return { ...result, playerName, found: true };
    }, { failClosed: true });
}
