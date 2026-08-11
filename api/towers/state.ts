import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { isPublicTowerRun, isSpireRun, readSession, writeSession } from './_tower-store.js';
import { autoPassAfkHumans, isAfkHumanTurnDue } from './_tower-mp.js';
import { bumpTowerActionVersion, initializeTowerActionVersion } from './_action-idempotency.js';
import {
    ensureTowerBattleLeases,
    refreshClanBossBattleMarkers,
    recoverConfirmedMissingTowerBattleLease,
    releaseTowerBattleLeases,
    towerBattleLeaseForMember,
    towerBattleLeaseMembers,
} from './_battle-lease.js';
import { activeTowerPartyForPlayer, repairStaleTowerPartyLifecycle } from './_party.js';
import type { TowerSession } from './_tower-session.js';
import { compensateConfirmedMissingTowerEntry } from './_entry-recovery.js';
import {
    isTowerSessionContention,
    TOWER_SESSION_RETRY_AFTER_SECONDS,
    towerSessionBusyErrorBody,
    withTowerSessionMutation,
} from './_session-mutation.js';

/*
 * GET /api/towers/state?runId=...&playerName=... — reconnect / poll the live session.
 *
 * Unlike the PvP spectator stream, tower state is gated to RUN MEMBERS (it carries live
 * co-op state) — a non-member / unauth caller gets 403. Never cached.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const runId = String(req.query.runId ?? '');
        const playerName = safeName(String(req.query.playerName ?? ''));
        if (!runId || !playerName) return res.status(400).json({ error: 'Missing run or player.' });
        if (!enforceRateLimit(req, res, 'towers-state', 240, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        const callerSlug = identity.admin ? playerName : identity.name;
        const recoverMissingRun = async () => {
            const lease = await towerBattleLeaseForMember(callerSlug);
            if (lease?.battleId === runId && lease.meta.partyId) {
                await repairStaleTowerPartyLifecycle(lease.meta.partyId);
            } else {
                await activeTowerPartyForPlayer(callerSlug);
            }
            const recovery = await recoverConfirmedMissingTowerBattleLease(runId, callerSlug, {
                beforeConfirmedMissingRelease: async observed => {
                    if (!observed.meta.partyId) {
                        await compensateConfirmedMissingTowerEntry({ hostSlug: callerSlug, runId });
                    }
                },
            });
            return res.status(404).json({
                error: recovery.pending ? 'Run publication is still being confirmed.' : 'Run not found.',
                errorCode: recovery.pending ? 'run-publication-pending' : 'run-unavailable',
                leaseReleased: recovery.released,
            });
        };
        const session = await readSession(runId);
        if (!session) return recoverMissingRun();
        const isMember = identity.admin || session.actors.some(a => a.side === 'squad'
            && a.ai === false
            && a.ownerSlug === callerSlug);
        if (!isMember) return res.status(403).json({ error: 'Not a member of this run.' });

        if (session.runId.startsWith('cboss-')) {
            await refreshClanBossBattleMarkers(runId, towerBattleLeaseMembers(session));
        }

        if (isPublicTowerRun(session) || isSpireRun(session)) {
            const members = towerBattleLeaseMembers(session);
            if (session.rewardSettlementState === 'settled') {
                await releaseTowerBattleLeases(runId, members);
            } else {
                // Polling repairs legacy/partial claims but intentionally does not
                // extend existing lease TTLs or abandoned rooms forever.
                const partyId = (session as TowerSession & { towerPartyId?: string }).towerPartyId;
                const lease = await ensureTowerBattleLeases({ runId, members, ...(partyId ? { partyId } : {}) });
                if (!lease.ok) {
                    return res.status(409).json({
                        error: 'One or more party members is already in another active battle.',
                        errorCode: lease.code,
                        members: lease.members,
                        session,
                    });
                }
            }
        }

        // Co-op liveness: the preflight is PURE. Mutation happens only after a
        // fail-closed lock and fresh read, so a contended poll can never return a
        // locally auto-passed turn that was not persisted.
        let responseSession = session;
        const now = Date.now();
        if (isAfkHumanTurnDue(session, now)) {
            try {
                const refreshed = await withTowerSessionMutation(runId, async () => {
                    const fresh = await readSession(runId);
                    if (fresh && fresh.status === 'active' && autoPassAfkHumans(fresh, now)) {
                        bumpTowerActionVersion(fresh);
                        await writeSession(fresh);
                    }
                    return fresh;
                });
                if (!refreshed) return recoverMissingRun();
                responseSession = refreshed;
            } catch (err) {
                if (!isTowerSessionContention(err)) throw err;
                res.setHeader('Retry-After', String(TOWER_SESSION_RETRY_AFTER_SECONDS));
                return res.status(503).json(towerSessionBusyErrorBody());
            }
        }
        initializeTowerActionVersion(responseSession);

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ session: responseSession });
    } catch (err) {
        console.error('[towers/state]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
