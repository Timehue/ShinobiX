import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from './_utils.js';

const IMAGES_KEY = 'shared:images';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const images = await kv.get<Record<string, string>>(IMAGES_KEY);
        return res.status(200).json(images ?? {});
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { id, image } = body as { id?: string; image?: string };
            if (!id || !image) return res.status(400).json({ error: 'Missing id or image.' });
            const existing = await kv.get<Record<string, string>>(IMAGES_KEY) ?? {};
            existing[id] = image;
            await kv.set(IMAGES_KEY, existing);
            return res.status(200).end();
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}
