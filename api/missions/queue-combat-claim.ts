import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { combatMissionByKey } from './_mission-catalog.js';
import { canPlayerReceiveMission, missionEligibilityFailureBody } from './_eligibility.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
import { settleSoloPveTerminalUsage } from '../solo-pve/_usage-authority.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { settlePveFightOutcome } from '../pve/_fight-outcome-settlement.js';
import {
    missionCombatBindingKey,
    missionCombatRewardFingerprint,
    settleMissionCombatBinding,
    validateCompletedMissionCombatSession,
    validateSettledMissionCombatSession,
    type MissionCombatBinding,
} from './_authoritative-combat-session.js';
import {
    COMBAT_MISSION_CLAIM_TOKEN_TTL_MS,
    combatMissionClaimTokenKey,
    combatMissionClaimTokenMatches,
    compareSetExactKvRow,
    createCombatMissionClaimToken,
    inspectCombatMissionClaimSettlement,
    combatMissionClaimPaymentMatches,
    parseCombatMissionClaimPaymentReservation,
    parseCombatMissionClaimToken,
    parseSpentCombatMissionClaimToken,
    publishCombatMissionClaimRows,
    retireCombatMissionClaimToken,
} from './_combat-claim-authority.js';

/*
 * Queue a won built-in combat mission for the separate reward-claim step.
 * Every rank requires a completed bound solo-PvE session. The client supplies
 * identity and intent only; the terminal session proves the win and item use.
 * Body: { playerName, missionId, runId }
 */

