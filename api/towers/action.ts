import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { floorForSession } from './_session-floor.js';
import { activeActor } from './_tower-session.js';
import { applyAction, endTurn, isTowerActionType, runAiUntilHuman, type TowerAction } from './_engine.js';
import { makeRng } from './_sim.js';
import { isPublicTowerRun, isSpireRun, readSession, writeSession } from './_tower-store.js';
import { autoPassAfkHumans, stampTurnClock } from './_tower-mp.js';
import { recordClanBossContribution, snapshotContributionState } from '../clan-boss/_contribution.js';
import {
    bumpTowerActionVersion,
    commitTowerActionMetadata,
    inspectTowerActionCommand,
    towerActionVersion,
} from './_action-idempotency.js';
import {
    refreshClanBossBattleMarkers,
    refreshTowerBattleLeases,
    releaseTowerBattleLeases,
    towerBattleLeaseMembers,
} from './_battle-lease.js';
import type { TowerSession } from './_tower-session.js';
import {
    isTowerSessionContention,
    TOWER_SESSION_RETRY_AFTER_SECONDS,
    towerSessionBusyErrorBody,
    withTowerSessionMutation,
} from './_session-mutation.js';
import { publishTowerSessionKick } from './_realtime.js';

function towerActionCommandFingerprint(
    runId: string,
    actor: string,
    body: Record<string, unknown>,
): string {
    const type = String(body.type ?? '');
    const intent: Record<string, unknown> = { runId, actor, type };
    if (type === 'move' || type === 'dash') intent.tile = Math.floor(Number(body.tile));
    else if (type === 'attack' || type === 'clear') intent.targetId = String(body.targetId ?? '');
    else if (type === 'jutsu') {
        intent.jutsuId = String(body.jutsuId ?? '');
        if (body.targetId !== undefined) intent.targetId = String(body.targetId);
        if (body.tile !== undefined) intent.tile = Math.floor(Number(body.tile));
    } else if (type === 'weapon') {
        intent.targetId = String(body.targetId ?? '');
        if (body.itemId) intent.itemId = String(body.itemId);
    } else if (type === 'item' && body.itemId) {
        intent.itemId = String(body.itemId);
    }
    return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

/*
 * POST /api/towers/action — submit ONE action for the human's actor on their turn.
 *
 * Server-authoritative: the move is validated by the engine against the tower:<runId>
 * record; the caller may only act for THEIR OWN squad actor on its turn. A 'wait' ends the
 * turn and advances all AI (allies + enemies) until the human is up again or the floor
 * resolves. `moveToken` and `expectedVersion` are additive: legacy callers may
 * omit them, while reconnect-safe callers get idempotent replay + stale-version
 * recovery. Body: { runId, playerName, type, targetId?, tile?, jutsuId?,
 * moveToken?, expectedVersion? }.
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
        if (!enforceRateLimit(req, res, 'towers-action', 120, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        let realtimeSession: TowerSession | null = null;
        let realtimeReason: 'action' | 'afk' = 'action';

        // Serialize the whole read-modify-write on the shared session so a concurrent
        // /state AFK-pass or /join can't clobber this turn write (lost-update / board
        // desync in a 2+ human run). Re-read INSIDE the fail-closed lock so we
        // mutate the freshest session or reject cleanly before any action/receipt.
        const outcome = await withTowerSessionMutation(runId, async (): Promise<{ status: number; body: unknown }> => {
            const session = await readSession(runId);
            if (!session) return { status: 404, body: { error: 'Run not found.' } };

            // Membership is checked before replay recovery. A completed action may
            // have advanced the turn (or ended the run), so active-actor ownership
            // cannot be the replay authorization gate.
            const callerSlug = identity.admin ? null : identity.name;
            const commandActor = identity.admin ? `admin:${playerName}` : identity.name;
            const isMember = identity.admin || session.actors.some(a => a.side === 'squad'
                && a.ai === false
                && a.ownerSlug === callerSlug);
            if (!isMember) return { status: 403, body: { error: 'Not a member of this run.' } };

            if (session.runId.startsWith('cboss-')) {
                await refreshClanBossBattleMarkers(runId, towerBattleLeaseMembers(session));
            }

            if ((isPublicTowerRun(session) || isSpireRun(session)) && session.rewardSettlementState === 'settled') {
                await releaseTowerBattleLeases(runId, towerBattleLeaseMembers(session));
            } else if (isPublicTowerRun(session) || isSpireRun(session)) {
                const partyId = (session as TowerSession & { towerPartyId?: string }).towerPartyId;
                const lease = await refreshTowerBattleLeases({
                    runId,
                    members: towerBattleLeaseMembers(session),
                    ...(partyId ? { partyId } : {}),
                });
                if (!lease.ok) {
                    return {
                        status: 409,
                        body: {
                            applied: false,
                            reason: 'member-busy',
                            members: lease.members,
                            session,
                            currentVersion: towerActionVersion(session),
                        },
                    };
                }
            }

            const commandFingerprint = towerActionCommandFingerprint(runId, commandActor, body);
            const command = inspectTowerActionCommand(session, {
                moveToken: body.moveToken,
                expectedVersion: body.expectedVersion,
                commandFingerprint,
            });
            if (command.status === 'invalid-token') {
                return { status: 400, body: { applied: false, reason: 'invalid-move-token', session, currentVersion: command.currentVersion } };
            }
            if (command.status === 'invalid-version') {
                return { status: 400, body: { applied: false, reason: 'invalid-expected-version', session, currentVersion: command.currentVersion } };
            }
            // A duplicate token is an acknowledged success even when the caller's
            // expected version is now stale. This is the lost-response recovery path.
            if (command.status === 'replay') {
                return { status: 200, body: { applied: true, replayed: true, session, currentVersion: command.currentVersion } };
            }
            if (command.status === 'conflict') {
                return {
                    status: 409,
                    body: { applied: false, reason: 'move-token-conflict', session, currentVersion: command.currentVersion },
                };
            }
            if (command.status === 'stale') {
                return { status: 200, body: { applied: false, reason: 'stale-version', session, currentVersion: command.currentVersion } };
            }
            if (session.status !== 'active') {
                return { status: 200, body: { applied: false, reason: 'session-done', session, currentVersion: command.currentVersion } };
            }

            // Fail closed. A malformed/stale client command must never become an implicit
            // `wait`, forfeit the player's turn, or commit an idempotency receipt.
            const type = String(body.type ?? '');
            if (!isTowerActionType(type)) {
                return {
                    status: 400,
                    body: { applied: false, reason: 'invalid-action-type', session, currentVersion: command.currentVersion },
                };
            }

            const now = Date.now();
            // Co-op: clear any AFK player(s) blocking the queue before we read whose turn it is.
            const afkAdvanced = autoPassAfkHumans(session, now);
            if (afkAdvanced) bumpTowerActionVersion(session);

            const actor = activeActor(session);
            const owns = !!actor && (identity.admin || (actor.ai === false && actor.hp > 0 && actor.ownerSlug === callerSlug));
            if (!owns) {
                if (afkAdvanced) {
                    await writeSession(session); // persist the AFK pass even if it's not our turn
                    realtimeSession = session;
                    realtimeReason = 'afk';
                }
                return {
                    status: 409,
                    body: {
                        error: 'Not your turn.',
                        applied: false,
                        reason: 'not-your-turn',
                        session,
                        currentVersion: towerActionVersion(session),
                    },
                };
            }

            const floor = floorForSession(session);
            if (!floor) {
                if (afkAdvanced) {
                    await writeSession(session);
                    realtimeSession = session;
                    realtimeReason = 'afk';
                }
                return { status: 500, body: { error: 'Floor missing.' } };
            }

            const rng = makeRng(session.seed);
            const token = command.moveToken ? { token: command.moveToken } : {};
            // Build the action server-side with actorId = the verified active actor (no client spoof).
            const action: TowerAction =
                type === 'move' ? { actorId: actor.id, type: 'move', tile: Math.floor(Number(body.tile)), ...token }
                : type === 'dash' ? { actorId: actor.id, type: 'dash', tile: Math.floor(Number(body.tile)), ...token }
                : type === 'attack' ? { actorId: actor.id, type: 'attack', targetId: String(body.targetId ?? ''), ...token }
                : type === 'jutsu' ? { actorId: actor.id, type: 'jutsu', jutsuId: String(body.jutsuId ?? ''), targetId: body.targetId !== undefined ? String(body.targetId) : undefined, tile: body.tile !== undefined ? Math.floor(Number(body.tile)) : undefined, ...token }
                : type === 'weapon' ? { actorId: actor.id, type: 'weapon', targetId: String(body.targetId ?? ''), itemId: body.itemId ? String(body.itemId) : undefined, ...token }
                : type === 'item' ? { actorId: actor.id, type: 'item', itemId: body.itemId ? String(body.itemId) : undefined, ...token }
                : type === 'heal' ? { actorId: actor.id, type: 'heal', ...token }
                : type === 'cleanse' ? { actorId: actor.id, type: 'cleanse', ...token }
                : type === 'clear' ? { actorId: actor.id, type: 'clear', targetId: String(body.targetId ?? ''), ...token }
                : type === 'summon' ? { actorId: actor.id, type: 'summon', ...token }
                : { actorId: actor.id, type: 'wait', ...token };

            const contributionBefore = snapshotContributionState(session);
            const result = applyAction(session, floor, action, rng);
            if (!result.applied) {
                if (afkAdvanced) {
                    await writeSession(session);
                    realtimeSession = session;
                    realtimeReason = 'afk';
                }
                return { status: 200, body: { applied: false, reason: result.reason, session, currentVersion: towerActionVersion(session) } };
            }
            recordClanBossContribution(session, actor.id, contributionBefore);
            if (action.type === 'wait') {
                endTurn(session, floor);
                runAiUntilHuman(session, floor, rng); // run allies + enemies until the human is up / done
            }
            stampTurnClock(session, now); // (re)start the AFK clock for whoever is up now
            commitTowerActionMetadata(session, command.moveToken, commandFingerprint);
            await writeSession(session);
            realtimeSession = session;
            realtimeReason = 'action';
            return { status: 200, body: { applied: true, replayed: false, session, currentVersion: towerActionVersion(session) } };
        });
        if (realtimeSession) publishTowerSessionKick(realtimeSession, realtimeReason);
        return res.status(outcome.status).json(outcome.body);
    } catch (err) {
        if (isTowerSessionContention(err)) {
            res.setHeader('Retry-After', String(TOWER_SESSION_RETRY_AFTER_SECONDS));
            return res.status(503).json(towerSessionBusyErrorBody());
        }
        console.error('[towers/action]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
