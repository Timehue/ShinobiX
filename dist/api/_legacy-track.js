"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOOTSTRAP_CAPS = exports.RING_DOMINANCE = exports.RING_MAX_DISTINCT = exports.RING_MIN_WINS = exports.RING_WINDOW = exports.SUSPICION_DECAY_DAYS = exports.LEVEL_GAP_ZERO = exports.LEGACY_SUSPECTS_KEY = exports.legacyEventsKey = exports.legacyStatsKey = void 0;
exports.legacyEnabled = legacyEnabled;
exports.repeatKillWeight = repeatKillWeight;
exports.isWinTradingRing = isWinTradingRing;
exports.seedLegacyStatsFromSave = seedLegacyStatsFromSave;
exports.getLegacyStats = getLegacyStats;
exports.bumpLegacyStats = bumpLegacyStats;
exports.reconcileLegacyStatsFromSave = reconcileLegacyStatsFromSave;
exports.appendLegacyEvent = appendLegacyEvent;
/*
 * Legacy activity tracker — the server-owned counter store behind the Legacy
 * system (see docs/legacy-system-plan.md §4).
 *
 * Player saves are client-writable via autosave, so save-embedded counters can
 * be tampered with. Legacy eligibility gates prestige, titles, and server
 * announcements, so its inputs live in a SIDE-CAR key `legacy:stats:<player>`
 * that only server settle endpoints ever write. Hooks call bumpLegacyStats()
 * AFTER their existing save write, best-effort: a lost increment is a shrug, a
 * blocked payout would be a bug, so tracking must never throw into the caller.
 *
 * The whole subsystem is gated on ENABLE_LEGACY=1 — flag off means every
 * exported hook is a no-op and live behavior is byte-identical.
 */
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
function legacyEnabled() {
    return process.env.ENABLE_LEGACY === '1';
}
const legacyStatsKey = (player) => `legacy:stats:${player}`;
exports.legacyStatsKey = legacyStatsKey;
const legacyEventsKey = (player) => `legacy:events:${player}`;
exports.legacyEventsKey = legacyEventsKey;
/** Admin suspects queue: players whose suspicionFlags moved recently. */
exports.LEGACY_SUSPECTS_KEY = 'legacy:suspects';
const EVENTS_CAP = 200;
// Large enough that realistic diverse play never evicts an active farm pair
// (eviction resets a pair's count to 0, which would restore full decay weight
// on its next kill — verification finding). At 300 a farmer would need 300
// distinct real victims to cycle one out, which the IP/FP + level-gap gates
// already catch as alts.
const REPEAT_KILLS_CAP = 300;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** Stats that record a best-ever value; bumping takes max() instead of sum. */
const MAX_STATS = new Set([
    'bestKillStreak', 'endlessTowerBest', 'biomesVisited',
]);
/**
 * Weight of the Nth kill against the same PvP target (anti-farm decay):
 * 1st and 2nd full, 3rd half, 4th quarter, then nothing.
 */
function repeatKillWeight(priorKillsOnTarget) {
    if (priorKillsOnTarget <= 2)
        return 1;
    if (priorKillsOnTarget === 3)
        return 0.5;
    if (priorKillsOnTarget === 4)
        return 0.25;
    return 0;
}
/** Kills >=15 levels down contribute nothing to Legacy PvP credit. */
exports.LEVEL_GAP_ZERO = 15;
/** One suspicion flag decays per this many days with no new flag. */
exports.SUSPICION_DECAY_DAYS = 10;
/**
 * Win-trading RING detection (research finding: per-pair decay stops
 * A-farms-B, but 3+ accounts rotating victims — A→B, B→C, C→A — keep every
 * pair under the decay knee). A healthy player's recent win targets are
 * diverse; a ring's are not. Pure and unit-tested.
 */
exports.RING_WINDOW = 12;
exports.RING_MIN_WINS = 8;
exports.RING_MAX_DISTINCT = 3;
/** A single target this fraction+ of the window = win-trading even if the rest
 *  is diverse — catches the "farm F, then rotate 3 throwaway victims to keep
 *  distinct-count at 4" evasion (verification finding). */
