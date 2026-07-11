"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _ranked_settlement_js_1 = require("./_ranked-settlement.js");
/*
 * /api/pet/ranked-start — POST only
 *
 * Ranked pet combat is client-resolved today, so this endpoint MUST NOT mint a
 * token that can move the competitive ladder. Sealing only the participants and
 * pre-match ratings does not prove who won; the first reporter can choose the
 * outcome. Starts remain server-disabled until a deterministic server combat
 * engine writes a `server-engine-v1` resolution into the private match token.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) {
        return res.status(400).json({ error: 'Ranked pet matches require a player identity.' });
    }
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-ranked-start', 12, 60_000, identity.name)))
        return;
    if (!(0, _ranked_settlement_js_1.petRankedStartsEnabled)()) {
        return res.status(503).json({
            ok: false,
            error: _ranked_settlement_js_1.PET_RANKED_DISABLED_REASON,
            reason: 'Ranked pet matches require a deterministic server-resolved outcome.',
        });
    }
    // Unreachable until petRankedStartsEnabled is intentionally changed as part
    // of the server-engine integration. Keeping the denial here makes a future
    // partial flag/config rollout fail closed as well.
    return res.status(503).json({ ok: false, error: _ranked_settlement_js_1.PET_RANKED_DISABLED_REASON });
}
