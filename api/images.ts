import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors } from './_utils.js';

// Legacy single-blob key (kept for backward-compat reads during migration)
const LEGACY_KEY = 'shared:images';

// Old per-category JSON blob keys (kept for backward-compat reads)
const catKey = (cat: string) => `shared:images:${cat}`;

// New per-category Redis hash keys — HSET is atomic per-field, eliminating
// the GET→modify→SET race condition that caused concurrent uploads to overwrite
// each other and permanently lose images.
const catHashKey = (cat: string) => `shared:imgfields:${cat}`;

const KNOWN_PREFIXES: Record<string, string> = {
    avatar:    'avatar',
    pet:       'pet',
    jutsu:     'jutsu',
    item:      'item',
    card:      'card',
    event:     'event',
    bloodline: 'bloodline',
    vn:        'event',   // visual-novel pages share the event category
    ai:        'ai',
};
const KNOWN_CATEGORIES = Array.from(new Set(Object.values(KNOWN_PREFIXES)));

function categoryFromId(id: string): string {
    const prefix = id.split(':')[0];
    return KNOWN_PREFIXES[prefix] ?? 'misc';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            const cat = typeof req.query.cat === 'string' ? req.query.cat.trim() : '';

            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

            // Helper: read a kv value with a per-call timeout so one slow Supabase
            // REST response never hangs the whole function.
            const withTimeout = <T>(p: Promise<T | null>, ms = 25_000): Promise<T | null> =>
                Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

            if (cat) {
                // Fetch hash (primary) and old blob (backward-compat) in parallel.
                // Skip the legacy single-blob key — it's empty after migration and
                // is multi-MB; reading it on every request causes Vercel timeouts.
                const [hashImages, catImages] = await Promise.all([
                    withTimeout(kv.hgetall<Record<string, string>>(catHashKey(cat))),
                    withTimeout(kv.get<Record<string, string>>(catKey(cat))),
                ]);

                // Merge: old blob < new hash (newest always wins)
                return res.status(200).json({
                    ...(catImages ?? {}),
                    ...(hashImages ?? {}),
                });
            }

            // No category param — return everything (admin / bulk use).
            // Run per-category fetches in parallel with individual timeouts.
            const categoryEntries = await Promise.all(
                KNOWN_CATEGORIES.flatMap((category) => [
                    withTimeout(kv.get<Record<string, string>>(catKey(category))),
                    withTimeout(kv.hgetall<Record<string, string>>(catHashKey(category))),
                ]),
            );
            return res.status(200).json(Object.assign({}, ...categoryEntries.map((entry) => entry ?? {})));
        } catch (err) {
            console.error('[images GET error]', err);
            return res.status(200).json({}); // return empty rather than hanging/500
        }
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { id, image } = body as { id?: string; image?: string };
            if (!id || typeof image !== 'string') return res.status(400).json({ error: 'Missing id or image.' });

            const cat = categoryFromId(id);
            // Atomic HSET — sets exactly this one field without touching any other
            // image in the same category. Eliminates the race condition.
            await kv.hset(catHashKey(cat), { [id]: image });

            return res.status(200).end();
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}
