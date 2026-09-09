import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { kv } from '../_storage.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { invalidateProcCache } from '../_proc-cache.js';
import { safeLogValue } from '../_safe-log.js';
import { elderVillageKey } from './_elders.js';
import { readVillageAnbu } from './_anbu.js';
import { leadershipVillageKey } from '../../shared/village-anbu.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(req.method === 'GET' ? req.query.playerName ?? '' : body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your village action.' });
        const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
        const village = String(save?.character?.village ?? '').trim();
        if (!village) return res.status(404).json({ error: 'Player village not found.' });
        if (req.method === 'GET') return res.status(200).json(await readVillageAnbu(village));
        if (!['appoint', 'clear'].includes(body.action) || !Number.isInteger(body.seat) || body.seat < 0 || body.seat > 2) return res.status(400).json({ error: 'Invalid ANBU seat action.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'anbu-appointment', 20, 60_000, identity.name))) return;
        const stateKey = elderVillageKey(village);
        const kageKey = `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
        const result = await withKvLock(kageKey, () => withKvLock<{ status: number; body: Record<string, unknown> }>(stateKey, async () => {
            const kage = await kv.get<{ seatedKage?: string }>(kageKey);
            if (!identity.admin && safeName(kage?.seatedKage ?? '') !== playerName) return { status: 403, body: { error: 'Only the seated Kage can appoint or clear ANBU seats.' } };
            const actor = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
            if (leadershipVillageKey(actor?.character?.village) !== leadershipVillageKey(village)) return { status: 409, body: { error: 'Your village changed. Refresh Town Hall.' } };
            const state = await kv.get<Record<string, unknown>>(stateKey) ?? {};
            const { appointed } = await readVillageAnbu(village, state);
            if (body.action === 'appoint') {
                const appointee = safeName(String(body.appointee ?? ''));
                const target = appointee ? await kv.get<{ character?: { name?: string; village?: string } }>(`save:${appointee}`) : null;
                if (!target?.character || leadershipVillageKey(target.character.village) !== leadershipVillageKey(village)) return { status: 400, body: { error: 'Choose an existing player in your village.' } };
                if (appointed.some((name, index) => index !== body.seat && safeName(name) === appointee)) return { status: 409, body: { error: 'That player already holds another appointed ANBU seat. Clear it first.' } };
                appointed[body.seat] = String(target.character.name ?? appointee);
            } else appointed[body.seat] = '';
            const next = { ...state, anbuAppointees: appointed };
            await kv.set(stateKey, next);
            invalidateProcCache('game-state:frame');
            return { status: 200, body: { ok: true, ...await readVillageAnbu(village, next) } };
        }, { failClosed: true }), { failClosed: true });
        return res.status(result.status).json(result.body);
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Village leadership is being updated. Please retry.' });
        console.error('[village/anbu]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
