"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PODIUM_AURA_STONES = exports.CHAMPION_RELIC_ID = exports.SEASON_LENGTH_MS = exports.SEASON_ARCHIVE_PREFIX = exports.SEASON_CURRENT_KEY = void 0;
exports.softResetRating = softResetRating;
exports.leaderboard = leaderboard;
exports.rewardPodium = rewardPodium;
exports.nextSeason = nextSeason;
exports.computeRewards = computeRewards;
exports.startRankedSeason = startRankedSeason;
exports.runRankedSeasonRollover = runRankedSeasonRollover;
exports.forceRankedSeasonRollover = forceRankedSeasonRollover;
/*
 * Ranked seasons — monthly competitive cycle for the two ranked ladders
 * (player PvP rankedRating + pet petRankedRating).
 *
 * A "season" is just the live ladder rating wrapped in a clock. At the end of
 * each ~30-day window the rollover job:
 *   1. ranks every player on each ladder,
 *   2. rewards the top 3 of each ladder (champion gets a Warforged Relic + aura
 *      stones and a rankedSeasonsWon bump → the "Season Champion" achievement;
 *      2nd/3rd get aura stones),
 *   3. archives the final standings for the Hall of Legends "last season" view,
 *   4. SOFT-resets every played rating toward the 1000 default so the next
 *      season re-sorts fast without a full grind-from-scratch.
 *
 * Lifetime rankedWins / rankedLosses are NOT touched — only the ladder rating
 * resets, so lifetime stats + the clan-power board are unaffected.
 *
 * Pure helpers (rating math, podium selection, clock advance) are split out and
 * unit-tested; the runner does the kv read-modify-write under per-save locks.
 */
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _lock_js_1 = require("../_lock.js");
const _ranked_rating_js_1 = require("../_ranked-rating.js");
const SAVE_PREFIX = 'save:';
exports.SEASON_CURRENT_KEY = 'ranked:season:current';
exports.SEASON_ARCHIVE_PREFIX = 'ranked:season:archive:';
exports.SEASON_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;
const ARCHIVE_TTL_SECONDS = 400 * 24 * 60 * 60;
const SEASON_LOCK_KEY = 'ranked:season:rollover-lock';
const MAX_PARALLEL = 8;
// Reward table. Champion (#1) of each ladder gets the relic; the whole podium
// gets aura stones by placement. The Warforged Relic ("war material") is
// normally war-crate-only, so it's a meaningful prestige drop.
exports.CHAMPION_RELIC_ID = 'warforged-relic';
exports.PODIUM_AURA_STONES = [10, 6, 3];
/** Soft reset: pull a rating halfway back to the default, floored at 0. */
function softResetRating(rating, def = _ranked_rating_js_1.DEFAULT_RANKED_RATING) {
    const r = Number(rating);
    const base = Number.isFinite(r) ? r : def;
    return Math.max(0, Math.round(def + (base - def) * 0.5));
}
/** Sorted top-N standings (for the archive / display). Highest rating first. */
function leaderboard(entries, n) {
    return [...entries]
        .sort((a, b) => b.rating - a.rating)
        .slice(0, n)
        .map((e, i) => ({ ...e, rank: i + 1 }));
}
/**
 * Reward podium: the top 3 who actually CLIMBED this season (rating above the
 * default — you can't be #1 sitting at 1000). Returns at most 3, ranked.
 */
