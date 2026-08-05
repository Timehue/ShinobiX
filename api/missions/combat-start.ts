import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { combatMissionByKey } from './_mission-catalog.js';
import { canPlayerReceiveMission, missionEligibilityFailureBody } from './_eligibility.js';
import {
    createMissionCombatActivePointer,
    createMissionCombatBinding,
    missionCombatActiveKey,
    missionCombatBindingKey,
    MISSION_COMBAT_SESSION_TTL_SECONDS,
    resumableMissionCombatSession,
    type MissionCombatActivePointer,
    type MissionCombatBinding,
} from './_authoritative-combat-session.js';
import { missionEnemyTemplate, missionEnvironment } from '../_authoritative-pve.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { readSoloPveSession, soloPveSessionKey, writeSoloPveSession } from '../solo-pve/_store.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { captureServerProductEvent } from '../_product-analytics.js';

/** Start or recover a sealed, server-resolved combat mission. Body: { playerName, missionId }. */
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

        const admin = await loadAdminCombatContent();
        const activeKey = missionCombatActiveKey(playerName, mission.key);
        const started = await withKvLock(activeKey, async () => {
            const active = await kv.get<MissionCombatActivePointer>(activeKey);
            if (active?.runId) {
                const [binding, session] = await Promise.all([
                    kv.get<MissionCombatBinding>(missionCombatBindingKey(active.runId)),
                    readSoloPveSession(active.sessionId),
                ]);
                const resumed = resumableMissionCombatSession({ active, binding, session, playerName, mission });
                if (resumed) return { ok: true as const, runId: active.runId, session: resumed, resumed: true };
            }

            const runId = `mission-${randomUUID().replace(/-/g, '')}`;
            const now = Date.now();
            const env = missionEnvironment(mission.key);
            const enemy = missionEnemyTemplate(mission);
            const session = buildSoloPveAiEncounter({
                sessionId: runId,
                playerName,
                save,
                profile: { ...enemy, id: mission.aiProfileId },
                now,
                admin,
                difficultyMode: 'MISSION',
                encounter: { kind: 'mission', id: mission.key, sourceId: mission.aiProfileId, bindingId: runId },
                environment: {
                    biome: env.biome,
                    weatherPositiveElement: env.weather?.positiveElement,
                    weatherNegativeElement: env.weather?.negativeElement,
                },
            });
            const binding = createMissionCombatBinding({ runId, playerName, mission, now, sessionId: runId });
            const pointer = createMissionCombatActivePointer({ runId, playerName, mission, now, sessionId: runId });
            try {
                // The pointer is written last: only a complete durable triplet can
                // be recovered after a refresh, concurrent start, or lost response.
                await writeSoloPveSession(session);
                await kv.set(missionCombatBindingKey(runId), binding, { ex: MISSION_COMBAT_SESSION_TTL_SECONDS });
                await kv.set(activeKey, pointer, { ex: MISSION_COMBAT_SESSION_TTL_SECONDS });
            } catch (error) {
                await kv.del(activeKey, missionCombatBindingKey(runId), soloPveSessionKey(runId)).catch(() => undefined);
                throw error;
            }
            return { ok: true as const, runId, session, resumed: false };
        }, { failClosed: true, ttlSec: 10 });
        if (!started.resumed) {
            const level = Number(char.level ?? 0);
            captureServerProductEvent('mission_started', {
                mode: 'combat',
                contentId: mission.key,
                levelBand: level < 10 ? 'L1-9' : level < 20 ? 'L10-19' : level < 40 ? 'L20-39' : level < 80 ? 'L40-79' : 'L80-100',
            });
        }
        return res.status(200).json(started);
    } catch (err) {
        console.error('[missions/combat-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
