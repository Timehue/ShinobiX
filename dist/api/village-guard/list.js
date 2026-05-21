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
        const { village } = body;
        if (!village)
            return res.status(400).json({ error: 'Missing village.' });
        const keys = await kv.keys('guard:*');
        const guards = (await Promise.all(keys.map(k => kv.get(k))))
            .filter((g) => !!g && g.village === village)
            .map(({ name, level, village: v }) => ({ name, level, village: v }));
        return res.status(200).json(guards);
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
