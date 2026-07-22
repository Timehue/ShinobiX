import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { passRankExam } from './_pass.js';
const villageSlug = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your rank exam.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'rank-exam-pass', 10, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, async ({ character }) => {
            const state = await kv.get<{ seatedKage?: string; anbuAppointees?: unknown }>(`game:village-state:${villageSlug(character.village)}`);
            const appointees = Array.isArray(state?.anbuAppointees) ? state!.anbuAppointees.map((name) => safeName(String(name))) : [];
            const passed = passRankExam(character, body.examKey, { isKage: safeName(state?.seatedKage ?? '') === playerName, isElder: appointees.includes(playerName) });
            if (!passed.ok) return { ok: false as const, status: 409, error: passed.reason };
            return { ok: true as const, character: passed.character, value: { alreadyPassed: passed.alreadyPassed } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[exams/pass]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
