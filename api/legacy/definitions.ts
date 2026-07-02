import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LEGACY_DEFS, LEGACY_MIN_LEVEL } from '../_legacy-defs.js';
import { getLegacyOverlay } from '../_legacy-score.js';
import { legacyEnabled } from '../_legacy-track.js';

/*
 * GET /api/legacy/definitions — the public Legacy codex.
 *
 * Names, rarity, category, village affinity, flavor, and titles only — the
 * requirement formulas deliberately stay server-side (design rule: players see
 * mystery and rumors, never a min-max checklist).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!legacyEnabled()) return res.status(404).json({ error: 'Legacies are not awake yet.' });
    if (!(await enforceRateLimitKv(req, res, 'legacy-definitions', 30, 60_000, null))) return;

    try {
        const overlay = await getLegacyOverlay();
        const disabled = new Set(overlay.disabled ?? []);
        const legacies = LEGACY_DEFS.filter((d) => !disabled.has(d.id)).map((d) => ({
            id: d.id, name: d.name, rarity: d.rarity, category: d.category,
            villageAffinity: d.villageAffinity ?? null, title: d.title,
            flavor: d.flavor, badge: d.badge ?? null,
        }));
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).json({ minLevel: LEGACY_MIN_LEVEL, legacies });
    } catch (err) {
        console.error('[legacy/definitions]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
