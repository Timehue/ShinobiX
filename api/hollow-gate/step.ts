import { loadHollowGateRunForAction } from './_pending-operation.js';
import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { hollowGateManifestNode, hollowGateMarkVisited, hollowGatePositionNodeId } from './_floor-manifest.js';
import { hollowGateCombatBindingKey, type HollowGateCombatBinding } from './_combat-session.js';
import { hollowGateEncounterRecovery } from './_encounter-recovery.js';
import { advanceHollowGateWanderers, hollowGateWandererDistance, hollowGateWandererFriendly, hollowGateWandererOrigin } from '../../shared/hollow-gate-wanderers.js';
import { hollowGateWanderersForRun } from './_wanderers.js';
import { hollowGatePhysicalBoard, hollowGateFloorFeatures } from './_floor-features.js';
import { undergroundFeatureBlocks } from '../../shared/underground-floor-collision.js';
import { HOLLOW_GATE_HUNTER_BREATHER_STEPS } from '../../shared/hollow-gate-pacing.js';

const coord = (value: unknown): number => Math.floor(Number(value));
const bounded = (x: number, y: number): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 31 && y >= 0 && y < 21;

// A step writes the run row only. It used to copy position, torch, threat and
// ward steps into the save's run projection too: a whole-save read and
// compare-and-set (twice the save's bytes) on every tile, about two thirds of
// a step's time. Nothing reads those copies. The run row is the authority, a
// reload rebuilds the board from /resume, the shrine screen never autosaves,
// and the endpoints that change the save (events, fights, consumables, settle)
// still write their own fields into the projection.

export function deriveHollowGateStepState(
    run: Pick<HollowGateRunToken, 'torch' | 'threat' | 'wardSteps' | 'stepVersion' | 'currentFloor' | 'floorDepth'> & Partial<Pick<HollowGateRunToken, 'variantId' | 'resolvedEncounterIds'>>,
    torchDrains: boolean,
    playerLevel = 20,
) {
    const torchBefore = Math.max(0, Math.min(10, Math.floor(Number(run.torch) || 0)));
    const torch = Math.max(0, torchBefore - (torchDrains ? 1 : 0));
    const wardBefore = Math.max(0, Math.floor(Number(run.wardSteps) || 0));
    const wardSteps = Math.max(0, wardBefore - 1);
    const threatBefore = Math.max(0, Math.min(100, Math.floor(Number(run.threat) || 0)));
    const threat = wardBefore > 0 ? threatBefore : Math.min(100, threatBefore + 4 * (torch === 0 ? 2 : 1));
    const stepVersion = Math.max(0, Math.floor(Number(run.stepVersion) || 0)) + 1;
    const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
    const cardAlreadyResolved = (run.resolvedEncounterIds ?? []).some((entry) => entry.includes(':card:floor:'));
    const cardAmbush = run.variantId?.startsWith('rift-') === true && playerLevel >= 20 && !cardAlreadyResolved;
    const pendingAmbush = threat >= 100 ? {
        nodeId: `floor:${floor}:ambush:threat-v${stepVersion}`,
        kind: cardAmbush ? 'card' as const : floor >= run.floorDepth ? 'boss' as const : 'ambush' as const,
    } : null;
    return { torchBefore, torch, wardSteps, threat, stepVersion, pendingAmbush };
}

