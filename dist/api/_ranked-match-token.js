"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankedMatchTokenKey = rankedMatchTokenKey;
exports.mintRankedMatchToken = mintRankedMatchToken;
exports.consumeRankedMatchToken = consumeRankedMatchToken;
/**
 * Server-minted single-use "ranked match" token (audit item #10).
 *
 * The PvP `ranked` flag on a session was historically taken from the client
 * body, so a player could self-flag a casual win as ranked and move the ladder.
 * (The ratings, winner, and rating MAGNITUDE were already server-authoritative —
 * only the ranked-or-not assertion was trusted.) This couples `ranked` to a real
 * queue match: when the ranked queue (api/pvp/ranked-queue.ts) or pet ranked
 * queue (api/pvp/pet-ranked-queue.ts) pairs two players, it MINTS a token keyed
 * by the unordered fighter pair + ladder. api/pvp/session.ts then CONSUMES that
 * token when the client claims `ranked`, and only stamps the session ranked if a
 * token was present. A fabricated `ranked` claim finds no token → the session is
 * recorded as CASUAL (never errored — the battle still runs).
 *
 * Pair-keyed (not a random id threaded through the client) so the proof is
 * verified entirely server-side: the client needs no change, can't forge it, and
 * either fighter can be the one who creates the session. Single-use is the
 * farming bound — one ranked result per genuine queue match — so the TTL only
 * has to outlast the match → challenge → accept → session latency and can be
 * generous without widening any abuse window.
 *
 * Mirrors the established mint/consume pattern (expedition-start →
 * report-pet-event, raid-start → report-raid, pet ranked-start → battle-result).
 */
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
// 30 min: comfortably outlasts the challenge + accept + prefight gap between the
// queue match and session creation. Single-use deletion (below) is what prevents
// replay/farming, NOT the TTL, so a long window cannot be abused.
const RANKED_TOKEN_TTL_SECONDS = 30 * 60;
/**
 * Key for the pair's ranked-match token. The two slugs are SORTED so the key is
 * identical regardless of which fighter queued first or which side ends up
 * creating the session. safeName is idempotent, so callers may pass raw names or
 * already-canonical slugs.
 */
function rankedMatchTokenKey(a, b, ladder) {
    const [lo, hi] = [(0, _utils_js_1.safeName)(a), (0, _utils_js_1.safeName)(b)].sort();
    return `pvp:ranked-match-token:${ladder}:${lo}:${hi}`;
}
/** Mint (or refresh) the pair's ranked-match token. Called by the queues on match. */
async function mintRankedMatchToken(a, b, ladder) {
    await _storage_js_1.kv.set(rankedMatchTokenKey(a, b, ladder), { mintedAt: Date.now() }, { ex: RANKED_TOKEN_TTL_SECONDS });
}
/**
 * Atomically consume the pair's ranked-match token. Returns true iff a token was
 * present (and is now deleted). `kv.del` returns the number of rows actually
 * removed, so this check-and-delete is a single atomic DB op — no get-then-del
 * race, no lock needed. A `pvp:*` key routes to the base Postgres store (not the
 * cPanel disk overlay), so the row count reflects true shared state.
 */
async function consumeRankedMatchToken(a, b, ladder) {
    return (await _storage_js_1.kv.del(rankedMatchTokenKey(a, b, ladder))) > 0;
}
