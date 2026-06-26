"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEALER_WORLDWIDE_RANK = exports.HEALER_HEAL_XP_BONUS_PCT = exports.HEALER_PER_TARGET_COOLDOWN_SEC = void 0;
exports.professionRankForXp = professionRankForXp;
exports.healerHealXpBonusPct = healerHealXpBonusPct;
exports.healerPerTargetCooldownMs = healerPerTargetCooldownMs;
exports.utcDateKey = utcDateKey;
exports.awardProfessionXp = awardProfessionXp;
exports.loadOrIssueDailyMissions = loadOrIssueDailyMissions;
exports.reportMissionEvent = reportMissionEvent;
exports.loadOrIssueNewbieDailies = loadOrIssueNewbieDailies;
exports.reportNewbieEvent = reportNewbieEvent;
const _storage_js_1 = require("../_storage.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _pool_js_1 = require("./_pool.js");
// Healer uses a 1.5× XP curve; baseline used by Vanguard. Keep in sync with
// the client-side getProfessionRankForXp in shinobij.client/src/App.tsx.
const XP_BASELINE = [0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850, Infinity];
const XP_HEALER = XP_BASELINE.map(v => v === Infinity ? v : Math.floor(v * 1.5));
const MAX_RANK = 10;
function thresholdsFor(profession) {
    return profession === 'healer' ? XP_HEALER : XP_BASELINE;
}
function rankFor(profession, xp) {
    const t = thresholdsFor(profession);
    let rank = 1;
    for (let i = 1; i <= MAX_RANK; i += 1) {
        if (xp >= t[i])
            rank = Math.min(MAX_RANK, i + 1);
    }
    return Math.min(MAX_RANK, rank);
}
// Exported so security-sensitive endpoints (injured-villagers, heal,
// anywhere a rank gates a privileged action) can derive the trustworthy
// rank from professionXp instead of trusting a potentially-tampered
// professionRank field on the character record.
function professionRankForXp(profession, xp) {
    return rankFor(profession, xp);
}
// ── Healer rank perks — server-side mirror of shinobij.client/src/professionLogic.ts ──
// Keep arrays IN SYNC with the client file. Idx = rank (0 unused).
exports.HEALER_PER_TARGET_COOLDOWN_SEC = [0, 300, 285, 270, 240, 210, 180, 150, 120, 105, 90];
exports.HEALER_HEAL_XP_BONUS_PCT = [0, 0, 5, 10, 15, 20, 25, 30, 35, 40, 50];
// (A former rank-scaled HEALER_HOSPITAL_TIMER_SEC was removed — Healers now
//  discharge instantly for free, so there is no Healer hospital timer to mirror.)
exports.HEALER_WORLDWIDE_RANK = 10;
function clampRank(rank) {
    if (!Number.isFinite(rank) || rank < 1)
        return 1;
    if (rank > MAX_RANK)
        return MAX_RANK;
    return Math.floor(rank);
}
function healerHealXpBonusPct(rank) {
    return exports.HEALER_HEAL_XP_BONUS_PCT[clampRank(rank)];
}
function healerPerTargetCooldownMs(rank) {
    return exports.HEALER_PER_TARGET_COOLDOWN_SEC[clampRank(rank)] * 1000;
}
function utcDateKey(now = new Date()) {
    return now.toISOString().slice(0, 10);
}
// Vanguard Rank 2+ perk: +10% XP on all Vanguard XP gains. Mirrored from the
// client-side professionXpMultiplier in App.tsx so both grant paths agree.
function xpMultiplierFor(profession, currentRank) {
    if (profession === 'vanguard' && currentRank >= 2)
        return 1.1;
    return 1;
}
// Award profession XP directly to the player's character record. Returns
// {xp, rank} after the credit. Used by both per-action XP grants and
// mission-completion rewards.
async function awardProfessionXp(playerName, profession, amount) {
    if (amount <= 0)
        return null;
    const saveKey = `save:${playerName}`;
    // Wrap the read-modify-write under the same lock the save endpoint uses
    // so a concurrent auto-save can't clobber the XP credit, and so two
    // concurrent reportMissionEvent calls (e.g. a Vanguard PvP win + raid
    // report landing in the same tick) don't both read the pre-grant XP
    // and one lose its credit.
    return await (0, _lock_js_1.withKvLock)(saveKey, async () => {
        const record = await _storage_js_1.kv.get(saveKey);
        const char = record?.character;
        if (!char || char.profession !== profession)
            return null;
        const currentRank = Number(char.professionRank ?? 1);
        const boosted = Math.floor(amount * xpMultiplierFor(profession, currentRank));
        const nextXp = Number(char.professionXp ?? 0) + boosted;
        const nextRank = rankFor(profession, nextXp);
        const updated = {
            ...record,
            character: {
                ...char,
                professionXp: nextXp,
                professionRank: nextRank,
            },
        };
        (0, _save_version_js_1.bumpSaveVersion)(updated);
        await _storage_js_1.kv.set(saveKey, updated);
        return { xp: nextXp, rank: nextRank };
    });
}
function dailyKey(playerName) {
    return `missions:daily:${playerName}`;
}
function fromTemplate(t, dateKey) {
    return {
        id: `${t.templateId}:${dateKey}`,
        templateId: t.templateId,
        kind: t.kind,
        name: t.name,
        description: t.description,
        target: t.target,
        progress: 0,
        uniqueTargets: (t.kind === 'healer-heal-unique' || t.kind === 'vanguard-pvp-unique') ? [] : undefined,
        xpReward: t.xpReward,
        completedAt: null,
        claimed: false,
    };
}
// Load (or issue) today's missions for a player. Returns null if profession
// doesn't have missions. Vanguard Rank 6+ gets 4 missions instead of 3
// (the Rank 6 even-rank perk).
async function loadOrIssueDailyMissions(playerName, profession, now = new Date()) {
    const today = utcDateKey(now);
    const existing = await _storage_js_1.kv.get(dailyKey(playerName));
    if (existing && existing.date === today && existing.profession === profession) {
        return existing;
    }
    // Look up current rank to determine daily mission slot count.
    const record = await _storage_js_1.kv.get(`save:${playerName}`);
    const char = record?.character;
    const currentRank = Number(char?.professionRank ?? 1);
    const slotCount = (profession === 'vanguard' && currentRank >= 6) ? 4 : 3;
    const picks = (0, _pool_js_1.pickDailyMissions)(profession, playerName, today, slotCount);
    if (picks.length === 0)
        return null;
    const state = {
        date: today,
        profession,
        missions: picks.map(t => fromTemplate(t, today)),
    };
    await _storage_js_1.kv.set(dailyKey(playerName), state, { ex: 36 * 60 * 60 });
    return state;
}
// Increment progress on all of a player's missions matching the given kind.
// For unique-target missions, the target name dedupes within the day.
// Returns the total profession XP awarded (auto-grant on completion).
async function reportMissionEvent(opts) {
    const { playerName, profession, kind, targetName } = opts;
    const now = opts.now ?? new Date();
    // Lock the daily-missions key for the entire read-modify-write so two
    // concurrent reports for the same player can't both read progress=N,
    // both increment to N+1, and the second write clobber the first.
    const dKey = dailyKey(playerName);
    const result = await (0, _lock_js_1.withKvLock)(dKey, async () => {
        const state = await loadOrIssueDailyMissions(playerName, profession, now);
        if (!state)
            return { xpAwarded: 0, missionsCompleted: [] };
        let xpAwarded = 0;
        const completed = [];
        let changed = false;
        const next = state.missions.map(m => {
            if (m.kind !== kind || m.completedAt)
                return m;
            // Unique-target dedup.
            let nextProgress = m.progress;
            let nextUnique = m.uniqueTargets;
            if (m.uniqueTargets) {
                if (!targetName)
                    return m;
                if (m.uniqueTargets.includes(targetName))
                    return m;
                nextUnique = [...m.uniqueTargets, targetName];
                nextProgress = nextUnique.length;
            }
            else {
                nextProgress = m.progress + 1;
            }
            changed = true;
            const justCompleted = nextProgress >= m.target;
            if (justCompleted) {
                xpAwarded += m.xpReward;
                completed.push({ id: m.id, name: m.name, xpReward: m.xpReward });
                return { ...m, progress: m.target, uniqueTargets: nextUnique, completedAt: Date.now() };
            }
            return { ...m, progress: nextProgress, uniqueTargets: nextUnique };
        });
        if (changed) {
            await _storage_js_1.kv.set(dKey, { ...state, missions: next }, { ex: 36 * 60 * 60 });
        }
        return { xpAwarded, missionsCompleted: completed };
    });
    // Auto-grant mission XP onto the player's character. awardProfessionXp
    // takes its own lock on save:<player> so we don't nest locks here.
    if (result.xpAwarded > 0) {
        await awardProfessionXp(playerName, profession, result.xpAwarded);
    }
    return result;
}
function newbieDailyKey(playerName) {
    return `missions:newbie-daily:${playerName}`;
}
function fromNewbieTemplate(t, dateKey) {
    return {
        id: `${t.templateId}:${dateKey}`,
        templateId: t.templateId,
        kind: t.kind,
        name: t.name,
        description: t.description,
        target: t.target,
        progress: 0,
        ryoReward: t.ryoReward,
        completedAt: null,
    };
}
// Load (or issue) today's new-shinobi dailies. Callers should only invoke this
// for players WITHOUT a profession.
async function loadOrIssueNewbieDailies(playerName, now = new Date()) {
    const today = utcDateKey(now);
    const existing = await _storage_js_1.kv.get(newbieDailyKey(playerName));
    if (existing && existing.date === today)
        return existing;
    const picks = (0, _pool_js_1.pickNewbieMissions)(playerName, today);
    const state = {
        date: today,
        missions: picks.map(t => fromNewbieTemplate(t, today)),
    };
    await _storage_js_1.kv.set(newbieDailyKey(playerName), state, { ex: 36 * 60 * 60 });
    return state;
}
// Grant ryo to the player's character, under the same save lock the save
// endpoint uses (mirrors awardProfessionXp). Re-checks "no profession" inside
// the lock so a player who chose a profession between the report and the grant
// is never paid the newbie reward.
async function awardNewbieRyo(playerName, amount) {
    if (amount <= 0)
        return;
    const saveKey = `save:${playerName}`;
    await (0, _lock_js_1.withKvLock)(saveKey, async () => {
        const record = await _storage_js_1.kv.get(saveKey);
        const char = record?.character;
        if (!char || char.profession)
            return;
        const updated = {
            ...record,
            character: { ...char, ryo: Number(char.ryo ?? 0) + amount },
        };
        (0, _save_version_js_1.bumpSaveVersion)(updated);
        await _storage_js_1.kv.set(saveKey, updated);
    });
}
// Progress the new-shinobi dailies for a matching event kind. No-op for players
// who have a profession. Auto-grants ryo on completion (same model as the
// profession dailies' auto-grant). Locks the newbie-daily key for the
// read-modify-write so concurrent reports can't lose an increment.
async function reportNewbieEvent(opts) {
    const { playerName, kind } = opts;
    const now = opts.now ?? new Date();
    // Cheap gate before taking the lock: only pre-profession players have a
    // newbie set. (Re-checked inside awardNewbieRyo under the save lock.)
    const save = await _storage_js_1.kv.get(`save:${playerName}`);
    const char = save?.character;
    if (!char || char.profession)
        return { ryoAwarded: 0, completed: [] };
    const dKey = newbieDailyKey(playerName);
    const result = await (0, _lock_js_1.withKvLock)(dKey, async () => {
        const state = await loadOrIssueNewbieDailies(playerName, now);
        let ryoAwarded = 0;
        const completed = [];
        let changed = false;
        const next = state.missions.map(m => {
            if (m.kind !== kind || m.completedAt)
                return m;
            const nextProgress = m.progress + 1;
            changed = true;
            if (nextProgress >= m.target) {
                ryoAwarded += m.ryoReward;
                completed.push({ id: m.id, name: m.name, ryoReward: m.ryoReward });
                return { ...m, progress: m.target, completedAt: Date.now() };
            }
            return { ...m, progress: nextProgress };
        });
        if (changed)
            await _storage_js_1.kv.set(dKey, { ...state, missions: next }, { ex: 36 * 60 * 60 });
        return { ryoAwarded, completed };
    });
    if (result.ryoAwarded > 0) {
        await awardNewbieRyo(playerName, result.ryoAwarded);
    }
    return result;
}
