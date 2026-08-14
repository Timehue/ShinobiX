import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName, setSafeRecordValue } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import {
    readSession,
    settleFloorForMember,
    settleAssistForAlly,
    settleSpireForMember,
    settleConsumedItemsForMember,
    isSpireRun,
    isPublicTowerRun,
    type SettleResult,
    type ConsumedItemsResult,
} from './_tower-store.js';
import { closeTowerPartyRun, towerPartyHumanMembers, type StoredTowerParty } from './_party.js';
import type { TowerSession } from './_tower-session.js';
import { recordTowerRunSettled } from './_telemetry.js';
import { refreshTowerBattleLeases, releaseTowerBattleLeases, towerBattleLeaseMembers } from './_battle-lease.js';
import { projectTowerSettlementState } from './_settlement-projection.js';
import {
    isTowerSessionContention,
    TOWER_SESSION_RETRY_AFTER_SECONDS,
    towerSessionBusyErrorBody,
} from './_session-mutation.js';
import { publishTowerSessionKick } from './_realtime.js';
import { kickTowerPlayers } from '../_realtime/notify.js';

type PartyBoundSession = TowerSession & { towerPartyId?: string };

/*
 * POST /api/towers/settle — finalize a completed tower run.
 *
 * Fully server-authoritative + idempotent: consumable/throwable spends are deducted once for
 * any done run, while settleFloorForMember / settleAssistForAlly each re-verify the session
 * (status 'done' + squad win), resolve the floor from the catalog by id, compute the score,
 * and credit at most once (NX receipts + the permanent first-clear gate). Safe to call
 * repeatedly. Body: { runId, playerName }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '');
        if (!playerName || !runId) return res.status(400).json({ error: 'Missing player or run.' });
        if (!enforceRateLimit(req, res, 'towers-settle', 30, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        const session = await readSession(runId);
        if (!session) return res.status(404).json({ error: 'Run not found.' });

        const callerSlug = identity.admin ? null : identity.name;
        const isMember = identity.admin || session.actors.some(a => a.side === 'squad'
            && a.ai === false
            && a.ownerSlug === callerSlug);
        if (!isMember) return res.status(403).json({ error: 'Not a member of this run.' });

        // Endless Spire runs settle through the weekly spire channel (best-tier-per-week); the
        // Public Story floors keep the one-time first-clear channel. A legacy borrowed ally is
        // deliberately AI-marked at start and must never inherit full Spire progression.
        const spire = isSpireRun(session);
        if (!spire && !isPublicTowerRun(session)) {
            // Clan-boss assaults and embedded/reserved solo encounters have their
            // own settlement endpoints. Refuse them before even consumable writes.
            return res.status(400).json({ error: 'Run is not a public Battle Tower session.' });
        }
        const leaseMembers = towerBattleLeaseMembers(session);
        if (session.rewardSettlementState !== 'settled') {
            const towerPartyId = (session as PartyBoundSession).towerPartyId;
            const lease = await refreshTowerBattleLeases({
                runId,
                members: leaseMembers,
                ...(towerPartyId ? { partyId: towerPartyId } : {}),
            });
            if (!lease.ok) {
                return res.status(409).json({
                    error: 'One or more party members is already in another active battle.',
                    errorCode: lease.code,
                    members: lease.members,
                    settled: false,
                });
            }
        }
        const results: Record<string, SettleResult> = {};
        const consumables: Record<string, ConsumedItemsResult> = {};
        for (const a of session.actors.filter(x => x.side === 'squad')) {
            const slug = a.ownerSlug;
            if (!slug) continue;
            setSafeRecordValue(consumables, slug, await settleConsumedItemsForMember({ session, slug }));
            setSafeRecordValue(results, slug, spire
                ? a.ai
                    ? { paid: false, reason: 'unverified-assist' }
                    : await settleSpireForMember({ session, slug })
                : a.ai
                    ? await settleAssistForAlly({ session, slug })
                    : await settleFloorForMember({ session, slug }));
        }
        let authoritativeSession = session;
        if (session.status === 'done' && session.rewardSettlementState !== 'settled') {
            const retryableReasons = new Set(['contended', 'no-save', 'unknown', 'invalid-receipt']);
            const stable = [
                ...Object.values(results).map(result => result.reason),
                ...Object.values(consumables).map(result => result.reason),
            ].every(reason => !reason || !retryableReasons.has(reason));
            try {
                const projected = await projectTowerSettlementState(runId, stable);
                if (!projected) return res.status(404).json({ error: 'Run not found.', settled: false });
                authoritativeSession = projected;
            } catch (err) {
                if (!isTowerSessionContention(err)) throw err;
                res.setHeader('Retry-After', String(TOWER_SESSION_RETRY_AFTER_SECONDS));
                return res.status(503).json({ ...towerSessionBusyErrorBody(), settled: false });
            }
        }
        let closedParty: StoredTowerParty | null = null;
        if (authoritativeSession.status === 'done' && authoritativeSession.rewardSettlementState === 'settled') {
            const towerPartyId = (authoritativeSession as PartyBoundSession).towerPartyId;
            if (towerPartyId) closedParty = await closeTowerPartyRun(towerPartyId, authoritativeSession.runId).catch(() => null);
            await releaseTowerBattleLeases(runId, leaseMembers).catch(() => undefined);
            await recordTowerRunSettled(authoritativeSession);
            publishTowerSessionKick(authoritativeSession, 'settled');
            if (closedParty) {
                kickTowerPlayers(towerPartyHumanMembers(closedParty).map(member => member.slug), {
                    channel: 'party',
                    reason: 'closed',
                    partyId: closedParty.id,
                    version: closedParty.version,
                });
            }
        }
        // Return only the caller's committed character. The results map may cover
        // multiple squad members, but their private save data must not be exposed.
        const responseSlug = callerSlug ?? safeName(playerName);
        const committed = await kv.get<Record<string, unknown>>(`save:${responseSlug}`);
        return res.status(200).json({
            runId,
            winner: authoritativeSession.winner,
            // Explicit receipt/stability authority for clients. Never infer this
            // from individual paid:false reasons (many are successful replays).
            settled: authoritativeSession.rewardSettlementState === 'settled',
            results,
            consumables,
            character: committed?.character ?? null,
            _saveVersion: Number(committed?._saveVersion ?? 0),
        });
    } catch (err) {
        console.error('[towers/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