/** Seal one adjacent dungeon step and derive torch/threat/ambush state. Terrain
 * remains presentation data; the run token owns every gameplay consequence. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9:_-]{8,96}$/.test(body.requestId) ? body.requestId : '';
        const from = { x: coord(body.fromX), y: coord(body.fromY) };
        const to = { x: coord(body.toX), y: coord(body.toY) };
        if (!playerName || !token || !requestId || !bounded(from.x, from.y) || !bounded(to.x, to.y)
            || Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1) {
            return res.status(400).json({ error: 'Invalid Hollow Gate step.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        // 480/min: click-to-move and held keys both walk one tile per
        // HOLLOW_GATE_STEP_MS (175ms) = ~343 steps/min, and each tile is one
        // request. The old 240 cut off any walk longer than ~40 seconds.
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-step', 480, 60_000, identity.name))) return;

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await loadHollowGateRunForAction(kv, runKey, playerName, token);
            if (!run || run.playerName !== playerName) return { status: 409, body: { error: 'The Hollow Gate run has expired.' } };
            if (!run.chosenAugmentId) return { status: 409, body: { error: 'Choose the sealed augment before moving.' } };
            const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
            if (body.floor != null && Number(body.floor) !== floor) return { status: 409, body: { error: 'The step belongs to a different shrine floor.' } };
            const manifest = run.floorManifests?.[String(floor)];
            if (hollowGateFloorFeatures(run) && body.floorFeaturesVersion !== 1) return { status: 409, body: { error: 'Reload to draw the current cavern architecture before moving.' } };
            const targetIndex = manifest ? to.y * manifest.width + to.x : -1;
            if (!manifest || to.x >= manifest.width || to.y >= manifest.height || manifest.walkable[targetIndex] !== '1' || undergroundFeatureBlocks(hollowGateFloorFeatures(run), targetIndex)) {
                return { status: 409, body: { error: 'The step does not match the sealed shrine floor.' } };
            }
            const recent = Array.isArray(run.recentStepIds) ? run.recentStepIds : [];
            if (recent.includes(requestId)) {
                return { status: 200, body: {
                    ok: true,
                    alreadyReported: true,
                    position: run.position ?? to,
                    torch: Math.max(0, Math.floor(Number(run.torch) || 0)),
                    threat: Math.max(0, Math.floor(Number(run.threat) || 0)),
                    wardSteps: Math.max(0, Math.floor(Number(run.wardSteps) || 0)),
                    stepVersion: Math.max(0, Math.floor(Number(run.stepVersion) || 0)),
                    wanderers: hollowGateWanderersForRun(run),
                    ambush: run.pendingAmbush ?? null,
                } };
            }
            if (run.activeEncounter || run.pendingAmbush) {
                const active = run.activeEncounter;
                const binding = active ? await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(active.runId)) : null;
                const recovery = hollowGateEncounterRecovery(run, binding, playerName, token);
                return { status: 409, body: {
                    error: 'Resolve the sealed encounter before moving.',
                    position: run.position,
                    ...recovery,
                } };
            }
            if (!run.position || run.position.x !== from.x || run.position.y !== from.y) {
                return { status: 409, body: { error: 'The step origin is stale.', position: run.position } };
            }
            const currentNodeId = hollowGatePositionNodeId(manifest, run.position);
            const currentKind = hollowGateManifestNode(manifest, currentNodeId);
            const roster = hollowGateWanderersForRun(run);
            if (!hollowGateWandererOrigin(roster, run.position.y * manifest.width + run.position.x) && (currentKind === 'battle' || currentKind === 'elite' || currentKind === 'boss' || currentKind === 'pet_battle')) {
                const expectedKind = currentKind === 'pet_battle' ? 'beast' : currentKind;
                const encounterKey = `${floor}:${expectedKind}:${currentNodeId}`;
                const resolved = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
                // A fight left alive (escape, Second Wind, pet defeat) keeps its
                // tile unresolved but must not pin the player to it forever.
                const withdrawn = Array.isArray(run.withdrawnEncounterIds) ? run.withdrawnEncounterIds : [];
                if (!resolved.includes(encounterKey) && !withdrawn.includes(encounterKey)) {
                    // Name the encounter so the browser can open it. A fight whose
                    // start failed (a dropped request, a tile chunk that did not
                    // load) left the player on this tile with nothing to trigger
                    // it again, because a tile fires only when it is stepped onto.
                    return { status: 409, body: {
                        error: 'Resolve the sealed combat node before moving.',
                        position: run.position,
                        sealedCombat: { nodeId: currentNodeId, kind: expectedKind },
                    } };
                }
            }
            const torchDrains = randomInt(0, 5) === 0;
            let derived = deriveHollowGateStepState(run, torchDrains);
            // Only load the character save when this step would otherwise open
            // a Rift card ambush. Normal movement keeps its existing KV cost.
            if (derived.pendingAmbush?.kind === 'card') {
                const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
                const rawLevel = save?.character?.level;
                const playerLevel = rawLevel == null ? 20 : Math.max(1, Math.floor(Number(rawLevel) || 1));
                if (playerLevel < 20) derived = deriveHollowGateStepState(run, torchDrains, playerLevel);
            }
            const { torchBefore, torch, wardSteps, threat, stepVersion } = derived;
            const wanderers = roster ? advanceHollowGateWanderers(hollowGatePhysicalBoard(run, manifest), roster, to, stepVersion, run.withdrawnEncounterIds) : undefined;
            const targetKind = manifest.nodes[String(targetIndex)];
            const breather = Math.max(0, Math.min(HOLLOW_GATE_HUNTER_BREATHER_STEPS, Math.floor(Number(run.hunterBreatherSteps) || 0)));
            const nearMedic = wanderers?.some(npc => npc.role === 'medic' && !npc.spent
                && hollowGateWandererDistance(npc.tile, targetIndex, manifest.width) <= 1) === true;
            // Authored tile interactions have priority over hunter contact.
            const hunter = breather === 0 && !nearMedic && (!targetKind || hollowGateWandererOrigin(roster, targetIndex))
                ? wanderers?.find(npc => !npc.spent && !hollowGateWandererFriendly(npc)
                    && hollowGateWandererDistance(npc.tile, targetIndex, manifest.width) <= 1
                    && (!(run.withdrawnEncounterIds ?? []).includes(`${floor}:battle:${npc.nodeId}`) || npc.tile === targetIndex)) : undefined;
            const pendingAmbush = derived.pendingAmbush ?? (hunter ? { nodeId: hunter.nodeId, kind: 'battle' as const } : null);
            const next: HollowGateRunToken = {
                ...run,
                position: to,
                torch,
                threat,
                wardSteps,
                stepVersion,
                recentStepIds: [...recent, requestId].slice(-64),
                pendingAmbush,
                ...(run.hunterBreatherSteps !== undefined ? { hunterBreatherSteps: Math.max(0, breather - 1) } : {}),
                ...(wanderers ? { wanderers: { ...run.wanderers, [String(floor)]: wanderers } } : {}),
                visitedTiles: hollowGateMarkVisited(run.visitedTiles, manifest, to),
            };
            await kv.set(runKey, next);
            return { status: 200, body: {
                ok: true,
                position: to,
                torch,
                threat,
                wardSteps,
                stepVersion,
                torchSputtered: torch === 0 && torchBefore > 0,
                ambush: pendingAmbush,
                wanderers,
            } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/step]', error);
        return res.status(500).json({ error: 'The Hollow Gate step could not be sealed.' });
    }
}
