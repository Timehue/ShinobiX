import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin, isFullAdmin } from '../_auth.js';
import { cors, safeName } from '../_utils.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { circuitHistory, circuitPhase, isCircuitDiscipline, type CircuitEvent } from '../../shared/dojo-circuit.js';
import { CIRCUIT_KEY, CIRCUIT_ENABLED_KEY, readCircuit, setCircuitEnabled, circuitVictoryFits } from './_store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Sign in to enter the Dojo Circuit.' });
        const fullAdmin = isFullAdmin(req);
        const playerId = identity.admin ? '' : identity.name;
        const attemptKey = `player:${playerId}`;
        const respond = async (message?: string) => {
            const [state, enabled] = await Promise.all([readCircuit(), kv.get<boolean>(CIRCUIT_ENABLED_KEY)]);
            let event = state.event;
            if (req.method === 'GET' && typeof req.query.eventId === 'string' && req.query.eventId !== event?.id) {
                if (!/^[\w-]{1,80}$/.test(req.query.eventId)) return res.status(400).json({ error: 'Invalid event.' });
                event = await kv.get<CircuitEvent>(`game:dojo-circuit:archive:${req.query.eventId}`);
                if (!event) return res.status(404).json({ error: 'This Circuit record could not be found.' });
            }
            return res.status(200).json({ enabled: enabled === true, event, history: state.history,
                attempt: event?.id === state.event?.id && playerId ? state.attempts[attemptKey] ?? null : null, serverNow: Date.now(), message });
        };
        if (req.method === 'GET') return await respond();
        if (!(await enforceRateLimitKv(req, res, 'dojo-circuit', 30, 60_000, playerId || 'admin'))) return;
        const action = String(body.action ?? '');
        const adminAction = ['toggle', 'schedule', 'end', 'champion'].includes(action);
        if (adminAction && !fullAdmin) return res.status(403).json({ error: 'Only a full admin can manage the Circuit.' });
        if (action === 'toggle') {
            if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'Choose on or off.' });
            await setCircuitEnabled(body.enabled);
            return await respond(body.enabled ? 'Dojo Circuit is enabled.' : 'Dojo Circuit is off. Recorded seals are preserved.');
        }
        const result = await withKvLock(CIRCUIT_KEY, async () => {
            const state = await readCircuit();
            const enabled = await kv.get<boolean>(CIRCUIT_ENABLED_KEY) === true;
            const now = Date.now();
            const fail = (status: number, error: string) => ({ status, error });
            if (action === 'schedule') {
                if (state.event && !state.event.endedAt && state.event.endsAt > now) return fail(409, 'End the current Circuit before scheduling another.');
                const startsAt = Number(body.startsAt);
                const days = Number(body.days ?? 7);
                const name = typeof body.name === 'string' ? body.name.trim() : '';
                if (!Number.isSafeInteger(startsAt) || startsAt < now - 60_000 || startsAt > now + 90 * 86400_000
                    || !Number.isInteger(days) || days < 1 || days > 14 || !name || name.length > 60 || !isCircuitDiscipline(body.featured)) {
                    return fail(400, 'Use a name up to 60 characters, a start within 90 days, and a duration of 1–14 days.');
                }
                if (state.event) {
                    await kv.set(`game:dojo-circuit:archive:${state.event.id}`, state.event);
                    state.history = [circuitHistory(state.event), ...state.history.filter(e => e.id !== state.event!.id)].slice(0, 24);
                }
                state.event = { id: randomUUID(), name, startsAt, endsAt: startsAt + days * 86400_000, createdAt: now, featured: body.featured, entrants: [] };
                state.attempts = {};
            } else {
                const event = state.event;
                if (!event || body.eventId !== event.id) return fail(409, 'The Circuit changed. Refresh the event board.');
                if (action === 'end') {
                    if (!event.endedAt) event.endedAt = now;
                    state.attempts = {};
                } else if (action === 'champion') {
                    if (circuitPhase(true, event, now) !== 'results') return fail(409, 'Close the Circuit before naming a champion.');
                    const entrant = event.entrants.find(e => e.id === safeName(String(body.championId ?? '')));
                    if (!entrant || entrant.seals.length !== 3) return fail(400, 'A champion must have earned all three seals.');
                    if (event.championId && event.championId !== entrant.id) return fail(409, 'The champion has already been recorded.');
                    event.championId = entrant.id;
                } else {
                    if (!playerId) return fail(403, 'Use a player account to participate.');
                    if (circuitPhase(enabled, event, now) !== 'live') return fail(409, 'The Circuit is not accepting activity right now.');
                    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerId}`);
                    if (!save?.character) return fail(404, 'Your character could not be loaded.');
                    const char = save.character;
                    let entrant = event.entrants.find(e => e.id === playerId);
                    if (action === 'join') {
                        if (!entrant) {
                            if (event.entrants.length >= 500) return fail(409, 'This Circuit has reached its participant limit.');
                            entrant = { id: playerId, name: String(char.name ?? playerId), village: String(char.village ?? ''), joinedAt: now, seals: [] };
                            event.entrants.push(entrant);
                        }
                    } else if (action === 'begin') {
                        if (!entrant) return fail(409, 'Join this Circuit first.');
                        if (!isCircuitDiscipline(body.discipline)) return fail(400, 'Choose a Circuit discipline.');
                        const discipline = body.discipline;
                        if (entrant.seals.some(s => s.discipline === discipline)) return fail(409, 'You already earned this seal.');
                        if (discipline === 'cards' && char.starterCardsClaimed !== true) return fail(409, 'Meet the Chronicle Scribe to unlock Card Clash.');
                        if (discipline === 'pets' && (!Array.isArray(char.pets) || char.pets.length === 0)) return fail(409, 'A companion is required for this discipline.');
                        if (state.attempts[attemptKey] && state.attempts[attemptKey].discipline !== discipline) return fail(409, 'Finish or leave your current trial before choosing another.');
                        // Resume preserves the original window and any host-verified proof.
                        state.attempts[attemptKey] ??= { discipline, openedAt: now };
                    } else if (action === 'check') {
                        if (!entrant) return fail(409, 'Join this Circuit first.');
                        const attempt = state.attempts[attemptKey];
                        if (!attempt) return fail(409, 'Choose a discipline to begin a trial.');
                        const proof = attempt.verifiedVictory;
                        // Lifetime counters (including legacy attempt baselines) are never proof.
                        if (!proof?.matchId || !circuitVictoryFits(event, attempt, proof.startedAt, proof.finishedAt)) return fail(409, 'No qualifying match has been verified yet. Finish this trial and check again.');
                        if (!entrant.seals.some(s => s.discipline === attempt.discipline)) entrant.seals.push({ discipline: attempt.discipline, earnedAt: proof.finishedAt });
                        delete state.attempts[attemptKey];
                    } else if (action === 'leaveTrial') {
                        delete state.attempts[attemptKey];
                    } else return fail(400, 'Unknown Circuit action.');
                }
            }
            await kv.set(CIRCUIT_KEY, state);
            return { status: 200, error: '' };
        }, { failClosed: true, ttlSec: 30 });
        if (result.status !== 200) return res.status(result.status).json({ error: result.error });
        return await respond(action === 'check' ? 'Seal earned. Your victory is on the world board.' : undefined);
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'The event board is updating. Please try again.' });
        if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' });
        console.error('[dojo-circuit]', safeLogValue(error));
        return res.status(500).json({ error: 'The event board could not be reached. Your recorded progress is safe.' });
    }
}
