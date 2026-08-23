import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { TOWER_PVP_REQUEST_ID } from '../../shared/tower-pvp.js';
import { ATTACKABLE_MIN_LEVEL, isBelowAttackableFloor } from '../_realtime/presence-gating.js';
import { towerModeDisabled } from './_mode-control.js';
import {
    joinTowerPvpQueue,
    leaveTowerPvp,
    loadTowerPvpFighter,
    setTowerPvpReady,
    towerPvpPresence,
} from './_pvp-store.js';
import { projectTowerPvpMatchForViewer, TOWER_PVP_ID } from './_pvp-session.js';
import { towerPvpState } from './_pvp-lifecycle.js';
import { LockContendedError } from '../_lock.js';

function bodyOf(req: VercelRequest): Record<string, unknown> {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as Record<string, unknown>;
}

function statusForQueueError(error: unknown): { status: number; code: string; message: string } {
    const code = error instanceof Error ? error.message : 'queue-failed';
    if (code === 'already-queued') return { status: 409, code, message: 'Already queued with another request.' };
    if (code === 'already-matched') return { status: 409, code, message: 'Finish or leave your current Tower MPvP match.' };
    if (code === 'member-busy') return { status: 409, code, message: 'Finish your current battle before matchmaking.' };
    return { status: 500, code: 'queue-failed', message: 'Tower MPvP matchmaking could not be completed.' };
}

/** GET presence; POST join/leave/ready for the public exact-2v2 queue. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const input = req.method === 'GET' ? req.query as Record<string, unknown> : bodyOf(req);
        const playerName = safeName(String(input.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing player.', errorCode: 'invalid-player' });
        if (!enforceRateLimit(req, res, 'tower-pvp-queue', req.method === 'GET' ? 120 : 40, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only manage your own queue presence.' });
        const slug = identity.admin ? playerName : identity.name;
        res.setHeader('Cache-Control', 'private, no-store');

        if (req.method === 'GET') {
            const presence = await towerPvpPresence(slug);
            if (presence.state !== 'matched') return res.status(200).json({ presence });
            const state = await towerPvpState(presence.match.matchId, slug);
            return state.ok
                ? res.status(200).json({ presence: { state: 'matched', match: projectTowerPvpMatchForViewer(state.match, slug), queuePosition: null } })
                : res.status(state.status).json({ error: state.error, errorCode: state.code, match: state.match ? projectTowerPvpMatchForViewer(state.match, slug) : undefined });
        }

        const action = String(input.action ?? '');
        const requestId = String(input.requestId ?? '');
        if (!TOWER_PVP_REQUEST_ID.test(requestId)) {
            return res.status(400).json({ error: 'A valid request ID is required.', errorCode: 'invalid-request-id' });
        }
        if (action === 'join') {
            if (towerModeDisabled()) return res.status(503).json({ error: 'Battle Towers launches are temporarily disabled.', errorCode: 'tower-mode-disabled' });
            const fighter = await loadTowerPvpFighter(slug);
            if (!fighter) return res.status(404).json({ error: 'Your save was not found.', errorCode: 'save-not-found' });
            // Team Arena is a BATTLE ARENA mode, not a Towers one, so it gates on
            // the shared PvP newcomer floor like ranked and casual PvP — not on
            // the level-30 Battle Towers unlock it used to inherit from sitting
            // in that lobby. The level is authoritative: loadTowerPvpFighter
            // seals from `save:<slug>` and hydration starts from the save
            // character, so it is never client-supplied. Admins keep the override.
            const level = Math.floor(Number(fighter.character.level ?? 0)) || 0;
            if (!identity.admin && isBelowAttackableFloor(level)) {
                return res.status(403).json({
                    error: `You must reach level ${ATTACKABLE_MIN_LEVEL} before entering Team Arena.`,
                    errorCode: 'pvp-level-locked',
                    requiredLevel: ATTACKABLE_MIN_LEVEL,
                });
            }
            try {
                const joined = await joinTowerPvpQueue({ fighter, requestId });
                if (joined.presence.state === 'matched') {
                    joined.presence.match = projectTowerPvpMatchForViewer(joined.presence.match, slug)!;
                }
                return res.status(200).json(joined);
            } catch (error) {
                if (error instanceof LockContendedError) throw error;
                const mapped = statusForQueueError(error);
                return res.status(mapped.status).json({ error: mapped.message, errorCode: mapped.code });
            }
        }
        if (action === 'ready') {
            const matchId = String(input.matchId ?? '');
            const expectedVersion = Number(input.expectedVersion);
            if (!TOWER_PVP_ID.test(matchId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
                return res.status(400).json({ error: 'Valid match and expected version are required.', errorCode: 'invalid-command' });
            }
            const result = await setTowerPvpReady({
                matchId,
                slug,
                ready: input.ready !== false,
                requestId,
                expectedVersion,
                // This route is the OPEN queue only. A clan-war 2v2 shares the
                // match store, so without this a war member could drive their
                // challenge match from here.
                requireBinding: 'public-queue',
            });
            return result.ok
                ? res.status(200).json({ replayed: result.replayed, match: result.match ? projectTowerPvpMatchForViewer(result.match, slug) : null })
                : res.status(result.status).json({ error: result.error, errorCode: result.code, match: result.match ? projectTowerPvpMatchForViewer(result.match, slug) : undefined });
        }
        if (action === 'leave') {
            const matchId = input.matchId === undefined ? undefined : String(input.matchId);
            if (matchId !== undefined && !TOWER_PVP_ID.test(matchId)) {
                return res.status(400).json({ error: 'Invalid match.', errorCode: 'invalid-match' });
            }
            const expectedVersion = input.expectedVersion === undefined ? undefined : Number(input.expectedVersion);
            if (matchId && (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0)) {
                return res.status(400).json({ error: 'A valid expected version is required.', errorCode: 'invalid-version' });
            }
            const result = await leaveTowerPvp({ slug, matchId, requestId, expectedVersion, requireBinding: 'public-queue' });
            if (!result.ok) return res.status(result.status).json({ error: result.error, errorCode: result.code, match: result.match ? projectTowerPvpMatchForViewer(result.match, slug) : undefined });
            const presence = await towerPvpPresence(slug);
            if (presence.state === 'matched') presence.match = projectTowerPvpMatchForViewer(presence.match, slug)!;
            return res.status(200).json({ replayed: result.replayed, match: result.match ? projectTowerPvpMatchForViewer(result.match, slug) : null, presence });
        }
        return res.status(400).json({ error: 'Unknown queue action.', errorCode: 'unknown-action' });
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Tower MPvP state is busy. Retry this request.', errorCode: 'tower-pvp-busy' });
        }
        console.error('[towers/pvp-queue]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
