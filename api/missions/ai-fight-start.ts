import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomInt, randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { serverAiCombatEnabled } from '../_release-flags.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { writeSession } from '../towers/_tower-store.js';
import { buildAiFightEncounter, loadAiFightProfile } from './_ai-fight-encounter.js';
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
 * With ENABLE_SERVER_AI_COMBAT=1 it ALSO seals a real server-resolved encounter
 * for the fight (step 2 of docs/runbooks/combat-mode-migration.md) and returns
 * its `runId`, so a flagged client can play the fight on the tower engine
 * instead of the local Arena engine. The flag is OFF by default and the token
 * is minted either way: sealing the encounter is purely ADDITIVE, and a failure
 * to seal one degrades to today's behavior rather than failing the fight.
 */

/**
 * Build + persist the sealed encounter for this fight, returning its runId.
 *
 * Returns undefined on ANY failure (unknown opponent, missing save, storage
 * error). That is deliberate: while the client half is unbuilt, the encounter
 * is an unused extra, and a sealing problem must never block a player from
 * starting a fight they can already start today. Once step 3 routes the client
 * onto this path, a missing runId means "play it locally", which is the same
 * fallback the flag itself provides.
 */
async function sealAiFightEncounter(
    playerName: string,
    body: Record<string, unknown>,
    rawSave: Record<string, unknown>,
): Promise<string | undefined> {
    try {
        const profile = await loadAiFightProfile(body.opponentId);
        if (!profile) return undefined;
        // Same augmentation combat-start applies, so a forged weapon resolves to
        // its real definition instead of being dropped from the sealed loadout.
        const save = await augmentSaveWithForgedDefs(rawSave);
        if (!save?.character) return undefined;
        const runId = `aifight-${randomUUID().replace(/-/g, '')}`;
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
        const session = buildAiFightEncounter({
            playerName,
            save,
            profile,
            runId,
            seed: randomInt(1, 0x7fffffff),
            now: Date.now(),
            ...(scaling ? { scaling } : {}),
            admin: await loadAdminCombatContent(),
            hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object'
                ? body.hostLoadout as Record<string, unknown>
                : undefined,
        });
        await writeSession(session);
        return runId;
    } catch (err) {
        console.error('[missions/ai-fight-start] seal failed', safeLogValue(err));
        return undefined;
    }
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

        // Seal the server-side encounter BEFORE minting the token so the token
        // can carry its runId (one token = one battle lifecycle). Best-effort:
        // an unknown opponent or any sealing failure leaves runId undefined and
        // the fight runs the existing client path, unchanged.
        const runId = serverAiCombatEnabled()
            ? await sealAiFightEncounter(playerName, body, save)
            : undefined;

        const token = randomUUID().replace(/-/g, '');
        const record = createAiFightTokenRecord(playerName, token, Date.now(), {
            opponentId: body.opponentId,
            opponentLevel: body.opponentLevel,
            baseXp: reward.xp,
            baseRyo: reward.ryo,
            battleKind: body.battleKind,
            runId,
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
            ...(record.runId ? { runId: record.runId } : {}),
        });
    } catch (err) {
        console.error('[missions/ai-fight-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