exports.RING_DOMINANCE = 0.5;
function isWinTradingRing(recentTargets) {
    const window = recentTargets.slice(0, exports.RING_WINDOW);
    if (window.length < exports.RING_MIN_WINS)
        return false;
    if (new Set(window).size <= exports.RING_MAX_DISTINCT)
        return true;
    // Single-target dominance: any opponent >= half the window.
    const counts = new Map();
    for (const t of window)
        counts.set(t, (counts.get(t) ?? 0) + 1);
    const max = Math.max(...counts.values());
    return max >= Math.ceil(window.length * exports.RING_DOMINANCE);
}
/**
 * Plausibility ceilings applied when seeding from pre-Legacy save counters
 * (which were client-writable). Each cap sits BELOW the lowest legendary
 * requirement floor that uses the stat, so bootstrapped history can qualify a
 * veteran for basic/rare identities but legendary/mythic tiers must be earned
 * under server tracking (verification finding: the old caps let a tampered
 * save fully cover two legendaries). Kept in sync with api/_legacy-defs.ts by
 * the cross-check in _legacy-score.test.ts.
 */
exports.BOOTSTRAP_CAPS = {
    missionCompletions: 350, pveKills: 1200, pvpWins: 140, pvpKills: 140,
    rankedWins: 50, raidsCompleted: 40, tilesExplored: 2500,
    arenaTournaments: 12, endlessTowerBest: 45, petDuelWins: 120,
    cardClashWins: 100, warsWon: 6, warMvps: 2, warContribution: 80_000,
    hollowGateClears: 25, huntCompletions: 120,
};
/** Seed a fresh stats record from the save's existing lifetime counters. */
function seedLegacyStatsFromSave(character, now) {
    const c = character ?? {};
    const seed = { updatedAt: now, bootstrappedAt: now };
    const put = (stat, raw) => {
        const cap = exports.BOOTSTRAP_CAPS[stat] ?? Number.MAX_SAFE_INTEGER;
        const v = Math.min(Math.max(0, Math.floor(num(raw))), cap);
        if (v > 0)
            seed[stat] = v;
    };
    put('missionCompletions', c['totalMissionsCompleted']);
    put('pveKills', c['totalAiKills']);
    put('pvpWins', c['totalPvpKills']);
    put('pvpKills', c['totalPvpKills']);
    put('rankedWins', c['rankedWins']);
    put('raidsCompleted', c['totalVillageRaids']);
    put('tilesExplored', c['totalTilesExplored']);
    put('arenaTournaments', c['totalTournamentsCompleted']);
    put('endlessTowerBest', c['endlessTowerBestWave'] ?? c['totalEndlessTowerWins']);
    put('petDuelWins', c['totalPetWins']);
    put('cardClashWins', c['cardClashWins']);
    put('warsWon', c['warsWon']);
    put('warMvps', c['warMvpCount']);
    put('warContribution', c['lifetimeWarDamage']);
    put('hollowGateClears', c['hollowGateWardenKills']);
    // Village tenure was never tracked; grant established characters a modest
    // floor so long-time villagers can reach the basic village identities.
    if (num(c['level']) >= 50 && typeof c['village'] === 'string' && c['village']) {
        seed.villageTenureDays = 10;
    }
    return seed;
}
/** Read the stats record, lazily bootstrapping it from the save on first touch.
 *  If the caller has no character handy, the save is fetched here — otherwise a
 *  hook that fires first (e.g. daily-login) would NX-claim an EMPTY seed and
 *  permanently discard the veteran's pre-Legacy history (verification finding). */
async function getLegacyStats(playerName, characterForBootstrap) {
    const key = (0, exports.legacyStatsKey)(playerName);
    const existing = await _storage_js_1.kv.get(key);
    if (existing && typeof existing === 'object')
        return existing;
    let char = characterForBootstrap ?? null;
    if (!char) {
        const rec = await _storage_js_1.kv.get(`save:${playerName}`);
        char = (rec?.character ?? null);
    }
    const seeded = seedLegacyStatsFromSave(char, Date.now());
    // NX so two concurrent first-touches can't double-seed.
    const claimed = await _storage_js_1.kv.set(key, seeded, { nx: true });
    if (claimed !== 'OK') {
        const raced = await _storage_js_1.kv.get(key);
        if (raced && typeof raced === 'object')
            return raced;
    }
    return seeded;
}
/**
 * Apply counter deltas (sum for totals, max for best-ever stats). Best-effort:
 * catches everything and never throws into the settle endpoint that called it.
 * The light lock (fail-open) only narrows the read-modify-write race window —
 * a rarely-lost increment is acceptable for progression counters.
 */
