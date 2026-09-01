import type { VercelRequest, VercelResponse } from './_vercel.js';
import { cors } from './_utils.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { recentAnnouncements } from './_announce.js';

type PublicAnnouncement = Awaited<ReturnType<typeof recentAnnouncements>>[number];

function neutralizeLegacyTierText(value: string): string {
    return value
        .replace(/\bmythic\b/gi, 'storied')
        .replace(/\blegendary\b/gi, 'distinguished');
}

/** Public projection for both new and historical Legacy announcements. */
export function publicAnnouncement(announcement: PublicAnnouncement): PublicAnnouncement {
    if (!announcement.legacyId) return announcement;
    const meta = announcement.meta && typeof announcement.meta === 'object'
        ? (() => {
            const { rarity: _privateRarity, ...publicMeta } = announcement.meta;
            return publicMeta;
        })()
        : announcement.meta;
    return {
        ...announcement,
        type: /(?:mythic|legendary)_legacy/i.test(announcement.type)
            ? 'legacy_milestone'
            : announcement.type,
        // Legacy importance is an internal delivery decision. Publishing the
        // mythic value would reveal the hidden rarity bucket one-for-one.
        importance: 'high',
        title: neutralizeLegacyTierText(announcement.title),
        message: neutralizeLegacyTierText(announcement.message),
        ...(meta ? { meta } : { meta: undefined }),
    };
}

/*
 * GET /api/announcements?since=<id>&limit=<n> — the world news feed
 * Read-only; announcements are only ever minted server-side by world moments
 * through api/_announce.ts. The feed remains available even when an individual
 * feature such as Legacy is disabled.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!(await enforceRateLimitKv(req, res, 'announcements', 30, 60_000, null))) return;

    try {
        const since = Math.max(0, Math.floor(Number(req.query.since) || 0));
        const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit) || 20)));
        const announcements = (await recentAnnouncements(limit, since)).map(publicAnnouncement);
        res.setHeader('Cache-Control', 'public, max-age=15');
        return res.status(200).json({
            announcements,
            latestId: announcements.length > 0 ? announcements[0].id : since,
        });
    } catch (err) {
        console.error('[announcements]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
