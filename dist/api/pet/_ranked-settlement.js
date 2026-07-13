"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PET_RANKED_DISABLED_REASON = void 0;
exports.petRankedStartsEnabled = petRankedStartsEnabled;
exports.derivePetRankedSettlement = derivePetRankedSettlement;
const _utils_js_1 = require("../_utils.js");
exports.PET_RANKED_DISABLED_REASON = 'ranked-pet-server-authority-required';
/**
 * Ranked pet starts stay disabled until a server-side combat engine can produce
 * this resolution and seal it in the private match-token record. An environment
 * toggle cannot make a client-computed winner authoritative.
 */
function petRankedStartsEnabled() {
    return false;
}
/**
 * Derive the settlement exclusively from a private, server-resolved token.
 * `reportedOutcome` is never an input to winner selection; it is only checked
 * so a stale/conflicting client gets a clear 409 instead of silently showing the
 * opposite result.
 */
function derivePetRankedSettlement(token, callerName, reportedOutcome) {
    const resolution = token?.resolution;
    if (!resolution || resolution.authority !== 'server-engine-v1') {
        return { ok: false, reason: 'server-resolution-required' };
    }
    if ((resolution.winner !== 'a' && resolution.winner !== 'b')
        || !Number.isFinite(resolution.resolvedAt)
        || resolution.resolvedAt < token.createdAt
        || typeof resolution.engineDigest !== 'string'
        || resolution.engineDigest.length < 16) {
        return { ok: false, reason: 'invalid-server-resolution' };
    }
    const a = (0, _utils_js_1.safeName)(token.a);
    const b = (0, _utils_js_1.safeName)(token.b);
    const caller = (0, _utils_js_1.safeName)(callerName);
    if (!a || !b || a === b || (caller !== a && caller !== b)) {
        return { ok: false, reason: 'caller-not-in-match' };
    }
    const aRating = Number(token.aRating);
    const bRating = Number(token.bRating);
    if (!Number.isFinite(aRating) || !Number.isFinite(bRating)) {
        return { ok: false, reason: 'invalid-server-resolution' };
    }
    const winnerName = resolution.winner === 'a' ? a : b;
    const loserName = resolution.winner === 'a' ? b : a;
    const winnerRating = resolution.winner === 'a' ? aRating : bRating;
    const loserRating = resolution.winner === 'a' ? bRating : aRating;
    const authoritativeOutcome = caller === winnerName ? 'win' : 'loss';
    if (reportedOutcome !== authoritativeOutcome) {
        return { ok: false, reason: 'conflicting-client-outcome' };
    }
    return {
        ok: true,
        settlement: {
            callerRole: authoritativeOutcome === 'win' ? 'winner' : 'loser',
            authoritativeOutcome,
            winnerName,
            loserName,
            winnerRating,
            loserRating,
        },
    };
}