type SaveChar = Record<string, unknown>;
type QueueOutcome =
    | { queued: false; reason: string }
    | { queued: true; saveVersion: number; character: SaveChar; replayed?: boolean };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'queue-combat-claim', 10, 10_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const missionId = String(body.missionId ?? '').slice(0, 80);
        const runId = String(body.runId ?? '').slice(0, 96);
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only queue your own missions.' });
        }

        const mission = combatMissionByKey(missionId);
        if (!mission) return res.status(200).json({ ok: true, queued: false, reason: 'unknown-mission' });
        if (!runId) {
            return res.status(200).json({ ok: true, queued: false, reason: 'server_authoritative_combat_required' });
        }

        const bindingKey = missionCombatBindingKey(runId);
        const rewardFingerprint = missionCombatRewardFingerprint(mission);
        const initialBinding = await kv.get<MissionCombatBinding>(bindingKey);
        const initialSession = await readSoloPveSession(runId);
        const initialValidation = validateCompletedMissionCombatSession({
            binding: initialBinding,
            session: initialSession,
            playerName,
            mission,
        });
        if (!initialValidation.ok) {
            if (initialValidation.reason !== 'already-settled') {
                return res.status(200).json({ ok: true, queued: false, reason: initialValidation.reason });
            }
            const settledValidation = validateSettledMissionCombatSession({
                binding: initialBinding,
                session: initialSession,
                playerName,
                mission,
            });
            if (!settledValidation.ok) {
                return res.status(200).json({ ok: true, queued: false, reason: settledValidation.reason });
            }
        }

        const usage = await settleSoloPveTerminalUsage(initialSession!, playerName);
        if (!usage.ok) {
            return res.status(409).json({ ok: true, queued: false, reason: usage.error });
        }
        const physicalOutcome = await settlePveFightOutcome(usage.session, playerName);
        if (!physicalOutcome.ok) {
            return res.status(200).json({ ok: true, queued: false, reason: 'physical-outcome-failed' });
        }

        const saveKey = `save:${playerName}`;
        const queueUnderSaveLock = (terminalSession: SoloPveSession) => withKvLock<QueueOutcome>(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as SaveChar | undefined;
            if (!record || !char) return { queued: false, reason: 'no-save' };

            // A payout receipt means the client lost a response after claim.
            // Never recreate spendable authority for that already-paid run.
            const paid = inspectCombatMissionClaimSettlement(char, runId, mission.key, rewardFingerprint);
            if (paid.status === 'conflict') return { queued: false, reason: 'claim-settlement-conflict' };
            if (paid.status === 'replay') {
                return {
                    queued: true,
                    replayed: true,
                    saveVersion: Number(record._saveVersion ?? 0),
                    character: char,
                };
            }
            const eligibility = canPlayerReceiveMission(char, mission);
            if (!eligibility.ok) {
                return { queued: false, reason: String(missionEligibilityFailureBody(eligibility).reason) };
            }

            const pending = Array.isArray(char.pendingCombatMissionClaims)
                ? char.pendingCombatMissionClaims.map(String)
                : [];
            const nextPending = pending.includes(mission.key) ? pending : [...pending, mission.key];
            // The common terminal helper above writes its receipt in the same
            // versioned save as the decrement. This compatibility application
            // is therefore a no-op for the exact receipt and still supports
            // legacy sessions without the common authority fields.
            const chargedChar = applySoloPveUsageCosts(char, terminalSession);
            const nextChar = { ...chargedChar, pendingCombatMissionClaims: nextPending };
            const updated = bumpSaveVersion<Record<string, unknown>>({ ...record, character: nextChar });
            const persisted = mergePreservingImages(updated, record) as Record<string, unknown>;
            const claimTokenKey = combatMissionClaimTokenKey(playerName, mission.key);
            let expectedToken = await kv.get<unknown>(claimTokenKey);
            const activeToken = parseCombatMissionClaimToken(expectedToken);
            const paymentReservation = parseCombatMissionClaimPaymentReservation(expectedToken);
            let spentToken = parseSpentCombatMissionClaimToken(expectedToken);
            if (expectedToken !== null && !activeToken && !paymentReservation && !spentToken) {
                return { queued: false, reason: 'combat-claim-authority-invalid' };
            }
            if (paymentReservation) {
                if (!combatMissionClaimPaymentMatches({
                    reservation: paymentReservation,
                    playerName,
                    missionId: mission.key,
                })) {
                    return { queued: false, reason: 'combat-claim-authority-conflict' };
                }
                const reservedReceipt = inspectCombatMissionClaimSettlement(
                    char,
                    paymentReservation.runId,
                    mission.key,
                    paymentReservation.rewardFingerprint,
                );
                if (reservedReceipt.status === 'conflict') {
                    return { queued: false, reason: 'claim-settlement-conflict' };
                }
                if (paymentReservation.runId !== runId) {
                    if (reservedReceipt.status !== 'replay'
                        || !reservedReceipt.receipt.effects?.completedAt) {
                        return { queued: false, reason: 'combat-claim-payment-in-progress' };
                    }
                    // The prior payout and every post-effect are durable; help a
                    // lost retirement acknowledgement forward so the successor
                    // does not depend on the old mission card still being visible.
                    await retireCombatMissionClaimToken({
                        store: kv,
                        key: claimTokenKey,
                        expected: expectedToken,
                        token: paymentReservation,
                        settlement: reservedReceipt.receipt,
                    });
                    expectedToken = await kv.get<unknown>(claimTokenKey);
                    spentToken = parseSpentCombatMissionClaimToken(expectedToken);
                    if (!spentToken) {
                        return { queued: false, reason: 'combat-claim-authority-conflict' };
                    }
                } else {
                    if (reservedReceipt.status === 'replay'
                        && reservedReceipt.receipt.effects?.completedAt) {
                        return {
                            queued: true,
                            replayed: true,
                            saveVersion: Number(record._saveVersion ?? 0),
                            character: char,
                        };
                    }
                    // An old rolling worker can see the deliberately incompatible
                    // `paying` authority and self-heal the mission-scoped pending
                    // flag. Restore that UI affordance without rolling the durable
                    // reservation back to old-compatible active authority.
                    await compareSetExactKvRow(kv, saveKey, record, persisted);
                    return {
                        queued: true,
                        saveVersion: Number(updated._saveVersion ?? 0),
                        character: persisted.character as SaveChar,
                    };
                }
            }
            if (spentToken) {
                const prior = inspectCombatMissionClaimSettlement(
                    char,
                    spentToken.runId,
                    spentToken.missionId,
                    spentToken.rewardFingerprint,
                );
                if ((spentToken.playerName && spentToken.playerName !== playerName)
                    || spentToken.missionId !== mission.key
                    || prior.status !== 'replay'
                    || !prior.receipt.effects?.completedAt) {
                    return { queued: false, reason: 'combat-claim-authority-conflict' };
                }
                if (spentToken.runId === runId) {
                    return {
                        queued: true,
                        replayed: true,
                        saveVersion: Number(record._saveVersion ?? 0),
                        character: char,
                    };
                }
            }
            if (activeToken) {
                if (!combatMissionClaimTokenMatches({
                    token: activeToken,
                    playerName,
                    missionId: mission.key,
                    enemyProfileId: mission.aiProfileId,
                    rewardFingerprint,
                })) {
                    return { queued: false, reason: 'combat-claim-authority-conflict' };
                }
                if (activeToken.runId !== runId) {
                    // A second completed run must not replace the sole authority
                    // for an earlier unpaid win. Once the earlier receipt is in
                    // this same character row it is safe for a newer run to take
                    // the mission-scoped token key, even if cleanup lost its ACK.
                    const prior = inspectCombatMissionClaimSettlement(
                        char,
                        activeToken.runId,
                        mission.key,
                        rewardFingerprint,
                    );
                    if (prior.status !== 'replay' || !prior.receipt.effects?.completedAt) {
                        return { queued: false, reason: 'combat-claim-already-pending' };
                    }
                }
            }
            const token = createCombatMissionClaimToken({
                playerName,
                runId,
                missionId: mission.key,
                enemyProfileId: mission.aiProfileId,
                rewardFingerprint,
                wonAt: terminalSession.terminalEvidence?.finishedAt ?? Date.now(),
            });
            await publishCombatMissionClaimRows({
                store: kv,
                tokenKey: claimTokenKey,
                expectedToken,
                token,
                saveKey,
                expectedSave: record,
                saveRecord: persisted,
            });
            const persistedChar = persisted.character as SaveChar;
            return {
                queued: true,
                saveVersion: Number(updated._saveVersion ?? 0),
                character: persistedChar,
            };
        }, { failClosed: true, ttlSec: 15 });

        const outcome = await withKvLock<QueueOutcome>(bindingKey, async () => {
            const binding = await kv.get<MissionCombatBinding>(bindingKey);
            const session = await readSoloPveSession(runId);
            const validation = validateCompletedMissionCombatSession({ binding, session, playerName, mission });
            let bindingAuthority: MissionCombatBinding;
            let metadataAlreadySettled = false;
            if (!validation.ok) {
                if (validation.reason !== 'already-settled') return { queued: false, reason: validation.reason };
                const settled = validateSettledMissionCombatSession({ binding, session, playerName, mission });
                if (!settled.ok) return { queued: false, reason: settled.reason };
                bindingAuthority = settled.binding;
                metadataAlreadySettled = true;
            } else {
                bindingAuthority = validation.binding;
            }

            const queued = await queueUnderSaveLock(session!);
            if (!queued.queued) return queued;

            if (session!.settlementState !== 'settled') {
                await writeSoloPveSession(withSoloPveSettlementReceipt(session!, {
                    kind: 'mission-queue',
                    id: `${mission.key}:${runId}`,
                    settledAt: Date.now(),
                    rewards: { missionId: mission.key, queued: true },
                }));
            }
            const now = Date.now();
            const settledBinding = metadataAlreadySettled
                ? bindingAuthority
                : settleMissionCombatBinding(bindingAuthority, now);
            // Every successful replay refreshes the token TTL, so keep the
            // completed binding repairable for that same fresh horizon.
            const claimHorizon = now + COMBAT_MISSION_CLAIM_TOKEN_TTL_MS;
            const durableBinding = {
                ...settledBinding,
                expiresAt: Math.max(settledBinding.expiresAt, claimHorizon),
            };
            await compareSetExactKvRow(kv, bindingKey, binding ?? null, durableBinding, {
                ex: Math.max(1, Math.ceil((durableBinding.expiresAt - now) / 1000)),
            });
            return queued;
        }, { failClosed: true, ttlSec: 15 });

        if (!outcome.queued) return res.status(200).json({ ok: true, queued: false, reason: outcome.reason });
        return res.status(200).json({
            ok: true,
            queued: true,
            character: outcome.character,
            _saveVersion: outcome.saveVersion,
            replayed: outcome.replayed === true,
        });
    } catch (err) {
        console.error('[missions/queue-combat-claim]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