function rewardPodium(entries, def = _ranked_rating_js_1.DEFAULT_RANKED_RATING) {
    return [...entries]
        .filter((e) => e.rating > def)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 3)
        .map((e, i) => ({ ...e, rank: i + 1 }));
}
/** Advance the season clock. New window starts where the old one ended. */
function nextSeason(current, now) {
    const id = (current?.id ?? 0) + 1;
    const startedAt = current?.endsAt && current.endsAt <= now ? current.endsAt : now;
    return { id, startedAt, endsAt: startedAt + exports.SEASON_LENGTH_MS };
}
function computeRewards(playerPodium, petPodium) {
    const rewards = new Map();
    const add = (slug, aura, champion) => {
        const cur = rewards.get(slug) ?? { auraStones: 0, relics: 0, championOf: [] };
        cur.auraStones += aura;
        if (champion) {
            cur.relics += 1;
            cur.championOf.push(champion);
        }
        rewards.set(slug, cur);
    };
    for (const e of playerPodium)
        add(e.slug, exports.PODIUM_AURA_STONES[e.rank - 1] ?? 0, e.rank === 1 ? 'player' : null);
    for (const e of petPodium)
        add(e.slug, exports.PODIUM_AURA_STONES[e.rank - 1] ?? 0, e.rank === 1 ? 'pet' : null);
    return rewards;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
/**
 * Start ranked seasons (admin action). Initialises season 1 if no season exists
 * yet; a no-op if one is already active. Ranked seasons do NOT auto-start — an
 * admin kicks them off from the Admin Panel.
 */
async function startRankedSeason(now = Date.now()) {
    const current = await _storage_js_1.kv.get(exports.SEASON_CURRENT_KEY);
    if (current)
        return { ok: true, action: 'skipped', seasonId: current.id };
    const season = { id: 1, startedAt: now, endsAt: now + exports.SEASON_LENGTH_MS };
    await _storage_js_1.kv.set(exports.SEASON_CURRENT_KEY, season);
    return { ok: true, action: 'initialized', seasonId: season.id };
}
/**
 * Run a season rollover IF the current window has ended. Safe to call on every
 * daily cron tick — it no-ops (`inactive` until an admin starts seasons,
 * `pending` until the clock expires), and the rollover lock + clock advance make
 * a double-run a no-op too. Does NOT auto-start a season.
 */
async function runRankedSeasonRollover(now = Date.now()) {
    const current = await _storage_js_1.kv.get(exports.SEASON_CURRENT_KEY);
    if (!current)
        return { ok: true, action: 'inactive' };
    if (now < current.endsAt)
        return { ok: true, action: 'pending', seasonId: current.id };
    return (0, _lock_js_1.withKvLock)(SEASON_LOCK_KEY, async () => {
        const fresh = await _storage_js_1.kv.get(exports.SEASON_CURRENT_KEY);
        if (!fresh || now < fresh.endsAt)
            return { ok: true, action: 'skipped', seasonId: fresh?.id };
        return performRollover(fresh, now);
    }, { failClosed: true }).catch((err) => ({ ok: false, action: 'skipped', error: err instanceof Error ? err.message : String(err) }));
}
/**
 * Force a rollover NOW regardless of the clock (admin action) — ends the current
 * season immediately (reward + archive + soft reset) and starts the next.
 * `inactive` if seasons haven't been started.
 */
async function forceRankedSeasonRollover(now = Date.now()) {
    const current = await _storage_js_1.kv.get(exports.SEASON_CURRENT_KEY);
    if (!current)
        return { ok: true, action: 'inactive' };
    return (0, _lock_js_1.withKvLock)(SEASON_LOCK_KEY, async () => {
        const fresh = await _storage_js_1.kv.get(exports.SEASON_CURRENT_KEY);
        if (!fresh)
            return { ok: true, action: 'inactive' };
        return performRollover(fresh, now);
    }, { failClosed: true }).catch((err) => ({ ok: false, action: 'skipped', error: err instanceof Error ? err.message : String(err) }));
}
/** The actual rollover: archive standings, reward podiums, soft-reset, advance.
 *  Caller must hold SEASON_LOCK_KEY. */
async function performRollover(fresh, now) {
    {
        const saveKeys = await _storage_js_1.kv.keys(`${SAVE_PREFIX}*`);
        const playerKeys = saveKeys.filter((k) => {
            const name = k.slice(SAVE_PREFIX.length);
            return !name.startsWith('Admin ') && name !== 'Rill';
        });
        // Read every save once to build both ladders.
        const playerLadder = [];
        const petLadder = [];
        for (let i = 0; i < playerKeys.length; i += MAX_PARALLEL) {
            const slice = playerKeys.slice(i, i + MAX_PARALLEL);
            const recs = await Promise.all(slice.map((k) => _storage_js_1.kv.get(k).catch(() => null)));
            recs.forEach((rec, j) => {
                const char = (rec?.character ?? null);
                if (!char)
                    return;
                const slug = playerKeys[i + j].slice(SAVE_PREFIX.length);
                const name = char.name ?? slug;
                const village = char.village;
                playerLadder.push({ slug, name, village, rating: num(char.rankedRating ?? _ranked_rating_js_1.DEFAULT_RANKED_RATING) });
                petLadder.push({ slug, name, village, rating: num(char.petRankedRating ?? _ranked_rating_js_1.DEFAULT_RANKED_RATING) });
            });
            // Yield between batches so this all-saves scan doesn't monopolize the
            // shared event loop (it runs at the same 03:00 slot as the snapshot job).
            if (i + MAX_PARALLEL < playerKeys.length)
                await new Promise((resolve) => setImmediate(resolve));
        }
        const playerTop = leaderboard(playerLadder, 10);
        const petTop = leaderboard(petLadder, 10);
        const rewards = computeRewards(rewardPodium(playerLadder), rewardPodium(petLadder));
        // Archive the final standings for the "last season" UI.
        await _storage_js_1.kv.set(`${exports.SEASON_ARCHIVE_PREFIX}${fresh.id}`, {
            id: fresh.id,
            endedAt: now,
            player: playerTop.map((e) => ({ name: e.name, village: e.village, rating: e.rating, rank: e.rank })),
            pet: petTop.map((e) => ({ name: e.name, village: e.village, rating: e.rating, rank: e.rank })),
        }, { ex: ARCHIVE_TTL_SECONDS }).catch(() => undefined);
        // Apply soft reset (everyone who played) + rewards (podium) per save,
        // under that save's lock so we don't clobber a concurrent autosave.
        let resetCount = 0;
        let rewardedCount = 0;
        const apply = async (slug) => {
            const reward = rewards.get(slug);
            await (0, _lock_js_1.withKvLock)(`${SAVE_PREFIX}${slug}`, async () => {
                const rec = await _storage_js_1.kv.get(`${SAVE_PREFIX}${slug}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return;
                const oldP = num(char.rankedRating ?? _ranked_rating_js_1.DEFAULT_RANKED_RATING);
                const oldPet = num(char.petRankedRating ?? _ranked_rating_js_1.DEFAULT_RANKED_RATING);
                const newP = softResetRating(oldP);
                const newPet = softResetRating(oldPet);
                // Skip a write when nothing changes (untouched 1000/1000, no reward).
                if (newP === oldP && newPet === oldPet && !reward)
                    return;
                const next = { ...char, rankedRating: newP, petRankedRating: newPet };
                if (reward) {
                    if (reward.auraStones > 0)
                        next.auraStones = num(char.auraStones) + reward.auraStones;
                    if (reward.relics > 0) {
                        const inv = Array.isArray(char.inventory) ? char.inventory : [];
                        next.inventory = [...inv, ...Array(reward.relics).fill(exports.CHAMPION_RELIC_ID)];
                        next.rankedSeasonsWon = num(char.rankedSeasonsWon) + reward.championOf.length;
                    }
                }
                await _storage_js_1.kv.set(`${SAVE_PREFIX}${slug}`, (0, _utils_js_1.mergePreservingImages)({ ...rec, character: next }, rec));
                resetCount += 1;
                if (reward)
                    rewardedCount += 1;
            }, { failClosed: true }).catch(() => undefined);
        };
        for (let i = 0; i < playerKeys.length; i += MAX_PARALLEL) {
            const slice = playerKeys.slice(i, i + MAX_PARALLEL).map((k) => k.slice(SAVE_PREFIX.length));
            await Promise.all(slice.map(apply));
            // Yield between batches — see the read loop above. Keeps the locked
            // per-save rewrite pass from stalling concurrent player requests.
            if (i + MAX_PARALLEL < playerKeys.length)
                await new Promise((resolve) => setImmediate(resolve));
        }
        const next = nextSeason(fresh, now);
        await _storage_js_1.kv.set(exports.SEASON_CURRENT_KEY, next);
        await _storage_js_1.kv.set(`audit:ranked-season:${fresh.id}`, {
            ts: now, endedSeason: fresh.id, nextSeason: next.id,
            playerChampion: rewardPodium(playerLadder)[0]?.name, petChampion: rewardPodium(petLadder)[0]?.name,
            resetCount, rewardedCount,
        }, { ex: ARCHIVE_TTL_SECONDS }).catch(() => undefined);
        return {
            ok: true, action: 'rolled-over', seasonId: fresh.id, nextSeasonId: next.id,
            playerChampion: rewardPodium(playerLadder)[0]?.name, petChampion: rewardPodium(petLadder)[0]?.name,
            resetCount, rewardedCount,
        };
    }
}