async function bumpLegacyStats(playerName, deltas, opts) {
    if (!legacyEnabled())
        return;
    if (!playerName)
        return;
    try {
        await (0, _lock_js_1.withKvLock)((0, exports.legacyStatsKey)(playerName), async () => {
            const stats = await getLegacyStats(playerName, opts?.characterForBootstrap ?? null);
            const next = { ...stats, updatedAt: Date.now() };
            let pvpWeight = 1;
            if (opts?.pvpLevelGap !== undefined && opts.pvpLevelGap >= exports.LEVEL_GAP_ZERO)
                pvpWeight = 0;
            if (opts?.pvpTarget) {
                const map = { ...(stats.repeatKills ?? {}) };
                const prior = num(map[opts.pvpTarget]) + 1;
                map[opts.pvpTarget] = prior;
                // Bound the map: keep the highest counts (they carry the decay info).
                const entries = Object.entries(map);
                if (entries.length > REPEAT_KILLS_CAP) {
                    entries.sort((a, b) => num(b[1]) - num(a[1]));
                    next.repeatKills = Object.fromEntries(entries.slice(0, REPEAT_KILLS_CAP));
                }
                else {
                    next.repeatKills = map;
                }
                pvpWeight = Math.min(pvpWeight, repeatKillWeight(prior));
            }
            // Decay applies to EVERY stat in a pvp-attributed call — style kills,
            // same-rank wins, comeback wins, support totals — not just pvpKills.
            // (Verification finding: farming one consenting target previously
            // earned full credit everywhere except the two headline counters.)
            const decayed = opts?.pvpTarget !== undefined || opts?.pvpLevelGap !== undefined;
            for (const [rawStat, rawDelta] of Object.entries(deltas)) {
                const stat = rawStat;
                let delta = num(rawDelta);
                if (delta <= 0)
                    continue;
                if (decayed)
                    delta *= pvpWeight;
                if (delta <= 0)
                    continue;
                const prev = num(next[stat]);
                next[stat] = MAX_STATS.has(stat) ? Math.max(prev, delta) : prev + delta;
            }
            let suspicionRaised = Boolean(opts?.suspicion);
            // Ring detection: track credited win targets and flag rotations
            // (at most one flag per 24h so a ring doesn't nuke the counter
            // in a single session — admins see it on the suspects queue).
            if (opts?.pvpTarget && pvpWeight > 0) {
                next.recentWinTargets = [opts.pvpTarget, ...(stats.recentWinTargets ?? [])].slice(0, exports.RING_WINDOW);
                const lastFlag = num(stats.ringFlagAt);
                if (isWinTradingRing(next.recentWinTargets) && Date.now() - lastFlag > 24 * 60 * 60 * 1000) {
                    next.ringFlagAt = Date.now();
                    suspicionRaised = true;
                }
            }
            if (suspicionRaised) {
                next.suspicionFlags = num(next.suspicionFlags) + 1;
                next.lastSuspicionAt = Date.now();
            }
            if (opts?.streak === 'win') {
                // A fully-decayed farm win doesn't extend the streak either.
                if (!decayed || pvpWeight > 0) {
                    next.winStreak = num(stats.winStreak) + 1;
                    next.bestKillStreak = Math.max(num(next.bestKillStreak), next.winStreak);
                }
            }
            else if (opts?.streak === 'reset') {
                next.winStreak = 0;
            }
            await _storage_js_1.kv.set((0, exports.legacyStatsKey)(playerName), next);
            // Surface flagged players on the admin suspects queue (dedup,
            // newest-first, capped). Own lock on the GLOBAL list — two
            // different players flagged concurrently must not clobber each
            // other (verification finding). Best-effort; runs after the
            // per-player stats write above.
            if (suspicionRaised) {
                const flagsNow = num(next.suspicionFlags);
                try {
                    await (0, _lock_js_1.withKvLock)(exports.LEGACY_SUSPECTS_KEY, async () => {
                        const suspects = (await _storage_js_1.kv.get(exports.LEGACY_SUSPECTS_KEY)) ?? [];
                        const rest = (Array.isArray(suspects) ? suspects : []).filter((s) => s.player !== playerName);
                        await _storage_js_1.kv.set(exports.LEGACY_SUSPECTS_KEY, [
                            { player: playerName, ts: Date.now(), flags: flagsNow },
                            ...rest,
                        ].slice(0, 50));
                    }, { ttlSec: 5 });
                }
                catch { /* best-effort */ }
            }
        }, { ttlSec: 5 });
    }
    catch (err) {
        console.error(`[legacy-track] bump failed for ${playerName}:`, err instanceof Error ? err.message : err);
    }
}
/**
 * Daily reconcile: floor-raise the handful of stats whose only source is
 * client-tracked gameplay (sector exploring, pet duels, tower waves, arena
 * tournaments) from the save's lifetime counters, bounded by BOOTSTRAP_CAPS.
 * Client-trusted but capped below every legendary floor, exactly like the
 * bootstrap — it keeps basic/rare exploration-and-pets identities reachable
 * for ONGOING play without giving tampered saves a path to high tiers.
 * Called once per UTC day from the daily-login hook. Best-effort.
 */
