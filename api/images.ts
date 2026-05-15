import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from './_utils.js';

// Legacy single-blob key (kept for backward-compat reads during migration)
const LEGACY_KEY = 'shared:images';

// Per-category keys — new images go here, GET merges legacy + category
const catKey = (cat: string) => `shared:images:${cat}`;

const KNOWN_PREFIXES: Record<string, string> = {
    avatar:    'avatar',
    pet:       'pet',
    jutsu:     'jutsu',
    item:      'item',
    card:      'card',
    event:     'event',
    bloodline: 'bloodline',
    vn:        'event',   // visual-novel pages share the event category
};

function categoryFromId(id: string): string {
    const prefix = id.split(':')[0];
    return KNOWN_PREFIXES[prefix] ?? 'misc';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const cat = typeof req.query.cat === 'string' ? req.query.cat.trim() : '';

        if (cat) {
            // Fetch new category key in parallel with a filtered read of the legacy blob
            const [catImages, legacy] = await Promise.all([
                kv.get<Record<string, string>>(catKey(cat)),
                kv.get<Record<string, string>>(LEGACY_KEY),
            ]);

            // Pull any matching entries from the legacy blob (migration shim)
            const legacyMatches: Record<string, string> = {};
            if (legacy) {
                for (const [k, v] of Object.entries(legacy)) {
                    if (categoryFromId(k) === cat) legacyMatches[k] = v;
                }
            }

            // Category-specific key wins over legacy for any duplicate key
            return res.status(200).json({ ...legacyMatches, ...(catImages ?? {}) });
        }

        // No category param — return everything (admin / bulk use)
        const images = await kv.get<Record<string, string>>(LEGACY_KEY);
        return res.status(200).json(images ?? {});
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { id, image } = body as { id?: string; image?: string };
            if (!id || !image) return res.status(400).json({ error: 'Missing id or image.' });

            const cat = categoryFromId(id);
            const key = catKey(cat);

            const existing = await kv.get<Record<string, string>>(key) ?? {};
            existing[id] = image;
            await kv.set(key, existing);

            return res.status(200).end();
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}
