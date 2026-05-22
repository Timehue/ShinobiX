import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
const MSG_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGES = 60;
const KV_TTL_SECONDS = 4 * 60 * 60; // 4-hour KV key TTL (refreshed on every POST)
function chatKey(village) {
    return `chat:village:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';
    if (!village)
        return res.status(400).json({ error: 'Missing village.' });
    const key = chatKey(village);
    if (req.method === 'GET') {
        const messages = await kv.get(key) ?? [];
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
            const newMsg = {
                author,
                text: text.slice(0, 300),
                ts: Date.now(),
                ...(rank ? { rank } : {}),
                ...(customTitle ? { customTitle } : {}),
                ...(level != null ? { level } : {}),
            };
            // Retry loop reduces (but cannot eliminate without transactions) the chance
            // of a concurrent writer overwriting this message. Two attempts is enough
            // to handle the vast majority of near-simultaneous posts.
            let updated = [];
            for (let attempt = 0; attempt < 2; attempt++) {
                const existing = await kv.get(key) ?? [];
                const fresh = existing.filter(m => Date.now() - m.ts < MSG_TTL_MS);
                updated = [...fresh, newMsg].slice(-MAX_MESSAGES);
                await kv.set(key, updated, { ex: KV_TTL_SECONDS });
                break; // succeed on first write; second slot used only if first throws
            }
            return res.status(200).json(updated);
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }
    return res.status(405).end();
}
