import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin, isFullAdmin } from '../_auth.js';
import { cors, safeName } from '../_utils.js';
import { kv } from '../_storage.js';
import { LockContendedError } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { rankedLevelEligible, RANKED_LEVEL_WARNING } from '../../shared/ranked-eligibility.js';
import { TOURNAMENT_MODES, TOURNAMENT_WINDOW_MS, type Tournament, type TournamentMode } from '../../shared/tournaments.js';
import { loadTowerPvpFighter, readTowerPvpMatch } from '../towers/_pvp-store.js';
import { projectTowerPvpMatchForViewer } from '../towers/_pvp-session.js';
import { settleTowerPvpMatch } from '../towers/_pvp-lifecycle.js';
import { sealChallengedPets } from '../pet/_pvp-duel.js';
import { TOURNAMENT_KEY, tournamentLock, readTournament, progressTournament, tickTournaments, cancelTournament,
    entryForPlayer, matchMembers, loadoutKey, replayKey, type TournamentLoadout, type PetTournamentResult } from './_store.js';

class TournamentError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new TournamentError(status, message); };
async function character(id: string) {
    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${id}`);
    return save?.character ?? fail(404, 'Player character not found.');
}
async function sealEntry(event: Tournament, playerId: string, body: Record<string, unknown>) {
    const char = await character(playerId);
    let snapshot: TournamentLoadout;
    if (event.mode === 'pet') {
        const ids = body.petIds;
        const count = event.petFormat === '2v2' ? 2 : 1;
        if (!Array.isArray(ids) || ids.length !== count || new Set(ids).size !== count || ids.some(id => typeof id !== 'string')) fail(400, `Select ${count} different carried pet(s).`);
        const pets = sealChallengedPets(char, ids as string[]);
        if (!pets) fail(409, 'Selected pets must be carried and available.');
        snapshot = { pets: pets! };
    } else {
        const ranked = event.mode === 'ranked' || event.mode === '2v2';
        if (ranked && !rankedLevelEligible(char.level)) fail(409, RANKED_LEVEL_WARNING);
        const fighter = await loadTowerPvpFighter(playerId, { rankedFormat: ranked });
        if (!fighter) fail(409, 'Your combat loadout is unavailable.');
        // Tournament rounds do not spend inventory or award ladder rewards.
        delete fighter!.itemCharges;
        snapshot = { fighter: fighter! };
    }
    await kv.set(loadoutKey(event.id, playerId), snapshot, { ex: 9 * 86400 });
    return String(char.name ?? playerId).slice(0, 40);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Sign in to view tournaments.' });
        const playerId = identity.admin ? '' : identity.name;
        if (!(await enforceRateLimitKv(req, res, 'tournaments', 90, 60_000, playerId || 'admin'))) return;
        if (req.method === 'GET') {
            await tickTournaments();
            return res.status(200).json({ event: await readTournament(), serverNow: Date.now(), playerId });
        }
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
        const action = String(body.action ?? '');
        if (['create', 'cancel'].includes(action) && !isFullAdmin(req)) fail(403, 'Only a full administrator can manage tournaments.');
        const result = await tournamentLock(async () => {
            let event = await readTournament();
            if (event && action !== 'cancel') await progressTournament(event);
            // A new event may open while a finalist is still viewing the previous result.
            // Its archived membership still authorizes replay/acknowledgement, never new play.
            let archived = false;
            if (['battle', 'settle'].includes(action) && body.eventId !== event?.id
                && typeof body.eventId === 'string' && /^[a-f0-9-]{36}$/.test(body.eventId)) {
                event = await kv.get<Tournament>(`game:tournaments:archive:${body.eventId}`);
                archived = true;
            }
            if (action === 'create') {
                if (event && ['signup', 'live'].includes(event.status)) fail(409, 'Finish or cancel the current tournament first.');
                const name = typeof body.name === 'string' ? body.name.trim() : '';
                const minutes = Number(body.signupMinutes), maxEntries = Number(body.maxEntries), readySeconds = Number(body.readySeconds);
                if (!name || name.length > 60 || !TOURNAMENT_MODES.includes(body.mode as TournamentMode)
                    || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080
                    || ![4, 8, 16, 32, 64].includes(maxEntries)
                    || !Number.isInteger(readySeconds) || readySeconds < 30 || readySeconds > 300
                    || !['1v1', '2v2'].includes(String(body.petFormat)) || typeof body.notes !== 'string' || body.notes.length > 1000) {
                    fail(400, 'Choose a mode, signup duration (1–10,080 minutes), capacity, ready timer (30–300 seconds), and a name up to 60 characters.');
                }
                if (event) await kv.set(`game:tournaments:archive:${event.id}`, event, { ex: 30 * 86400 });
                const now = Date.now(), signupEndsAt = now + minutes * 60_000;
                event = { id: randomUUID(), name, mode: body.mode as TournamentMode, notes: String(body.notes).trim(),
                    createdAt: now, signupEndsAt, endsAt: signupEndsAt + TOURNAMENT_WINDOW_MS,
                    status: 'signup', maxEntries, readySeconds, petFormat: body.petFormat as '1v1' | '2v2',
                    entries: [], matches: [], round: 0, rounds: 0, champion: null };
            } else {
                if (!event || body.eventId !== event.id) fail(409, 'The tournament changed. Refresh the board.');
                const current = event!;
                if (action === 'cancel') { await cancelTournament(current); }
                else {
                    if (!playerId) fail(403, 'Use a player account to participate.');
                    const entry = entryForPlayer(current, playerId);
                    if (['join', 'accept', 'leave'].includes(action)) {
                        if (current.status !== 'signup' || Date.now() >= current.signupEndsAt) fail(409, 'Signup is closed.');
                        if (action === 'leave') {
                            current.entries = current.entries.filter(e => e.id !== entry?.id);
                        } else if (action === 'accept') {
                            const member = entry?.members.find(m => m.id === playerId);
                            if (!member) fail(409, 'No invitation found.');
                            if (!member!.accepted) {
                                member!.name = await sealEntry(current, playerId, body);
                                member!.accepted = true;
                            }
                        } else if (!entry) {
                            if (current.entries.length >= current.maxEntries) fail(409, 'The tournament is full.');
                            const partnerId = safeName(String(body.partner ?? ''));
                            let partnerName = '';
                            if (current.mode === '2v2') {
                                if (!partnerId || partnerId === playerId || entryForPlayer(current, partnerId)) fail(409, 'Choose a partner who is not already entered or invited.');
                                const partner = await character(partnerId);
                                if (!rankedLevelEligible(partner.level)) fail(409, 'Your partner must be eligible for Ranked Format battles.');
                                partnerName = String(partner.name ?? partnerId).slice(0, 40);
                            }
                            const name = await sealEntry(current, playerId, body);
                            current.entries.push({ id: randomUUID(), members: [{ id: playerId, name, accepted: true },
                                ...(current.mode === '2v2' ? [{ id: partnerId, name: partnerName, accepted: false }] : [])] });
                        }
                    } else if (['ready', 'battle', 'settle'].includes(action)) {
                        const match = current.matches.find(m => m.id === body.matchId);
                        if (!match || !matchMembers(current, match).includes(playerId)) fail(403, 'This is not your match.');
                        if (action === 'ready') {
                            if (match!.status !== 'waiting' && match!.ready.includes(playerId)) {
                                return { event: current, serverNow: Date.now(), playerId };
                            }
                            if (current.status !== 'live' || match!.status !== 'waiting' || Date.now() >= match!.readyEndsAt) fail(409, 'The ready window has closed.');
                            if (isIncapacitated(await character(playerId), Date.now())) fail(409, 'Recover before readying for a tournament battle.');
                            if (!match!.ready.includes(playerId)) match!.ready.push(playerId);
                            // Persist readiness before publication so a lost response can be retried safely.
                            await kv.set(TOURNAMENT_KEY, current);
                            await progressTournament(current);
                        }
                        if (action === 'settle') {
                            const settled = await settleTowerPvpMatch(match!.battleId, playerId, {}, 'tournament');
                            if (!settled.ok) fail(settled.status, settled.error);
                            if (!archived) await progressTournament(current);
                            if (settled.ok) return { ...settled.response, match: projectTowerPvpMatchForViewer(settled.response.match, playerId) };
                        }
                        if (action === 'battle') {
                            const battle = await readTowerPvpMatch(match!.battleId);
                            const replay = current.mode === 'pet' ? await kv.get<PetTournamentResult>(replayKey(match!.id)) : null;
                            return { match: battle ? projectTowerPvpMatchForViewer(battle, playerId) : null, script: replay?.script ?? null };
                        }
                    } else fail(400, 'Unknown tournament action.');
                }
            }
            await kv.set(TOURNAMENT_KEY, event);
            return { event, serverNow: Date.now(), playerId };
        });
        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof TournamentError) return res.status(error.status).json({ error: error.message });
        if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' });
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Tournament updating. Please retry.' });
        console.error('[tournaments]', error instanceof Error ? error.message : 'Unknown error');
        return res.status(500).json({ error: 'Tournament unavailable. Please retry.' });
    }
}
