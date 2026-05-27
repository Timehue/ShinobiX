import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

// NOTE: LEGACY_IMAGE_KEY ('shared:images') intentionally omitted here — it is a
// multi-MB all-categories blob that causes connection-pool exhaustion when
// fetched alongside N save reads.  Bloodline images migrated to the per-category
// keys below, so the legacy blob is redundant for this endpoint.
const bloodlineImageBlobKey = 'shared:images:bloodline';
const bloodlineImageHashKey = 'shared:imgfields:bloodline';

type RawBloodline = Record<string, unknown>;
type PublicBloodlineEntry = {
    id: string;
    name: string;
    rank: string;
    image?: string;
    specialElement?: string;
    lore?: string;
    jutsus: unknown[];
    totalPoints: number;
    ownerName: string;
    ownerKey: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Auth gate: this endpoint mget's EVERY player save in the registry
    // (expensive) and returns the full list of (ownerName, ownerKey,
    // bloodlines) — useful for stalking and player enumeration. Auth
    // required so the cost can't be triggered by anonymous traffic.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        // Fetch image maps and save keys in parallel — 3 queries total.
        const [saveKeys, bloodlineBlobImages, bloodlineHashImages] = await Promise.all([
            kv.keys('save:*'),
            kv.get<Record<string, string>>(bloodlineImageBlobKey),
            kv.hgetall<Record<string, string>>(bloodlineImageHashKey),
        ]);
        const sharedBloodlineImages = {
            ...(bloodlineBlobImages ?? {}),
            ...(bloodlineHashImages ?? {}),
        };

        // Batch-fetch all saves in a single mget instead of N individual get()
        // calls. This keeps connection-pool usage to 1 query regardless of how
        // many players exist, eliminating the N+1 pattern that caused pool
        // exhaustion and high error rates under load.
        const nonAdminKeys = saveKeys.filter(k => !k.replace('save:', '').toLowerCase().startsWith('admin'));
        const snapshots = nonAdminKeys.length
            ? await kv.mget<Record<string, unknown>[]>(...nonAdminKeys)
            : [];

        const bloodlines: PublicBloodlineEntry[] = [];
        for (let i = 0; i < nonAdminKeys.length; i++) {
            const key = nonAdminKeys[i]!;
            const snap = snapshots[i] ?? null;
            const ownerKey = key.replace('save:', '');
            const char = snap?.character as Record<string, unknown> | undefined;
            const ownerName = (char?.name as string) ?? ownerKey;
            const rawBloodlines = snap?.savedBloodlines as RawBloodline[] | undefined;
            if (!Array.isArray(rawBloodlines)) continue;
            for (const bloodline of rawBloodlines) {
                if (!bloodline?.id || !bloodline?.name) continue;
                const id = String(bloodline.id);
                bloodlines.push({
                    id,
                    name: String(bloodline.name),
                    rank: String(bloodline.rank ?? 'B Rank'),
                    image: sharedBloodlineImages[`bloodline:${id}`] ?? (bloodline.image ? String(bloodline.image) : undefined),
                    specialElement: bloodline.specialElement ? String(bloodline.specialElement) : undefined,
                    lore: bloodline.lore ? String(bloodline.lore) : undefined,
                    jutsus: Array.isArray(bloodline.jutsus) ? bloodline.jutsus : [],
                    totalPoints: Number(bloodline.totalPoints ?? 0),
                    ownerName,
                    ownerKey,
                });
            }
        }
        bloodlines.sort((a, b) => a.name.localeCompare(b.name) || a.ownerName.localeCompare(b.ownerName));
        // 60s edge cache + 120s SWR. Public bloodline gallery is
        // read-heavy + expensive (scans every save row) but rarely
        // changes — minute-scale latency is fine.
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        return res.status(200).json({ bloodlines });
    } catch (err) {
        // Return empty list rather than 500 so the bloodline gallery degrades
        // gracefully during transient DB outages instead of showing an error.
        console.error('[bloodlines/list]', String(err));
        return res.status(200).json({ bloodlines: [] });
    }
}
