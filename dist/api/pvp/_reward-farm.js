"use strict";
// Repeat-opponent reward decay (PvP-combat audit fix #1).
//
// Throttles base-ryo/XP farming where one winner repeatedly beats the SAME
// loser in a short window — whether that's two cooperating alts or two friends
// trading wins. The server already owns the base reward (see _xp-engine.ts +
// claim-rewards.ts), so we scale that payout down by how many times this exact
// pair has already settled a win in the window. Honest play (beating someone
// once or twice an hour) is unaffected; sustained farming tapers to a floor.
//
// This is deliberately keyed on the (winner, loser) PAIR, not on device/IP, so
// it has no false positives for same-household players — it only ever fires on
// genuine repetition. The ladder-integrity guard (same-device → no ranked LP)
// is separate and lives in claim-rewards.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPEAT_WIN_WINDOW_SECONDS = void 0;
exports.repeatWinDecayMultiplier = repeatWinDecayMultiplier;
exports.recordPairWinAndDecay = recordPairWinAndDecay;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
// Sliding window over which prior wins against the same loser count toward the
// decay. One hour matches the reference implementation's anti-farm window.
exports.REPEAT_WIN_WINDOW_SECONDS = 60 * 60;
/**
 * Decay multiplier for a base PvP-win reward given how many wins the SAME
 * winner already banked against the SAME loser inside the window (NOT counting
 * the current win).
 *
 *   priorWins 0–1 → 1.0   (first two wins pay in full)
 *   priorWins 2   → 0.5
 *   priorWins 3   → 0.25
 *   priorWins ≥4  → 0.1   (floor — farming never pays zero, just a trickle)
 *
 * Pure + IO-free so it can be unit-tested without storage.
 */
function repeatWinDecayMultiplier(priorWins) {
    const n = Math.max(0, Math.floor(priorWins));
    if (n <= 1)
        return 1;
    if (n === 2)
        return 0.5;
    if (n === 3)
        return 0.25;
    return 0.1;
}
function pairKey(winnerSlug, loserSlug) {
    return `pvp:pairwins:${(0, _utils_js_1.safeName)(winnerSlug)}:${(0, _utils_js_1.safeName)(loserSlug)}`;
}
/**
 * Atomically record ONE credited win of `winner` over `loser` and return the
 * decay multiplier to apply to THIS win's base reward.
 *
 * MUST be called exactly once per actually-credited battle (i.e. only on the
 * first real settle, never on a replay/retry), because the atomic increment is
 * what advances the farm counter. The window key auto-expires after
 * REPEAT_WIN_WINDOW_SECONDS, so the counter resets for a pair that stops
 * fighting.
 *
 * `kv.incr` returns the post-increment count (including this win), so
 * priorWins = count − 1. Fails OPEN (multiplier 1.0) on any KV error — a
 * storage hiccup must never deny a legitimate winner their reward.
 */
async function recordPairWinAndDecay(winnerSlug, loserSlug) {
    try {
        const count = await _storage_js_1.kv.incr(pairKey(winnerSlug, loserSlug), { ex: exports.REPEAT_WIN_WINDOW_SECONDS });
        return repeatWinDecayMultiplier(count - 1);
    }
    catch {
        return 1;
    }
}
