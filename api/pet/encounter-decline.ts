import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    cleanPetEncounterPointer,
    petEncounterActiveKey,
    petEncounterRequestKey,
    PET_ENCOUNTER_POINTER_TTL_SECONDS,
} from './_encounter-pointer.js';

const cleanToken = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value) ? value : '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = cleanToken(body.token);
        if (!playerName || !token) return res.status(400).json({ error: 'Invalid player or encounter token.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your encounter.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-encounter-decline', 20, 60_000, identity.name))) return;
        const activeKey = petEncounterActiveKey(playerName);
        const receiptKey = `pet-encounter-declined:${playerName}:${token}`;
        const result = await withKvLock(activeKey, async () => {
            const prior = await kv.get<{ requestId?: string }>(receiptKey);
            const active = cleanPetEncounterPointer(await kv.get(activeKey));
            if (prior) {
                const requestId = typeof prior.requestId === 'string' ? prior.requestId : active?.requestId;
                if (requestId) {
                    const key = petEncounterRequestKey(playerName, requestId);
                    const request = await kv.get<Record<string, unknown>>(key);
                    if (request) await kv.set(key, { ...request, resolvedAt: Date.now(), resolution: 'declined' }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                }
                await kv.del(`pet-encounter:${playerName}:${token}`).catch(() => undefined);
                if (active?.token === token) await kv.del(activeKey).catch(() => undefined);
                return { replayed: true };
            }
            const encounter = await kv.get<Record<string, unknown>>(`pet-encounter:${playerName}:${token}`);
            if (!encounter || safeName(String(encounter.playerName ?? '')) !== playerName
                || active?.outcome !== 'hit' || active.token !== token) {
                return { error: 'invalid-or-spent-encounter' };
            }
            const requestId = active.requestId;
            const requestReceiptKey = petEncounterRequestKey(playerName, requestId);
            const request = await kv.get<Record<string, unknown>>(requestReceiptKey);
            await kv.set(requestReceiptKey, {
                version: 1,
                playerName,
                requestId,
                day: new Date(active.mintedAt).toISOString().slice(0, 10),
                sector: active.sector,
                mintedAt: active.mintedAt,
                ...request,
                resolvedAt: Date.now(),
                resolution: 'declined',
            }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
            await kv.set(receiptKey, { playerName, token, requestId, at: Date.now() }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
            await kv.del(`pet-encounter:${playerName}:${token}`);
            await kv.del(activeKey);
            return { replayed: false };
        }, { failClosed: true });
        if ('error' in result) return res.status(409).json({ error: result.error });
        return res.status(200).json({ ok: true, token, replayed: result.replayed });
    } catch (error) {
        console.error('[pet/encounter-decline]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
