import { recoverHollowGatePendingOperation } from './_pending-operation.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { storedValueEquals } from '../_stored-value.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { hollowGateMarkVisited, validateHollowGateFloorManifest } from './_floor-manifest.js';
import { hollowGateCombatBindingKey, type HollowGateCombatBinding } from './_combat-session.js';
import { hollowGateEncounterRecovery } from './_encounter-recovery.js';
import { createHollowGateWanderers } from '../../shared/hollow-gate-wanderers.js';
import { hollowGateWanderersForRun } from './_wanderers.js';
import { deriveHollowGateFloorFeatures, hollowGateFloorFeatures, hollowGatePhysicalBoard } from './_floor-features.js';

/** Validate a generated floor once and seal its gameplay-relevant manifest into
 * the run token. Later endpoints never trust mutable saved tiles. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        if (!playerName || !token) return res.status(400).json({ error: 'Invalid Hollow Gate floor seal.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-floor-seal', 15, 60_000, identity.name))) return;

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await recoverHollowGatePendingOperation(kv, runKey, await kv.get<HollowGateRunToken>(runKey), playerName, token);
            if (!run || run.playerName !== playerName) return { status: 409, body: { error: 'The Hollow Gate run has expired.' } };
            if (run.activeEncounter) {
                const active = run.activeEncounter;
                const binding = await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(active.runId));
                return { status: 409, body: {
                    error: 'Finish the active encounter first.',
                    position: run.position,
                    ...hollowGateEncounterRecovery(run, binding, playerName, token),
                } };
            }
            const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
            if (Number(body.floor) !== floor) return { status: 409, body: { error: 'The floor does not match the sealed run.' } };
            if ((run.floorWidth != null && Number(body.width) !== run.floorWidth)
                || (run.floorHeight != null && Number(body.height) !== run.floorHeight)) {
                return { status: 409, body: { error: 'The floor shape does not match the sealed run.' } };
            }
            const manifests = run.floorManifests ?? {};
            const existing = manifests[String(floor)];
            const validation = validateHollowGateFloorManifest({
                floor,
                finalFloor: floor >= run.floorDepth,
                width: body.width,
                height: body.height,
                // A saved run resumes at its current position. Once a floor is
                // sealed, reuse its immutable spawn while comparing the map.
                playerX: existing?.spawn.x ?? body.playerX,
                playerY: existing?.spawn.y ?? body.playerY,
                tiles: body.tiles,
                // Preserve pre-feature immutable manifests byte-for-byte when a
                // player resumes an older run. New floors derive their markers
                // once; newer manifests recompute them to verify exact equality.
                deriveDetour: !existing || Boolean(existing.detour),
                riftDistortionId: !existing || existing.riftSignal ? run.riftDistortionId : undefined,
            });
            if (!validation.ok) return { status: 409, body: { error: `Invalid Hollow Gate floor: ${validation.reason}.` } };
            if (existing && !storedValueEquals(existing, validation.manifest)) {
                return { status: 409, body: { error: 'The floor manifest is already sealed.' } };
            }
            if (body.floorFeaturesVersion === 1 && !run.floorFeatures?.[String(floor)]) {
                const protectedTiles = [run.position ? run.position.y * validation.manifest.width + run.position.x : -1,
                    ...(run.wanderers?.[String(floor)]?.map(n => n.tile) ?? [])];
                run.floorFeatures = { ...run.floorFeatures, [String(floor)]: deriveHollowGateFloorFeatures(validation.manifest, body.tiles, protectedTiles) };
                if (existing) await kv.set(runKey, run);
            }
            // Explicit client-version opt-in keeps an older browser from
            // gaining invisible hunters during a rolling release.
            if (body.wanderersVersion === 1 && !run.wanderers?.[String(floor)]) {
                const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
                run.wanderers = { ...run.wanderers, [String(floor)]: createHollowGateWanderers(hollowGatePhysicalBoard(run, validation.manifest), run.seed, save?.character?.village) };
                if (existing) await kv.set(runKey, run);
            }
            if (existing) {
                // `existing` is read back from jsonb, which reorders object keys,
                // so compare values rather than JSON text.
                return { status: 200, body: { ok: true, alreadyReported: true, manifest: existing, detour: existing.detour ?? null, riftSignal: existing.riftSignal ?? null, position: run.position, pendingAmbush: run.pendingAmbush ?? null, wanderers: hollowGateWanderersForRun(run), floorFeatures: hollowGateFloorFeatures(run) } };
            }
            const next: HollowGateRunToken = {
                ...run,
                floorManifests: { ...manifests, [String(floor)]: validation.manifest },
                position: validation.manifest.spawn,
                visitedTiles: hollowGateMarkVisited(run.visitedTiles, validation.manifest, validation.manifest.spawn),
            };
            await kv.set(runKey, next);
            return { status: 200, body: { ok: true, manifest: validation.manifest, detour: validation.manifest.detour ?? null, riftSignal: validation.manifest.riftSignal ?? null, position: next.position, pendingAmbush: next.pendingAmbush ?? null, wanderers: hollowGateWanderersForRun(next), floorFeatures: hollowGateFloorFeatures(next) } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/floor-seal]', error);
        return res.status(500).json({ error: 'The Hollow Gate floor could not be sealed.' });
    }
}
