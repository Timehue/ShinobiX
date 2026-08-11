import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { readSoloPveSession, soloPveSessionKey, writeSoloPveSession } from '../solo-pve/_store.js';
import { hollowGateRunKey, HOLLOW_GATE_RUN_EXPIRED_MESSAGES, type HollowGateRunToken } from './_run-token.js';
import {
    createHollowGateCombatBinding,
    hollowGateCombatBindingKey,
    hollowGateEncounterKey,
    HOLLOW_GATE_COMBAT_TTL_SECONDS,
    HOLLOW_GATE_MAX_COMBATS_PER_FLOOR,
    isHollowGateCombatKind,
    normalizeHollowGateNodeId,
} from './_combat-session.js';
import { buildHollowGateSoloPveEncounter } from './_encounter.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import { hollowGateManifestNode, hollowGatePositionNodeId } from './_floor-manifest.js';

type StartOutcome =
    | { status: number; body: Record<string, unknown> }
    | null;

/** Start or resume one run-bound Hollow Gate shinobi encounter. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const floor = Math.floor(Number(body.floor));
        const kind = body.kind;
        const combatMode = body.mode === 'pet' ? 'pet' : 'solo-pve';
        const nodeId = normalizeHollowGateNodeId(body.nodeId);
        if (!playerName || !token || !nodeId || !Number.isFinite(floor) || !isHollowGateCombatKind(kind)) {
            return res.status(400).json({ error: 'Invalid Hollow Gate encounter.' });
        }
        if (!nodeId.startsWith(`floor:${floor}:`)) return res.status(400).json({ error: 'Encounter node/floor mismatch.' });
        if (!enforceRateLimit(req, res, 'hollow-gate-combat-start', 20, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && combatMode === 'solo-pve' && await findTowerBattleStartConflict([playerName])) {
            return res.status(409).json(towerBattleActiveErrorBody());
        }

        const runKey = hollowGateRunKey(playerName, token);
        const outcome = await withKvLock<StartOutcome>(runKey, async () => {
            const run = await kv.get<HollowGateRunToken>(runKey);
            if (!run) return { status: 409, body: { error: HOLLOW_GATE_RUN_EXPIRED_MESSAGES.combatStart } };
            if (run.playerName !== playerName) return { status: 403, body: { error: 'Not your run.' } };
            if (!run.chosenAugmentId) return { status: 409, body: { error: 'Choose the sealed augment before entering combat.' } };
            // One-time migration for runs minted before currentFloor was sealed:
            // adopt the client's already-saved floor, then persist it below.
            const currentFloor = run.currentFloor == null
                ? Math.max(1, Math.min(run.floorDepth, floor))
                : Math.max(1, Math.floor(Number(run.currentFloor) || 1));
            if (floor !== currentFloor || floor > run.floorDepth) return { status: 409, body: { error: 'The encounter floor does not match the sealed run progress.' } };
            if (kind === 'boss' && floor !== run.floorDepth) {
                return { status: 409, body: { error: 'The floor boss is not available before the sealed final floor.' } };
            }

            if (run.activeEncounter) {
                const active = run.activeEncounter;
                const activeBinding = await kv.get<ReturnType<typeof createHollowGateCombatBinding>>(hollowGateCombatBindingKey(active.runId));
                const sameEncounter = active.floor === floor && active.nodeId === nodeId && active.kind === kind;
                if (sameEncounter && activeBinding?.combatMode === combatMode && activeBinding.status === 'active') {
                    const activeSession = combatMode === 'solo-pve' ? await readSoloPveSession(active.runId) : null;
                    if (combatMode === 'solo-pve' && !activeSession) {
                        return { status: 409, body: { error: 'The active Hollow Gate combat session expired.' } };
                    }
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            resumed: true,
                            runId: active.runId,
                            combatMode,
                            ...(activeSession ? { session: activeSession } : {}),
                        },
                    };
                }
                if (activeBinding?.status === 'active') {
                    return { status: 409, body: { error: 'Finish the active Hollow Gate encounter before moving.' } };
                }
                run.activeEncounter = null;
            }

            const resolved = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
            const encounterKey = hollowGateEncounterKey(floor, kind, nodeId);
            if (resolved.includes(encounterKey)) return { status: 409, body: { error: 'That encounter was already resolved.' } };
            if (kind === 'boss' && resolved.some((entry) => entry.startsWith(`${floor}:boss:`))) {
                return { status: 409, body: { error: 'The floor boss was already resolved.' } };
            }
            if (resolved.filter((entry) => entry.startsWith(`${floor}:`)).length >= HOLLOW_GATE_MAX_COMBATS_PER_FLOOR) {
                return { status: 429, body: { error: 'The sealed floor encounter limit was reached.' } };
            }

            const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
            const char = save?.character as Record<string, unknown> | undefined;
            if (!save || !char) return { status: 404, body: { error: 'Player save not found.' } };
            if (char.hospitalized === true || Number(char.hp ?? 0) <= 0) {
                return { status: 409, body: { error: 'You cannot enter combat while hospitalized.' } };
            }

            const savedRun = char.hollowGateRun && typeof char.hollowGateRun === 'object'
                ? char.hollowGateRun as Record<string, unknown>
                : null;
            if (!savedRun || savedRun.runToken !== token || savedRun.serverSeed !== run.seed || Math.floor(Number(savedRun.floor)) !== currentFloor) {
                return { status: 409, body: { error: 'The saved shrine floor does not match the sealed run.' } };
            }
            if (nodeId.includes(':tile:')) {
                const expectedTileKind = kind === 'beast' ? 'pet_battle' : kind;
                const manifest = run.floorManifests?.[String(currentFloor)];
                if (hollowGatePositionNodeId(manifest, run.position) !== nodeId
                    || hollowGateManifestNode(manifest, nodeId) !== expectedTileKind) {
                    return { status: 409, body: { error: 'The encounter node does not match the sealed shrine floor.' } };
                }
            } else if (!run.pendingAmbush || run.pendingAmbush.nodeId !== nodeId || run.pendingAmbush.kind !== kind) {
                return { status: 409, body: { error: 'Only the server-sealed threat encounter may use a non-tile identity.' } };
            }
            const binding = createHollowGateCombatBinding({
                playerName,
                token,
                floor,
                nodeId,
                kind,
                combatMode,
                secondWindArmed: run.secondWindArmed === true && savedRun?.runToken === token,
            });

            try {
                const session = combatMode === 'solo-pve'
                    ? buildHollowGateSoloPveEncounter({ binding, run, save, now: binding.createdAt, admin: await loadAdminCombatContent() })
                    : null;
                if (session) await writeSoloPveSession(session);
                await kv.set(hollowGateCombatBindingKey(binding.runId), binding, { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS });
                await kv.set(runKey, { ...run, currentFloor, pendingAmbush: null, activeEncounter: {
                    runId: binding.runId,
                    nodeId: binding.nodeId,
                    floor: binding.floor,
                    kind: binding.kind,
                    enemyProfileId: binding.enemyProfileId,
                    createdAt: binding.createdAt,
                } });
            } catch (error) {
                await kv.del(hollowGateCombatBindingKey(binding.runId), soloPveSessionKey(binding.runId)).catch(() => undefined);
                throw error;
            }
            const session = combatMode === 'solo-pve' ? await readSoloPveSession(binding.runId) : null;
            return { status: 200, body: { ok: true, runId: binding.runId, combatMode, ...(session ? { session } : {}) } };
        }, { failClosed: true, ttlSec: 10 });

        if (!outcome) return res.status(503).json({ error: 'The Hollow Gate is busy. Retry shortly.' });
        if (outcome.status === 200) {
            await recordBetaMetric({
                event: outcome.body.resumed === true ? 'hollow_gate.combat_resumed' : 'hollow_gate.combat_started',
                playerName,
                source: `${combatMode}:floor-${floor}:${String(kind)}`,
            });
        }
        return res.status(outcome.status).json(outcome.body);
    } catch (err) {
        console.error('[hollow-gate/combat-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
