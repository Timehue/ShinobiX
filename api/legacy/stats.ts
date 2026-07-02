import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { getLegacyStats, legacyEnabled } from '../_legacy-track.js';
import { evaluateAllLegacies, getLegacyOverlay } from '../_legacy-score.js';
import { legacyTrialKey, trialProgress, trialIntroFor, type LegacyTrial, type CharacterLegacy } from '../_legacy-core.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';

/*
 * GET /api/legacy/stats?playerName=... — the LegacyPanel's single fetch.
 *
 * Returns the player's own Legacy state: accepted legacy + stage, active
 * trial WITH live progress, an active Sage offer if one is waiting, and a
 * deliberately vague "strongest paths" summary (bucketed tiers, never raw
 * counters or thresholds — the mystery rule).
 */

const TIERS = ['stirring', 'taking shape', 'strong', 'dominant'] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!legacyEnabled()) return res.status(404).json({ error: 'Legacies are not awake yet.' });

    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only view your own legacy.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'legacy-stats', 20, 60_000, identity.name))) return;

        const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (rec?.character ?? null) as Record<string, unknown> | null;
        if (!char) return res.status(404).json({ error: 'Save not found.' });

        const stats = await getLegacyStats(playerName, char);
        const overlay = await getLegacyOverlay();
        const level = Number(char.level ?? 0) || 0;
        const village = typeof char.village === 'string' ? char.village : null;
        const evals = evaluateAllLegacies(stats, { level, village, overlay });

        // Bucketed per-category strength: max score across that category's
        // legacies, tiered — enough for rumors and the panel, no formulas.
        const byCategory = new Map<string, number>();
        for (const ev of evals) {
            byCategory.set(ev.category, Math.max(byCategory.get(ev.category) ?? 0, ev.score));
        }
        const strongest = [...byCategory.entries()]
            .filter(([, s]) => s >= 0.25)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([category, s]) => ({
                category,
                tier: TIERS[Math.min(TIERS.length - 1, Math.floor(Math.min(s, 1.31) / 0.35))],
            }));

        const eligibleCounts: Record<string, number> = { basic: 0, rare: 0, legendary: 0, mythic: 0 };
        for (const ev of evals) if (ev.eligible) eligibleCounts[ev.rarity] += 1;

        const legacy = (char.legacy ?? null) as CharacterLegacy | null;
        const trialRaw = await kv.get<LegacyTrial>(legacyTrialKey(playerName));
        const trial = trialRaw && LEGACY_BY_ID.has(trialRaw.legacyId)
            ? { ...trialRaw, objectives: trialProgress(trialRaw, stats) }
            : null;
        const trialIntro = trialRaw && LEGACY_BY_ID.has(trialRaw.legacyId)
            ? trialIntroFor(LEGACY_BY_ID.get(trialRaw.legacyId)!, trialRaw.kind)
            : null;
        const offer = await kv.get<Record<string, unknown>>(`legacy:sage-offer:${playerName}`);

        return res.status(200).json({
            level,
            minLevelReached: level >= 50,
            legacy,
            // The accepted legacy's category, resolved server-side so the client
            // can match the player to their trial-giver emissary without
            // shipping the 100-def table (lib/legacy-emissaries.ts).
            legacyCategory: legacy ? (LEGACY_BY_ID.get(legacy.legacyId)?.category ?? null) : null,
            trial,
            trialIntro,
            offer: offer && offer.status === 'spawned' ? offer : null,
            strongest,
            eligibleCounts,
        });
    } catch (err) {
        console.error('[legacy/stats]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
