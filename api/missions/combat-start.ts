import { randomInt, randomUUID } from 'node:crypto';
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
import {
    buildAuthoritativeSoloEncounter,
    dynamicBossFloor,
    missionEnemyTemplate,
} from '../_authoritative-pve.js';
import { writeSession } from '../towers/_tower-store.js';

/** Start a sealed, server-resolved combat mission. Body: { playerName, missionId, hostLoadout? }. */
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
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = save?.character as Record<string, unknown> | undefined;
        if (!save || !char) return res.status(404).json({ error: 'Player save not found.' });
        const eligibility = canPlayerReceiveMission(char, mission);
        if (!eligibility.ok) return res.status(403).json(missionEligibilityFailureBody(eligibility));

        const runId = `mission-${randomUUID().replace(/-/g, '')}`;
        const seed = identity.admin ? 12345 : randomInt(1, 0x7fffffff);
        const now = Date.now();
        const floor = dynamicBossFloor({
            id: 9_100 + Math.max(0, ['combat-e-drill', 'combat-d-errand', 'combat-c-patrol', 'combat-b-escort', 'combat-a-hunt', 'combat-s-crisis'].indexOf(mission.key)),
            name: mission.key,
            bossAiId: mission.aiProfileId,
            objective: 'defeat-boss',
            roundBudget: 24,
        });
        const session = buildAuthoritativeSoloEncounter({
            playerName,
            save,
            floor,
            bossTemplate: missionEnemyTemplate(mission),
            runId,
            seed,
            now,
            towerId: 'combat-mission',
            hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout : undefined,
        });
        const binding = createMissionCombatBinding({ runId, playerName, mission, now, sessionId: runId });
        await writeSession(session);
        await kv.set(missionCombatBindingKey(runId), binding, { ex: MISSION_COMBAT_SESSION_TTL_SECONDS });
        return res.status(200).json({ ok: true, runId, session });
    } catch (err) {
        console.error('[missions/combat-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
