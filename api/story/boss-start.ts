import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { buildAuthoritativeSoloEncounter, dynamicBossFloor } from '../_authoritative-pve.js';
import { sealPveDifficultyBand } from '../_pve-band-seal.js';
import { sealPveAiMastery } from '../_pve-ai-mastery.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { writeSession } from '../towers/_tower-store.js';
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
 * milestone. Body: { playerName, hostLoadout?, bossName? } — bossName is
 * display-only flavor from the authored storyline; the milestone, opponent,
 * stats, and reward row are all derived server-side from the save.
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
        const seed = identity.admin ? 12345 : randomInt(1, 0x7fffffff);
        const now = Date.now();
        const bossTemplate = storyBossEnemyTemplate({
            village: eligibility.village,
            progressIndex: eligibility.progressIndex,
            displayName: typeof body.bossName === 'string' ? body.bossName : undefined,
        });
        const floor = dynamicBossFloor({
            id: 9_200 + eligibility.progressIndex,
            name: `story-${eligibility.village.toLowerCase().replace(/\W+/g, '-')}-${eligibility.progressIndex}`,
            bossAiId: bossTemplate.visual ?? 'story-boss',
            objective: 'defeat-boss',
            roundBudget: 24,
            biome: STORY_VILLAGE_BIOMES[eligibility.village] ?? 'central',
        });
        const session = buildAuthoritativeSoloEncounter({
            playerName,
            save,
            floor,
            bossTemplate,
            runId,
            seed,
            now,
            towerId: 'story-boss',
            admin: await loadAdminCombatContent(),
            hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout : undefined,
        });
        // Arm the standard-PvE difficulty layer (band + hit guard) before the
        // session is written, so the first enemy turn is already guarded.
        sealPveDifficultyBand(session, { mode: 'STORY' });
        // Give the AI its jutsu mastery — without this it casts at 30% (step C).
        // Must follow the guard above, which bounds the uplift.
        sealPveAiMastery(session, { mode: 'STORY' });
        const binding = createStoryCombatBinding({
            runId,
            playerName,
            village: eligibility.village,
            progressIndex: eligibility.progressIndex,
            now,
        });
        await writeSession(session);
        await kv.set(storyCombatBindingKey(runId), binding, { ex: STORY_COMBAT_SESSION_TTL_SECONDS });
        return res.status(200).json({ ok: true, runId, session });
    } catch (err) {
        console.error('[story/boss-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
