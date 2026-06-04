"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _storage_js_2 = require("./_storage.js");
// Pet Tamer offers escort to their clan. Sets a 1h-TTL marker; the offer
// auto-expires if not refreshed. Vanguards in the same clan who win a raid
// with an active pet trigger a +20% next-expedition bonus on the offerer.
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only offer escort as yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-escort-offer', 15, 60_000, identity.name)))
            return;
        const record = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = record?.character;
        if (!char)
            return res.status(404).json({ error: 'Character not found.' });
        if (char.profession !== 'petTamer') {
            return res.status(403).json({ error: 'Only Pet Tamers can offer escort.' });
        }
        const clanName = typeof char.clan === 'string' ? char.clan : '';
        if (!clanName)
            return res.status(400).json({ error: 'You must be in a clan to offer escort.' });
        // Verify the offerer is actually in the clan's member roster. A
        // kicked player whose own save still says clan="X" must not be able
        // to keep offering escorts to clan X. Use the canonical clan-record key
        // (bare slug) — the old hyphenated slug here ("storm-clan") never
        // matched the actual record key ("stormclan"), so the membership check
        // silently failed for every multi-word clan name. (audit #19)
        const clanRecord = await _storage_js_1.kv.get((0, _utils_js_1.clanRecordKey)(clanName));
        const members = Array.isArray(clanRecord?.members) ? clanRecord.members : [];
        const isMember = members.some((m) => (0, _utils_js_1.safeName)(String(m?.name ?? '')) === playerName);
        if (!isMember) {
            return res.status(403).json({ error: 'You are no longer a member of that clan.' });
        }
        await (0, _storage_js_2.offerEscort)(clanName, playerName);
        return res.status(200).json({ ok: true, clanName, petTamer: playerName, expiresInSeconds: 60 * 60 });
    }
    catch (err) {
        console.error('[clan/pet-escort/offer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
