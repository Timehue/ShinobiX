import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        // Clans are written by the client (clan-api.ts writeClanData) to
        // `save:clan-<slug>` via the /api/save endpoint — the same key the
        // Clan Hall reads back. So that is the authoritative pattern to scan.
        // `clan:*` is an older/legacy layout kept here as a fallback so a
        // pre-migration clan record still surfaces in the list. Dedupe by key
        // (a migrated clan can exist under both) preferring the `save:clan-*`
        // copy, which is the one the rest of the app reads/writes.
        const [saveKeys, legacyKeys] = await Promise.all([
            kv.keys('save:clan-*'),
            kv.keys('clan:*').catch(() => [] as string[]),
        ]);
        // Normalize both layouts (`save:clan-storm` and legacy `clan:storm`)
        // to the bare slug so a clan present under both isn't listed twice.
        const bareSlug = (k: string) => k.replace(/^save:clan-/, '').replace(/^clan[:-]/, '');
        const seen = new Set(saveKeys.map(bareSlug));
        const keys = [...saveKeys, ...legacyKeys.filter((k) => !seen.has(bareSlug(k)))];
        // 30s edge cache + 60s SWR. The public clan list changes when a
        // clan is created/disbanded/edited — minute-scale latency is
        // fine, and the underlying mget is expensive (one row per clan).
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
        if (!keys.length) return res.status(200).json([]);
        const clans = await kv.mget(...keys);
        return res.status(200).json(clans.filter(Boolean));
    } catch (err) {
        console.error('[clans/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
