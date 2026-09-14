import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { kv } from '../_storage.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { invalidateProcCache } from '../_proc-cache.js';
import { elderVillageKey, readVillageElders } from './_elders.js';
import { elderCouncilKey, readElderCouncil, resolveElderCouncil, validElderSeats } from './_elder-council.js';
import { elderTermScore } from '../../shared/elder-elections.js';
import { ELDER_FOCI, elderFocusForSeats } from '../../shared/village-elders.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(req.method === 'GET' ? req.query.playerName ?? '' : body.playerName ?? ''));
        const focus = typeof body.focus === 'string' ? body.focus : '';
        const action = body.action ?? 'select';
        const seatIndex = ELDER_FOCI.findIndex(key => key === focus);
        if (!playerName || (req.method === 'POST' && (seatIndex < 0 || !['select', 'appoint', 'clear'].includes(action)))) return res.status(400).json({ error: 'Invalid elder focus action.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your elder focus.' });
        if (req.method === 'POST' && !identity.admin && !(await enforceRateLimitKv(req, res, 'elder-focus', 20, 60_000, identity.name))) return;
        const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
        const village = String(save?.character?.village ?? '').trim();
        if (!village) return res.status(404).json({ error: 'Player village not found.' });
        if (req.method === 'GET') {
            const council = await readElderCouncil(village);
            return res.status(200).json({ elderAppointees: council.seats, elderTerm: council,
                elderProgress: elderTermScore(save?.character?.elderWinDays, village, council.startedAt, Math.min(Date.now(), council.nextSelectionAt)) });
        }
        if (action !== 'select' && seatIndex !== 0) return res.status(403).json({ error: 'Only the first Elder is Kage-appointed. The other seats are selected by 30-day PvP and PvE wins.' });

        const stateKey = elderVillageKey(village);
        if (action === 'select') {
            const result = await withKvLock(stateKey, () => mutatePlayerSave(playerName, async ({ character }) => {
                if (String(character.village ?? '').trim() !== village) return { ok: false as const, status: 409, error: 'Your village changed. Refresh the council.' };
                const elderAppointees = await readVillageElders(village);
                if (!elderFocusForSeats(focus, elderAppointees)) return { ok: false as const, status: 403, error: 'AI elders have no focus. This seat must be occupied by an appointed or elected village player.' };
                const unchanged = character.elderFocus === focus;
                return { ok: true as const, character: { ...character, elderFocus: focus }, value: { elderAppointees, unchanged }, write: !unchanged };
            }), { failClosed: true });
            if (!result.ok) return res.status(result.status).json({ error: result.error });
            return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
        }

        // Serialize with Kage succession and the 30-day council election.
        const kageKey = `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
        const result = await withKvLock(kageKey, () => withKvLock<{ status: number; body: Record<string, unknown> }>(elderCouncilKey(village), async () => {
            const kage = await kv.get<{ seatedKage?: string }>(kageKey);
            if (!identity.admin && safeName(kage?.seatedKage ?? '') !== playerName) return { status: 403, body: { error: 'Only the seated Kage can appoint or clear elder seats.' } };
            const actor = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
            if (String(actor?.character?.village ?? '').trim() !== village) return { status: 409, body: { error: 'Your village changed. Refresh the council.' } };
            const council = await resolveElderCouncil(village);
            const elderAppointees = await validElderSeats(village, council.seats);
            if (action === 'appoint') {
                const appointee = safeName(String(body.appointee ?? ''));
                const target = appointee ? await kv.get<{ character?: Record<string, unknown> }>(`save:${appointee}`) : null;
                if (!target?.character || String(target.character.village ?? '').trim().toLowerCase() !== village.toLowerCase()) return { status: 400, body: { error: 'Choose an existing player in your village.' } };
                if (elderAppointees.some((name, index) => index !== seatIndex && safeName(name) === appointee)) return { status: 409, body: { error: 'That player already holds an elected Elder seat this term. Choose another player.' } };
                elderAppointees[seatIndex] = String(target.character.name ?? appointee);
            } else elderAppointees[seatIndex] = '';
            const elderTerm = { ...council, seats: elderAppointees };
            if (!await kv.compareSet(elderCouncilKey(village), council, elderTerm)) {
                return { status: 409, body: { error: 'The council changed. Refresh and try again.' } };
            }
            invalidateProcCache('game-state:frame');
            return { status: 200, body: { ok: true, elderAppointees, elderTerm } };
        }, { failClosed: true, ttlSec: 30 }), { failClosed: true, ttlSec: 30 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'The council is being updated. Please retry.' });
        console.error('[village/elder-focus]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
