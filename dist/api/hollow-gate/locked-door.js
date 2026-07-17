"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _run_token_js_1 = require("./_run-token.js");
const _locked_door_js_1 = require("./_locked-door.js");
const unit = () => (0, node_crypto_1.randomInt)(1_000_000_000) / 1_000_000_000;
const cleanToken = (value) => typeof value === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value) ? value : '';
const cleanRequestId = (value) => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(value) ? value : '';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const token = cleanToken(body.token);
        const requestId = cleanRequestId(body.requestId);
        if (!playerName || !token || !requestId)
            return res.status(400).json({ error: 'Invalid locked-door request.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'hollow-gate-locked-door', 30, 60_000, identity.name)))
            return;
        const run = await _storage_js_1.kv.get((0, _run_token_js_1.hollowGateRunKey)(playerName, token));
        if (!run || run.playerName.toLowerCase() !== playerName.toLowerCase())
            return res.status(409).json({ error: 'invalid-or-spent-run' });
        const resultKey = `hg-locked-result:${playerName}:${token}:${requestId}`;
        const result = await (0, _lock_js_1.withKvLock)(resultKey, async () => {
            const cached = await _storage_js_1.kv.get(resultKey);
            if (cached)
                return cached;
            const count = await _storage_js_1.kv.incr(`hg-locked-count:${playerName}:${token}`, { ex: 25 * 60 * 60 });
            if (!identity.admin && count > (0, _locked_door_js_1.maxLockedDoorsForDepth)(run.floorDepth))
                return null;
            const rolled = (0, _locked_door_js_1.rollHollowLockedDoor)(unit, Date.now(), run.floorDepth);
            if (rolled.outcome === 'pet' && rolled.pet) {
                rolled.petToken = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
                await _storage_js_1.kv.set(`pet-encounter:${playerName}:${rolled.petToken}`, { playerName, pet: rolled.pet, mintedAt: Date.now() }, { ex: 20 * 60 });
            }
            await _storage_js_1.kv.set(resultKey, rolled, { ex: 25 * 60 * 60 });
            return rolled;
        }, { failClosed: true });
        if (!result)
            return res.status(429).json({ error: 'locked-door-limit' });
        return res.status(200).json({ ok: true, ...result });
    }
    catch (error) {
        console.error('[hollow-gate/locked-door]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
