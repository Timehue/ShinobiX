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
import { storyCombatBindingKey, STORY_COMBAT_SESSION_TTL_SECONDS } from './_authoritative-story-combat.js';
import {
    ACADEMY_SPAR_OPPONENT_ID,
    academySparEligibility,
    academySparEnemyTemplate,
    academySparRunId,
    createAcademySparBinding,
} from './_academy-spar.js';

/**
 * Start the sealed onboarding sparring match. Body: { playerName, hostLoadout? }.
 * Everything about the opponent is server-owned (api/story/_academy-spar.ts) —
 * the request carries no level, no stats and no opponent id, because the client
 * choosing any of those is the authority this migration removes.
 * Mirrors api/story/boss-start.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!enforceRateLimit(req, res, 'story-spar-start', 12, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only start your own sparring match.' });

        const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
        const char = save?.character as Record<string, unknown> | undefined;
        if (!save || !char) return res.status(404).json({ error: 'Player save not found.' });
        // Gate the START on what the SETTLE will demand, so a sealed spar is
        // always one the player can actually be paid for.
        const eligibility = academySparEligibility(char);
        if (!eligibility.ok) return res.status(eligibility.status).json({ error: eligibility.error });

        const runId = academySparRunId();
        const seed = identity.admin ? 12345 : randomInt(1, 0x7fffffff);
        const now = Date.now();
        const admin = await loadAdminCombatContent();
        const floor = dynamicBossFloor({
            id: 9_250,
            name: 'academy-spar',
            bossAiId: ACADEMY_SPAR_OPPONENT_ID,
            objective: 'defeat-boss',
            roundBudget: 24,
            // Neutral ground: a village biome would hand the player the +10%
            // school buff, and the tutorial should teach the plain fight.
            biome: 'central',
        });
        const session = buildAuthoritativeSoloEncounter({
            playerName,
            save,
            floor,
            bossTemplate: academySparEnemyTemplate(admin),
            runId,
            seed,
            now,
            towerId: 'academy-spar',
            admin,
            hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout : undefined,
        });
        // Same two difficulty seals every other server PvE mode carries, in the
        // same order: the guard bounds the hit, then mastery lifts the cast off
        // the 30% floor. On a level-1 peer band both are near no-ops — they are
        // here so the spar cannot drift away from the shared PvE contract.
        sealPveDifficultyBand(session, { mode: 'STORY' });
        sealPveAiMastery(session, { mode: 'STORY' });
        await writeSession(session);
        await kv.set(
            storyCombatBindingKey(runId),
            createAcademySparBinding({ runId, playerName, now }),
            { ex: STORY_COMBAT_SESSION_TTL_SECONDS },
        );
        return res.status(200).json({ ok: true, runId, session });
    } catch (err) {
        console.error('[story/spar-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
