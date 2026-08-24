import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readSession, getTowerInvite, clearTowerInvite } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';
import { isMpvpLeaseMode } from '../_tower-battle-guard.js';
import {
    ensureTowerBattleLeases,
    recoverConfirmedMissingTowerBattleLease,
    releaseTowerBattleLeases,
    towerBattleLeaseForMember,
    towerBattleLeaseMembers,
} from './_battle-lease.js';
import { activeTowerPartyForPlayer, repairStaleTowerPartyLifecycle } from './_party.js';
import { compensateConfirmedMissingTowerEntry } from './_entry-recovery.js';

/** A KO changes turn eligibility; borrowed AI ownership never grants recovery access. */
export function isDiscoverableTowerRun(session: TowerSession | null, slug: string): boolean {
    return !!session
        && (session.status === 'active'
            || (session.status === 'done' && session.rewardSettlementState !== 'settled'))
        && session.actors.some(actor => actor.side === 'squad'
            && actor.ai === false
            && actor.ownerSlug === slug);
}

/**
 * GET /api/towers/my-run?playerName=... discovers an active run or a completed
 * run whose authoritative settlement still needs a retry. Membership is always
 * re-verified against the server session.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing player.' });
        if (!enforceRateLimit(req, res, 'towers-myrun', 120, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const slug = identity.admin ? playerName : identity.name;
        res.setHeader('Cache-Control', 'no-store');

        const activeParty = await activeTowerPartyForPlayer(slug);
        const [inviteRunId, battleLease] = await Promise.all([
            getTowerInvite(slug),
            towerBattleLeaseForMember(slug),
        ]);
        const runId = battleLease?.battleId ?? activeParty?.launch?.runId ?? inviteRunId;
        if (!runId) return res.status(200).json({ runId: null });

        // BOTH Tower MPvP sub-modes — the open Team Arena queue and a bound
        // clan-war 2v2 — own the same account-wide battle lease but persist in
        // the match store, never as a `tower:<runId>` row. Falling through would
        // read that intentionally absent row as a crashed Story launch and
        // release a perfectly live match after publication grace. Clients follow
        // this explicit pointer through /api/towers/pvp-state; `pvpMatchKind`
        // routes a clan-war fight to its own shell, not the Battle Towers lobby.
        if (isMpvpLeaseMode(battleLease?.meta.mode)) {
            return res.status(200).json({
                runId: null,
                pvpMatchId: battleLease!.battleId,
                pvpMatchKind: battleLease!.meta.mode === 'clan-war-mpvp' ? 'clan-war' : 'public-queue',
            });
        }

        // A thrown storage read reaches the outer 500 and preserves the lease.
        // Only an authoritative null enters confirmed-missing recovery.
        const session = await readSession(runId);
        if (!isDiscoverableTowerRun(session, slug)) {
            if (!session && battleLease?.battleId === runId && battleLease.meta.partyId) {
                await repairStaleTowerPartyLifecycle(battleLease.meta.partyId);
            }
            const recovery = !session
                ? await recoverConfirmedMissingTowerBattleLease(runId, slug, {
                    beforeConfirmedMissingRelease: async observed => {
                        if (!observed.meta.partyId) {
                            await compensateConfirmedMissingTowerEntry({ hostSlug: slug, runId });
                        }
                    },
                })
                : { released: false, pending: false };
            if (session?.rewardSettlementState === 'settled') {
                await releaseTowerBattleLeases(runId, [slug]);
            }
            await clearTowerInvite(slug).catch(() => undefined);
            return res.status(200).json({
                runId: recovery.pending ? runId : null,
                ...(recovery.pending ? { recoveryPending: true } : {}),
                ...(recovery.released ? { leaseReleased: true } : {}),
            });
        }

        // The guard above verifies both presence and discoverable membership;
        // retain a local concrete type without making its false branch claim
        // that every non-discoverable (for example settled) session is null.
        const liveSession = session as TowerSession;
        const partyId = (liveSession as TowerSession & { towerPartyId?: string }).towerPartyId;
        const lease = await ensureTowerBattleLeases({
            runId,
            members: towerBattleLeaseMembers(liveSession),
            ...(partyId ? { partyId } : {}),
        });
        return res.status(200).json({
            runId,
            session: liveSession,
            ...(lease.ok ? {} : { leaseConflict: true, members: lease.members }),
        });
    } catch (err) {
        console.error('[towers/my-run]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
