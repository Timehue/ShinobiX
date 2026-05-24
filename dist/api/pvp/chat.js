"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const MSG_TTL_MS = 60 * 60 * 1000; // 1 hour (matches battle session TTL)
const MAX_MESSAGES = 100;
const KV_TTL_SECONDS = 2 * 60 * 60; // 2-hour KV key TTL
function chatKey(battleId) {
    return `chat:battle:${battleId}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const battleId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!battleId)
        return res.status(400).json({ error: 'Missing battle id.' });
    const key = chatKey(battleId);
    if (req.method === 'GET') {
        const messages = await _storage_js_1.kv.get(key) ?? [];
        const fresh = messages.filter(m => Date.now() - m.ts < MSG_TTL_MS);
        res.setHeader('X-Message-Count', String(fresh.length));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(fresh);
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { author, text } = body;
            if (!author || !text)
                return res.status(400).json({ error: 'Missing author or text.' });
            // Auth required so spectators can't impersonate fighters in battle chat.
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, author);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            const authorNorm = author.toLowerCase().trim();
            if (!identity.admin && identity.name !== authorNorm) {
                return res.status(403).json({ error: 'Cannot post as another player.' });
            }
            // Derive role from the session: if the author is one of the two
            // fighters, allow `fighter`; otherwise force `spectator` regardless
            // of what the body claimed.
            let derivedRole = 'spectator';
            try {
                const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
                if (session) {
                    const p1Norm = String(session.p1?.name ?? '').toLowerCase().trim();
                    const p2Norm = String(session.p2?.name ?? '').toLowerCase().trim();
                    if (authorNorm === p1Norm || authorNorm === p2Norm) {
                        derivedRole = 'fighter';
                    }
                }
            }
            catch {
                // Session lookup failed — fall back to spectator.
            }
            const newMsg = {
                author,
                text: text.slice(0, 200),
                ts: Date.now(),
                role: derivedRole,
            };
            const existing = await _storage_js_1.kv.get(key) ?? [];
            const fresh = existing.filter(m => Date.now() - m.ts < MSG_TTL_MS);
            const updated = [...fresh, newMsg].slice(-MAX_MESSAGES);
            await _storage_js_1.kv.set(key, updated, { ex: KV_TTL_SECONDS });
            return res.status(200).json(updated);
        }
        catch (err) {
            console.error('[pvp/chat]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
