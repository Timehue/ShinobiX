import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { hollowGateManifestNode, hollowGatePositionNodeId } from './_floor-manifest.js';

const coord = (value: unknown): number => Math.floor(Number(value));
const bounded = (x: number, y: number): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 31 && y >= 0 && y < 21;

async function persistRunProjection(playerName: string, token: string, run: HollowGateRunToken): Promise<number> {
    return withKvLock(`save:${playerName}`, async () => {
        const fresh = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const freshCharacter = fresh?.character as Record<string, unknown> | undefined;
        const freshRun = freshCharacter?.hollowGateRun && typeof freshCharacter.hollowGateRun === 'object'
            ? freshCharacter.hollowGateRun as Record<string, unknown>
            : null;
        if (!fresh || !freshCharacter || !freshRun || freshRun.runToken !== token || !run.position) {
            throw new Error('The saved run changed during movement.');
        }
        const updated = bumpSaveVersion({
            ...fresh,
            character: {
                ...freshCharacter,
                hollowGateRun: {
                    ...freshRun,
                    playerX: run.position.x,
                    playerY: run.position.y,
                    torch: run.torch,
                    threat: run.threat,
                    wardSteps: run.wardSteps,
                },
            },
        }) as Record<string, unknown>;
        await kv.set(`save:${playerName}`, mergePreservingImages(updated, fresh));
        return Number(updated._saveVersion ?? 0);
    }, { failClosed: true, ttlSec: 10 });
}

export function deriveHollowGateStepState(
    run: Pick<HollowGateRunToken, 'torch' | 'threat' | 'wardSteps' | 'stepVersion' | 'currentFloor' | 'floorDepth'>,
    torchDrains: boolean,
) {
    const torchBefore = Math.max(0, Math.min(10, Math.floor(Number(run.torch) || 0)));
    const torch = Math.max(0, torchBefore - (torchDrains ? 1 : 0));
    const wardBefore = Math.max(0, Math.floor(Number(run.wardSteps) || 0));
    const wardSteps = Math.max(0, wardBefore - 1);
    const threatBefore = Math.max(0, Math.min(100, Math.floor(Number(run.threat) || 0)));
    const threat = wardBefore > 0 ? threatBefore : Math.min(100, threatBefore + 4 * (torch === 0 ? 2 : 1));
    const stepVersion = Math.max(0, Math.floor(Number(run.stepVersion) || 0)) + 1;
    const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
    const pendingAmbush = threat >= 100 ? {
        nodeId: `floor:${floor}:ambush:threat-v${stepVersion}`,
        kind: floor >= run.floorDepth ? 'boss' as const : 'ambush' as const,
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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-step', 240, 60_000, identity.name))) return;

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await kv.get<HollowGateRunToken>(runKey);
            if (!run || run.playerName !== playerName) return { status: 409, body: { error: 'The Hollow Gate run has expired.' } };
            if (!run.chosenAugmentId) return { status: 409, body: { error: 'Choose the sealed augment before moving.' } };
            const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
            const manifest = run.floorManifests?.[String(floor)];
            const targetIndex = manifest ? to.y * manifest.width + to.x : -1;
            if (!manifest || to.x >= manifest.width || to.y >= manifest.height || manifest.walkable[targetIndex] !== '1') {
                return { status: 409, body: { error: 'The step does not match the sealed shrine floor.' } };
            }
            const recent = Array.isArray(run.recentStepIds) ? run.recentStepIds : [];
            if (recent.includes(requestId)) {
                const saveVersion = await persistRunProjection(playerName, token, run);
                return { status: 200, body: {
                    ok: true,
                    alreadyReported: true,
                    position: run.position ?? to,
                    torch: Math.max(0, Math.floor(Number(run.torch) || 0)),
                    threat: Math.max(0, Math.floor(Number(run.threat) || 0)),
                    wardSteps: Math.max(0, Math.floor(Number(run.wardSteps) || 0)),
                    stepVersion: Math.max(0, Math.floor(Number(run.stepVersion) || 0)),
                    _saveVersion: saveVersion,
                } };
            }
            if (run.activeEncounter || run.pendingAmbush) return { status: 409, body: { error: 'Resolve the sealed encounter before moving.' } };
            if (!run.position || run.position.x !== from.x || run.position.y !== from.y) {
                return { status: 409, body: { error: 'The step origin is stale.', position: run.position } };
            }
            const currentNodeId = hollowGatePositionNodeId(manifest, run.position);
            const currentKind = hollowGateManifestNode(manifest, currentNodeId);
            if (currentKind === 'battle' || currentKind === 'elite' || currentKind === 'boss' || currentKind === 'pet_battle') {
                const expectedKind = currentKind === 'pet_battle' ? 'beast' : currentKind;
                const resolved = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
                if (!resolved.includes(`${floor}:${expectedKind}:${currentNodeId}`)) {
                    return { status: 409, body: { error: 'Resolve the sealed combat node before moving.' } };
                }
            }
            const { torchBefore, torch, wardSteps, threat, stepVersion, pendingAmbush } = deriveHollowGateStepState(run, randomInt(0, 5) === 0);
            const next: HollowGateRunToken = {
                ...run,
                position: to,
                torch,
                threat,
                wardSteps,
                stepVersion,
                recentStepIds: [...recent, requestId].slice(-64),
                pendingAmbush,
            };
            await kv.set(runKey, next);
            let saveVersion = 0;
            try {
                saveVersion = await persistRunProjection(playerName, token, next);
            } catch (error) {
                await kv.set(runKey, run).catch(() => undefined);
                throw error;
            }
            return { status: 200, body: {
                ok: true,
                position: to,
                torch,
                threat,
                wardSteps,
                stepVersion,
                torchSputtered: torch === 0 && torchBefore > 0,
                ambush: pendingAmbush,
                _saveVersion: saveVersion,
            } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/step]', error);
        return res.status(500).json({ error: 'The Hollow Gate step could not be sealed.' });
    }
}
