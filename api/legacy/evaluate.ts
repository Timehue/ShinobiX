import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { getLegacyStats, legacyEnabled } from '../_legacy-track.js';
import { evaluateAllLegacies, getLegacyOverlay } from '../_legacy-score.js';

/*
 * POST /api/legacy/evaluate { playerName } — recompute eligibility and cache
 * it at legacy:eligibility:<player>. Player-facing responses stay vague
 * (counts per rarity only); the full per-requirement breakdown is only in the
 * cache, which the ADMIN dashboard reads (api/admin/legacy.ts).
 */

const ELIGIBILITY_TTL_SECONDS = 7 * 24 * 60 * 60;
export const eligibilityKey = (player: string) => `legacy:eligibility:${player}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!legacyEnabled()) return res.status(404).json({ error: 'Legacies are not awake yet.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only evaluate yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'legacy-evaluate', 2, 60_000, identity.name))) return;

        const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (rec?.character ?? null) as Record<string, unknown> | null;
        if (!char) return res.status(404).json({ error: 'Save not found.' });

        const stats = await getLegacyStats(playerName, char);
        const overlay = await getLegacyOverlay();
        const level = Number(char.level ?? 0) || 0;
        const village = typeof char.village === 'string' ? char.village : null;
        const evals = evaluateAllLegacies(stats, { level, village, overlay });

        const evaluatedAt = Date.now();
        await kv.set(eligibilityKey(playerName), { evaluatedAt, level, village, entries: evals }, { ex: ELIGIBILITY_TTL_SECONDS });

        const eligibleCounts: Record<string, number> = { basic: 0, rare: 0, legendary: 0, mythic: 0 };
        for (const ev of evals) if (ev.eligible) eligibleCounts[ev.rarity] += 1;
        return res.status(200).json({ ok: true, evaluatedAt, eligibleCounts });
    } catch (err) {
        console.error('[legacy/evaluate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
