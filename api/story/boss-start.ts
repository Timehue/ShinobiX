import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { writeSoloPveSession } from '../solo-pve/_store.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import {
    createStoryCombatBinding,
    storyBossEligibility,
    storyBossEnemyTemplate,
    storyBossRunId,
    storyCombatBindingKey,
    STORY_COMBAT_SESSION_TTL_SECONDS,
    STORY_VILLAGE_BIOMES,
} from './_authoritative-story-combat.js';

/**
 * Start a sealed, server-resolved story-boss fight for the player's CURRENT
 * milestone. Body: { playerName }. The milestone, opponent, stats, environment,
 * and reward row are all derived server-side from the save.
 * Mirrors api/missions/combat-start.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!enforceRateLimit(req, res, 'story-boss-start', 12, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only start your own story battle.' });

        const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
        const char = save?.character as Record<string, unknown> | undefined;
        if (!save || !char) return res.status(404).json({ error: 'Player save not found.' });
        const eligibility = storyBossEligibility(char);
        if (!eligibility.ok) return res.status(eligibility.status).json({ error: eligibility.error });

        const runId = storyBossRunId();
        const now = Date.now();
        const bossTemplate = storyBossEnemyTemplate({
            village: eligibility.village,
            progressIndex: eligibility.progressIndex,
        });
        const binding = createStoryCombatBinding({
            runId,
            playerName,
            village: eligibility.village,
            progressIndex: eligibility.progressIndex,
            now,
        });
        const session = buildSoloPveAiEncounter({
            sessionId: runId,
            playerName,
            save,
            now,
            profile: bossTemplate,
            admin: await loadAdminCombatContent(),
            difficultyMode: 'STORY',
            encounter: {
                kind: 'story-boss',
                id: `${eligibility.village}:${eligibility.progressIndex}`,
                sourceId: binding.opponentId,
                bindingId: runId,
            },
            environment: { biome: STORY_VILLAGE_BIOMES[eligibility.village] ?? 'central' },
        });
        await writeSoloPveSession(session);
        await kv.set(storyCombatBindingKey(runId), binding, { ex: STORY_COMBAT_SESSION_TTL_SECONDS });
        return res.status(200).json({ ok: true, runId, session });
    } catch (err) {
        console.error('[story/boss-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
