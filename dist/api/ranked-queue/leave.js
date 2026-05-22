import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        const nameLower = name.toLowerCase().trim();
        const raw = await kv.get('ranked-queue') ?? [];
        const updated = raw.filter((e) => e.name.toLowerCase() !== nameLower);
        await kv.set('ranked-queue', updated, { ex: 600 });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
