import { safeLogValue } from '../_safe-log.js';
import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { maxLockedDoorsForDepth, rollHollowLockedDoor, type HollowLockedDoorResult } from './_locked-door.js';

const unit = () => randomInt(1_000_000_000) / 1_000_000_000;
const cleanToken = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value) ? value : '';
const cleanRequestId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(value) ? value : '';

type StoredResult = HollowLockedDoorResult & { petToken?: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = cleanToken(body.token); const requestId = cleanRequestId(body.requestId);
        if (!playerName || !token || !requestId) return res.status(400).json({ error: 'Invalid locked-door request.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-locked-door', 30, 60_000, identity.name))) return;
        const run = await kv.get<HollowGateRunToken>(hollowGateRunKey(playerName, token));
        if (!run || run.playerName.toLowerCase() !== playerName.toLowerCase()) return res.status(409).json({ error: 'invalid-or-spent-run' });
        const resultKey = `hg-locked-result:${playerName}:${token}:${requestId}`;
        const result = await withKvLock(resultKey, async () => {
            const cached = await kv.get<StoredResult>(resultKey);
            if (cached) return cached;
            const count = await kv.incr(`hg-locked-count:${playerName}:${token}`, { ex: 25 * 60 * 60 });
            if (!identity.admin && count > maxLockedDoorsForDepth(run.floorDepth)) return null;
            const rolled: StoredResult = rollHollowLockedDoor(unit, Date.now(), run.floorDepth);
            if (rolled.outcome === 'pet' && rolled.pet) {
                rolled.petToken = randomUUID().replace(/-/g, '');
                await kv.set(`pet-encounter:${playerName}:${rolled.petToken}`, { playerName, pet: rolled.pet, mintedAt: Date.now() }, { ex: 20 * 60 });
            }
            await kv.set(resultKey, rolled, { ex: 25 * 60 * 60 });
            return rolled;
        }, { failClosed: true });
        if (!result) return res.status(429).json({ error: 'locked-door-limit' });
        return res.status(200).json({ ok: true, ...result });
    } catch (error) { console.error('[hollow-gate/locked-door]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