async function reconcileLegacyStatsFromSave(playerName, character) {
    if (!legacyEnabled() || !playerName || !character)
        return;
    try {
        const MIRRORS = [
            ['tilesExplored', 'totalTilesExplored'],
            ['petDuelWins', 'totalPetWins'],
            ['endlessTowerBest', 'endlessTowerBestWave'],
            ['arenaTournaments', 'totalTournamentsCompleted'],
        ];
        await (0, _lock_js_1.withKvLock)((0, exports.legacyStatsKey)(playerName), async () => {
            const stats = await getLegacyStats(playerName, character);
            const next = { ...stats };
            let changed = false;
            for (const [stat, field] of MIRRORS) {
                const cap = exports.BOOTSTRAP_CAPS[stat] ?? Number.MAX_SAFE_INTEGER;
                const fromSave = Math.min(Math.max(0, Math.floor(num(character[field]))), cap);
                if (fromSave > num(next[stat])) {
                    next[stat] = fromSave;
                    changed = true;
                }
            }
            // Slow suspicion decay: honest CGNAT / shared-device collisions and
            // occasional false ring flags shouldn't lock a player out of
            // legendary tiers forever. One flag decays per SUSPICION_DECAY_DAYS
            // with no new flag (verification finding: flags never decayed).
            const flags = num(next.suspicionFlags);
            if (flags > 0 && Date.now() - num(next.lastSuspicionAt) > exports.SUSPICION_DECAY_DAYS * 24 * 60 * 60 * 1000) {
                next.suspicionFlags = flags - 1;
                next.lastSuspicionAt = Date.now();
                changed = true;
            }
            if (changed) {
                next.updatedAt = Date.now();
                await _storage_js_1.kv.set((0, exports.legacyStatsKey)(playerName), next);
            }
        }, { ttlSec: 5 });
    }
    catch (err) {
        console.error(`[legacy-track] reconcile failed for ${playerName}:`, err instanceof Error ? err.message : err);
    }
}
/** Append an important-moment event (capped ring, newest first). Best-effort. */
async function appendLegacyEvent(playerName, ev) {
    if (!legacyEnabled())
        return;
    try {
        const key = (0, exports.legacyEventsKey)(playerName);
        const list = (await _storage_js_1.kv.get(key)) ?? [];
        const next = [{ ts: Date.now(), ...ev }, ...(Array.isArray(list) ? list : [])].slice(0, EVENTS_CAP);
        await _storage_js_1.kv.set(key, next);
    }
    catch (err) {
        console.error(`[legacy-track] event append failed for ${playerName}:`, err instanceof Error ? err.message : err);
    }
}
