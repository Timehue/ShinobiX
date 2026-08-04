import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { combatMissionByKey } from './_mission-catalog.js';
import { canPlayerReceiveMission, missionEligibilityFailureBody } from './_eligibility.js';
import {
    createMissionCombatBinding,
    missionCombatBindingKey,
    MISSION_COMBAT_SESSION_TTL_SECONDS,
} from './_authoritative-combat-session.js';
import { missionEnemyTemplate, missionEnvironment } from '../_authoritative-pve.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { writeSoloPveSession } from '../solo-pve/_store.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';

/** Start a sealed, server-resolved combat mission. Body: { playerName, missionId }. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const missionId = String(body.missionId ?? '').slice(0, 80);
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!enforceRateLimit(req, res, 'mission-combat-start', 12, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only start your own mission.' });

        const mission = combatMissionByKey(missionId);
        if (!mission) return res.status(404).json({ error: 'Unknown combat mission.' });
        const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
        const char = save?.character as Record<string, unknown> | undefined;
        if (!save || !char) return res.status(404).json({ error: 'Player save not found.' });
        const eligibility = canPlayerReceiveMission(char, mission);
        if (!eligibility.ok) return res.status(403).json(missionEligibilityFailureBody(eligibility));

        const runId = `mission-${randomUUID().replace(/-/g, '')}`;
        const now = Date.now();
        // Themed battlefield: biome drives the board art + the +10% school terrain
        // buff; the optional weather adds the ±element damage term. Both sealed here.
        const env = missionEnvironment(mission.key);
        const enemy = missionEnemyTemplate(mission);
        const session = buildSoloPveAiEncounter({
            sessionId: runId,
            playerName,
            save,
            profile: { ...enemy, id: mission.aiProfileId },
            now,
            admin: await loadAdminCombatContent(),
            difficultyMode: 'MISSION',
            encounter: { kind: 'mission', id: mission.key, sourceId: mission.aiProfileId, bindingId: runId },
            environment: {
                biome: env.biome,
                weatherPositiveElement: env.weather?.positiveElement,
                weatherNegativeElement: env.weather?.negativeElement,
            },
        });
        // Seal the weather (if any) so the engine's wMult junction reads it; absent
        // for clear-weather missions, so those fights stay at the neutral ×1 term.
        // Seal the player's ACTIVE pet so it can be summoned onto the field once
        // (the 'summon' action). Server-sealed from the save — the client never
        // supplies the pet's HP/damage, and the seal is consumed on use.
        // Arm the standard-PvE difficulty layer (band + hit guard). Sealed BEFORE
        // the session is written, so the very first enemy turn is already guarded.
        // Give the AI its jutsu mastery — without this it casts at 30% (step C).
        // Must follow the guard above, which bounds the uplift.
        const binding = createMissionCombatBinding({ runId, playerName, mission, now, sessionId: runId });
        await writeSoloPveSession(session);
        await kv.set(missionCombatBindingKey(runId), binding, { ex: MISSION_COMBAT_SESSION_TTL_SECONDS });
        return res.status(200).json({ ok: true, runId, session });
    } catch (err) {
        console.error('[missions/combat-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
