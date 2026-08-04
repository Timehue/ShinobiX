import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { loadAiFightProfile } from './_ai-fight-encounter.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { writeSoloPveSession } from '../solo-pve/_store.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { resolveAiFightScaling } from './_ai-fight-scaling.js';
import {
    AI_FIGHT_TOKEN_TTL_SECONDS,
    aiFightTokenKey,
    computeAiFightBaseReward,
    createAiFightTokenRecord,
} from './_ai-fight-token.js';

/*
 * /api/missions/ai-fight-start - POST only
 *
 * Mints a single-use token for one AI-fight reward report. The report endpoint
 * consumes this token and only accepts XP/ryo claims within the sealed ceilings,
 * so a direct client report can no longer mint arbitrary rewards.
 *
 * It ALSO seals a real server-resolved encounter for the fight (step 2 of
 * docs/runbooks/combat-mode-migration.md) and returns its mandatory standalone
 * solo-PvE session. The token is minted only after that authority is persisted.
 */

/**
 * Build and persist the mandatory standalone encounter for this fight.
 *
 * The session is returned because the client's server-combat screen
 * (`MissionArenaFight`) takes `initialSession` as a required prop. The sealed
 * session carries combat fields but no art,
 * so this adds no image payload.
 *
 * Unknown opponents are rejected; persistence failures propagate to the route's
 * fail-closed error response. No client-resolved combat path exists here.
 */
async function sealAiFightEncounter(
    playerName: string,
    body: Record<string, unknown>,
    rawSave: Record<string, unknown>,
): Promise<{ sessionId: string; session: SoloPveSession } | null> {
        const profile = await loadAiFightProfile(body.opponentId);
        if (!profile) return null;
        // Same augmentation combat-start applies, so a forged weapon resolves to
        // its real definition instead of being dropped from the sealed loadout.
        const save = await augmentSaveWithForgedDefs(rawSave);
        if (!save?.character) throw new Error('Authoritative player save is unavailable.');
        const sessionId = `aifight-${randomUUID().replace(/-/g, '')}`;
        // Step 3c: scaling from SERVER state. `body.opponentLevel` is never read
        // for the encounter — a client-chosen level is a client-chosen
        // difficulty. Combat missions are the only entry point that re-levels
        // its opponent (see _ai-fight-scaling.ts); everything else resolves to
        // undefined and is built at its authored level, matching the client.
        const scaling = resolveAiFightScaling({
            opponentId: body.opponentId,
            battleKind: body.battleKind,
            playerLevel: (save.character as Record<string, unknown> | undefined)?.level,
        });
        const session = buildSoloPveAiEncounter({
            playerName,
            save,
            profile,
            sessionId,
            now: Date.now(),
            ...(scaling ? { scaling } : {}),
            admin: await loadAdminCombatContent(),
        });
        await writeSoloPveSession(session);
        return { sessionId, session };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own AI fights.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'ai-fight-start', 30, 60_000, identity.name))) return;

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = (save?.character ?? null) as Record<string, unknown> | null;
        if (!save || !character) return res.status(404).json({ error: 'Player save not found.' });
        const reward = computeAiFightBaseReward(character);

        // Persist combat authority before minting its one-battle reward token.
        const sealed = await sealAiFightEncounter(playerName, body, save);
        if (!sealed) return res.status(404).json({ error: 'AI opponent is not published on the server.' });

        const token = randomUUID().replace(/-/g, '');
        const record = createAiFightTokenRecord(playerName, token, Date.now(), {
            opponentId: body.opponentId,
            opponentLevel: body.opponentLevel,
            baseXp: reward.xp,
            baseRyo: reward.ryo,
            battleKind: body.battleKind,
            sessionRuntime: 'solo-pve',
            sessionId: sealed.sessionId,
        });
        await kv.set(aiFightTokenKey(playerName, token), record, { ex: AI_FIGHT_TOKEN_TTL_SECONDS });

        return res.status(200).json({
            ok: true,
            token,
            expiresInSeconds: AI_FIGHT_TOKEN_TTL_SECONDS,
            maxXp: record.maxXp,
            maxRyo: record.maxRyo,
            baseXp: record.baseXp,
            baseRyo: record.baseRyo,
            trait: reward.trait,
            // The client mounts only from this complete authority response.
            sessionId: sealed.sessionId,
            session: sealed.session,
        });
    } catch (err) {
        console.error('[missions/ai-fight-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
