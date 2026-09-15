import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cors, safeName } from '../_utils.js';
import { kv } from '../_storage.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { safeLogValue } from '../_safe-log.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { recordEconomyTxn } from '../_economy.js';
import { beginChampionshipRace, checkpointChampionship, FestivalError, makeRallyEntrants, ownedRallyPet, prepareChampionship, rallyDaily, rallyProgress } from './_rally.js';
import { createRallyRace } from '../../shared/sunscar/rally-simulation.js';
import { RALLY_TRACKS } from '../../shared/sunscar/rally-tracks.js';
import type { RallyState } from '../../shared/sunscar/rally-types.js';

function preview(character: Record<string, unknown>): RallyState | undefined {
    const run = rallyProgress(character).current;
    return run && (run.status === 'ready' || run.status === 'between')
        ? createRallyRace(run.seed + run.results.length, run.tracks[run.results.length], makeRallyEntrants(run.pet, run.rivals)) : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const body = req.method === 'GET' ? req.query ?? {} : typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const player = safeName(String(body.playerName ?? ''));
        if (!player) return res.status(400).json({ error: 'Choose a player to enter the Rally.' });
        const identity = await authedPlayerOrAdmin(req, player);
        if (!identity) return res.status(401).json({ error: 'Sign in to enter the Rally.' });
        if (!identity.admin && identity.name !== player) return res.status(403).json({ error: 'This race belongs to another player.' });
        if (!identity.admin && !await enforceRateLimitKv(req, res, 'sunscar-rally', 60, 60_000, player, { strict: true })) return;
        const now = Date.now();
        const daily = rallyDaily(player, now);
        if (req.method === 'GET') {
            const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${player}`);
            if (!save?.character) return res.status(404).json({ error: 'Your character could not be loaded.' });
            return res.status(200).json({ ok: true, progress: rallyProgress(save.character), preview: preview(save.character), daily, serverNow: now });
        }
        const out = await mutatePlayerSave<{ paid: number; practice?: RallyState }>(player, ({ character }) => {
            if (body.action === 'practice') {
                if (!RALLY_TRACKS.some(track => track.id === body.trackId)) throw new FestivalError('Choose an available course.');
                const pet = ownedRallyPet(character, body.petId);
                const race = createRallyRace(daily.seed, body.trackId, makeRallyEntrants(pet, daily.rivals));
                return { ok: true, character, value: { practice: race, paid: 0 }, write: false };
            }
            if (body.action === 'prepare') {
                // A lost preparation response must not replace its still-unstarted reservation.
                const existing = rallyProgress(character).current;
                if (existing?.status === 'ready' && existing.day === daily.day && existing.pet.id === body.petId) return { ok: true, character, value: { paid: 0 }, write: false };
                return { ok: true, character: prepareChampionship(character, player, body.petId, now), value: { paid: 0 } };
            }
            if (body.action === 'begin') {
                const next = beginChampionshipRace(character, body.runId, now);
                return { ok: true, character: next, value: { paid: 0 }, write: next !== character };
            }
            if (body.action === 'checkpoint') {
                const result = checkpointChampionship(character, body, now);
                return { ok: true, character: result.character, value: { paid: result.paid }, write: !result.replay };
            }
            throw new FestivalError('Unknown Rally action.');
        });
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        const progress = rallyProgress(out.character);
        if (out.value.paid > 0) await recordEconomyTxn({ txnId: `sunscar-rally:${progress.current!.id}`, player, currency: 'ryo', delta: out.value.paid, source: 'sunscar.rally' });
        return res.status(200).json({ ok: true, ...out.value, progress, preview: preview(out.character), daily, character: out.character, _saveVersion: out._saveVersion, serverNow: now });
    } catch (error) {
        if (error instanceof FestivalError) return res.status(error.status).json({ error: error.message });
        if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid race request.' });
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Your race is saving. Please retry the checkpoint.' });
        console.error('[sunscar-rally]', safeLogValue(error));
        return res.status(503).json({ error: 'The race desk could not be reached. Your saved checkpoint is safe; retry to continue.' });
    }
}
