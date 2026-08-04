import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    hollowGateRunKey,
    HOLLOW_GATE_RUN_EXPIRED_MESSAGES,
    type HollowGateRunToken,
} from './_run-token.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import { hollowGateManifestNode, hollowGatePositionNodeId } from './_floor-manifest.js';

/** Advance the sealed run exactly one floor. Client map state is presentation;
 * combat-start accepts only this server-owned currentFloor. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const rawFromFloor = Number(body.fromFloor);
        if (!playerName || !token || !Number.isInteger(rawFromFloor) || rawFromFloor < 1) {
            return res.status(400).json({ error: 'Invalid Hollow Gate descent.' });
        }
        const fromFloor = rawFromFloor;
        if (!enforceRateLimit(req, res, 'hollow-gate-descend', 15, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await kv.get<HollowGateRunToken>(runKey);
            if (!run) return { status: 409, body: { error: HOLLOW_GATE_RUN_EXPIRED_MESSAGES.descend } };
            if (!run.chosenAugmentId) return { status: 409, body: { error: 'Choose the sealed augment before descending.' } };
            const currentFloor = run.currentFloor == null
                ? Math.max(1, Math.min(run.floorDepth, fromFloor))
                : Math.max(1, Math.floor(Number(run.currentFloor) || 1));
            if (fromFloor < currentFloor) return { status: 200, body: { ok: true, floor: currentFloor, alreadyAdvanced: true } };
            if (fromFloor !== currentFloor) return { status: 409, body: { error: 'The staircase does not match the sealed floor.' } };
            if (run.activeEncounter) return { status: 409, body: { error: 'Finish the active Hollow Gate encounter before descending.' } };
            if (currentFloor >= run.floorDepth) return { status: 409, body: { error: 'This is the sealed final floor.' } };
            const position = run.position;
            const manifest = run.floorManifests?.[String(currentFloor)];
            const nodeId = hollowGatePositionNodeId(manifest, position);
            if (hollowGateManifestNode(manifest, nodeId) !== 'descend') {
                return { status: 409, body: { error: 'You have not reached the sealed staircase.' } };
            }
            const nextFloor = currentFloor + 1;
            await kv.set(runKey, {
                ...run,
                currentFloor: nextFloor,
                position: undefined,
                threat: 0,
                wardSteps: 0,
                divinerUsed: false,
                pendingAmbush: null,
                torch: Math.min(10, Math.max(0, Math.floor(Number(run.torch) || 0)) + 4),
            });
            return { status: 200, body: { ok: true, floor: nextFloor } };
        }, { failClosed: true, ttlSec: 10 });
        if (result.status === 200 && result.body.alreadyAdvanced !== true) {
            await recordBetaMetric({
                event: 'hollow_gate.floor_descended',
                playerName,
                source: `floor:${String(result.body.floor ?? fromFloor + 1)}`,
            });
        }
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/descend]', error);
        return res.status(500).json({ error: 'The Hollow Gate staircase failed to seal.' });
    }
}
