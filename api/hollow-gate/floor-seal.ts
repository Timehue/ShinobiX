import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { validateHollowGateFloorManifest } from './_floor-manifest.js';

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
            const run = await kv.get<HollowGateRunToken>(runKey);
            if (!run || run.playerName !== playerName) return { status: 409, body: { error: 'The Hollow Gate run has expired.' } };
            if (run.activeEncounter) return { status: 409, body: { error: 'Finish the active encounter first.' } };
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
            });
            if (!validation.ok) return { status: 409, body: { error: `Invalid Hollow Gate floor: ${validation.reason}.` } };
            if (existing) {
                if (JSON.stringify(existing) !== JSON.stringify(validation.manifest)) {
                    return { status: 409, body: { error: 'The floor manifest is already sealed.' } };
                }
                return { status: 200, body: { ok: true, alreadyReported: true, manifest: existing } };
            }
            const next: HollowGateRunToken = {
                ...run,
                floorManifests: { ...manifests, [String(floor)]: validation.manifest },
                position: validation.manifest.spawn,
            };
            await kv.set(runKey, next);
            return { status: 200, body: { ok: true, manifest: validation.manifest } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/floor-seal]', error);
        return res.status(500).json({ error: 'The Hollow Gate floor could not be sealed.' });
    }
}
