"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const MSG_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGES = 60;
const KV_TTL_SECONDS = 4 * 60 * 60; // 4-hour KV key TTL (refreshed on every POST)
function chatKey(village) {
    return `chat:village:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';
    if (!village)
        return res.status(400).json({ error: 'Missing village.' });
    const key = chatKey(village);
    if (req.method === 'GET') {
        const messages = await _storage_js_1.kv.get(key) ?? [];
        const fresh = messages.filter(m => Date.now() - m.ts < MSG_TTL_MS);
        // X-Message-Count lets the client skip JSON parsing when nothing changed
        res.setHeader('X-Message-Count', String(fresh.length));
        // Don't cache chat — always fresh, but no-store avoids CDN storing it
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(fresh);
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { author, text, rank, customTitle, level } = body;
            if (!author || !text)
                return res.status(400).json({ error: 'Missing author or text.' });
            // Authenticate the author so trolls can't impersonate the Kage
            // (or anyone else) in village chat.
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, author);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== author.toLowerCase().trim()) {
                return res.status(403).json({ error: 'Cannot post as another player.' });
            }
            const newMsg = {
                author,
                text: text.slice(0, 300),
                ts: Date.now(),
                ...(rank ? { rank } : {}),
                ...(customTitle ? { customTitle } : {}),
                ...(level != null ? { level } : {}),
            };
            // Read-modify-write — the previous retry loop was dead code (broke
            // unconditionally on iter 0). Concurrent writers can still race here;
            // accepting that for now since chat-message loss is low-impact and
            // truly fixing it needs RPC-level CAS.
            const existing = await _storage_js_1.kv.get(key) ?? [];
            const fresh = existing.filter(m => Date.now() - m.ts < MSG_TTL_MS);
            const updated = [...fresh, newMsg].slice(-MAX_MESSAGES);
            await _storage_js_1.kv.set(key, updated, { ex: KV_TTL_SECONDS });
            return res.status(200).json(updated);
        }
        catch (err) {
            console.error('[village/chat]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
