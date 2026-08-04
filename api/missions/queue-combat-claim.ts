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
import type { SoloPveSession } from '../solo-pve/_session.js';
import { settlePveFightOutcome } from '../pve/_fight-outcome-settlement.js';
import {
    missionCombatBindingKey,
    MISSION_COMBAT_SESSION_TTL_SECONDS,
    settleMissionCombatBinding,
    validateCompletedMissionCombatSession,
    validateSettledMissionCombatSession,
    type MissionCombatBinding,
} from './_authoritative-combat-session.js';

/*
 * Queue a won built-in combat mission for the separate reward-claim step.
 * Every rank requires a completed bound solo-PvE session. The client supplies
 * identity and intent only; the terminal session proves the win and item use.
 * Body: { playerName, missionId, runId }
 */

const COMBAT_CLAIM_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const COMBAT_USAGE_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

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

        const initialBinding = await kv.get<MissionCombatBinding>(missionCombatBindingKey(runId));
        const initialSession = await readSoloPveSession(runId);
        const readQueuedReplay = async (
            binding: MissionCombatBinding | null | undefined,
            session: SoloPveSession | null | undefined,
        ): Promise<QueueOutcome> => {
            const validation = validateSettledMissionCombatSession({ binding, session, playerName, mission });
            if (!validation.ok) return { queued: false, reason: validation.reason };
            const physicalOutcome = await settlePveFightOutcome(session!, playerName);
            if (!physicalOutcome.ok) return { queued: false, reason: 'physical-outcome-failed' };
            const [record, claimToken] = await Promise.all([
                kv.get<Record<string, unknown>>(`save:${playerName}`),
                kv.get<{ authority?: string; runId?: string; missionId?: string }>(`missions:combat-claim:${playerName}:${mission.key}`),
            ]);
            const char = record?.character as SaveChar | undefined;
            const pending = Array.isArray(char?.pendingCombatMissionClaims)
                ? char.pendingCombatMissionClaims.map(String)
                : [];
            if (!record || !char
                || !pending.includes(mission.key)
                || claimToken?.authority !== 'server-combat'
                || claimToken.runId !== runId
                || claimToken.missionId !== mission.key) {
                return { queued: false, reason: 'settlement-incomplete' };
            }
            return {
                queued: true,
                replayed: true,
                saveVersion: Number(record._saveVersion ?? 0),
                character: char,
            };
        };
        const initialValidation = validateCompletedMissionCombatSession({
            binding: initialBinding,
            session: initialSession,
            playerName,
            mission,
        });
        if (!initialValidation.ok) {
            if (initialValidation.reason === 'already-settled') {
                const replay = await readQueuedReplay(initialBinding, initialSession);
                if (replay.queued) {
                    return res.status(200).json({
                        ok: true,
                        queued: true,
                        replayed: true,
                        character: replay.character,
                        _saveVersion: replay.saveVersion,
                    });
                }
            }
            return res.status(200).json({ ok: true, queued: false, reason: initialValidation.reason });
        }

        const physicalOutcome = await settlePveFightOutcome(initialSession!, playerName);
        if (!physicalOutcome.ok) {
            return res.status(200).json({ ok: true, queued: false, reason: 'physical-outcome-failed' });
        }

        const saveKey = `save:${playerName}`;
        const queueUnderSaveLock = (terminalSession: SoloPveSession) => withKvLock<QueueOutcome>(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as SaveChar | undefined;
            if (!record || !char) return { queued: false, reason: 'no-save' };
            const eligibility = canPlayerReceiveMission(char, mission);
            if (!eligibility.ok) {
                return { queued: false, reason: String(missionEligibilityFailureBody(eligibility).reason) };
            }

            const pending = Array.isArray(char.pendingCombatMissionClaims)
                ? char.pendingCombatMissionClaims.map(String)
                : [];
            const nextPending = pending.includes(mission.key) ? pending : [...pending, mission.key];
            // A private NX receipt makes the cost idempotent across an interrupted
            // metadata write. It is reserved while holding the save lock; on an
            // ordinary write failure we release it so a safe retry can finish.
            const usageReceiptKey = `solo-pve-usage:mission:${runId}`;
            const firstUsageSettlement = await kv.set(usageReceiptKey, {
                runId,
                playerName,
                missionId: mission.key,
                at: Date.now(),
            }, { nx: true, ex: COMBAT_USAGE_RECEIPT_TTL_SECONDS });
            const chargedChar = firstUsageSettlement === 'OK'
                ? applySoloPveUsageCosts(char, terminalSession)
                : char;
            const nextChar = { ...chargedChar, pendingCombatMissionClaims: nextPending };
            const updated = bumpSaveVersion<Record<string, unknown>>({ ...record, character: nextChar });

            try {
                await kv.set(`missions:combat-claim:${playerName}:${mission.key}`, {
                    authority: 'server-combat',
                    runId,
                    missionId: mission.key,
                    wonAt: terminalSession.terminalEvidence?.finishedAt ?? Date.now(),
                }, { ex: COMBAT_CLAIM_TOKEN_TTL_SECONDS });
                await kv.set(saveKey, mergePreservingImages(updated, record));
            } catch (error) {
                if (firstUsageSettlement === 'OK') await kv.del(usageReceiptKey).catch(() => undefined);
                throw error;
            }
            return {
                queued: true,
                saveVersion: Number(updated._saveVersion ?? 0),
                character: nextChar,
            };
        });

        const outcome = await withKvLock<QueueOutcome>(missionCombatBindingKey(runId), async () => {
            const binding = await kv.get<MissionCombatBinding>(missionCombatBindingKey(runId));
            const session = await readSoloPveSession(runId);
            const validation = validateCompletedMissionCombatSession({ binding, session, playerName, mission });
            if (!validation.ok) {
                if (validation.reason === 'already-settled') return readQueuedReplay(binding, session);
                return { queued: false, reason: validation.reason };
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
            await kv.set(
                missionCombatBindingKey(runId),
                settleMissionCombatBinding(validation.binding),
                { ex: MISSION_COMBAT_SESSION_TTL_SECONDS },
            );
            return queued;
        }, { failClosed: true });

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
