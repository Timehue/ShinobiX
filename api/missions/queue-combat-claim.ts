import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { combatMissionByKey } from './_mission-catalog.js';
import {
    clientTrustedCombatMissionRewardAllowed,
    COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON,
} from '../_release-flags.js';
import { canPlayerReceiveMission, missionEligibilityFailureBody } from './_eligibility.js';
import { readSession, settleConsumedItemsForMember } from '../towers/_tower-store.js';
import {
    missionCombatBindingKey,
    MISSION_COMBAT_SESSION_TTL_SECONDS,
    settleMissionCombatBinding,
    validateCompletedMissionCombatSession,
    type MissionCombatBinding,
} from './_authoritative-combat-session.js';

/*
 * /api/missions/queue-combat-claim — POST only
 *
 * Server-side "queue" for a won combat mission. Replaces the old model where the
 * Arena win wrote pendingCombatMissionClaims onto the LOCAL character and hoped
 * the debounced autosave (and no save-conflict refetch) persisted it before the
 * player hit "Claim Reward". That race lost claims: the claim step
 * (/api/missions/claim-mission) rejects `not-queued` unless the queue is already
 * on the SERVER, so a quick claim/refresh — or a 409 refetch that discarded the
 * unsaved flag — dropped the mission and its goal credit.
 *
 * This endpoint makes the queue authoritative + durable in one server call under
 * the save lock:
 *   1. mints a single-use KV token  missions:combat-claim:<player>:<missionKey>
 *      (the security gate claim-mission consumes atomically — the client can't
 *      forge it via the save endpoint, and it can't be replayed);
 *   2. writes pendingCombatMissionClaims onto the SAVED character (durable UI
 *      record: rides the save load so the "Claim Reward" button survives a
 *      refresh) and bumps _saveVersion so a stale client autosave 409s +
 *      reconciles onto the queued state instead of clobbering it.
 *
 * Legacy E/D PvE remains client-resolved; its payout is deliberately capped.
 * so like raid-start this still trusts the client's "I won this mission" — the
 * C/B/A/S instead require a completed bound Tower run. The server validates the
 * sealed roster, final state, winner, mission id, membership, and replay status.
 *
 * Body: { playerName, missionId, runId? }
 */

// A player has time to walk back to the Mission Hall and claim. The durable
// pending flag keeps the UI visible; higher ranks still require this private
// authority token, so the client can never promote that flag into a payout.
const COMBAT_CLAIM_TOKEN_TTL_SECONDS = 6 * 60 * 60;

type SaveChar = Record<string, unknown>;

type QueueOutcome =
    | { queued: false; reason: string }
    | { queued: true; saveVersion: number; character: SaveChar };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
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

        const def = combatMissionByKey(missionId);
        // Unknown / creator-authored ids aren't in the combat catalog. Return 200
        // (not an error): the client keeps its local flag + autosave fallback and
        // the legacy claim path still pays creator missions.
        if (!def) return res.status(200).json({ ok: true, queued: false, reason: 'unknown-mission' });
        const legacyClientAllowed = clientTrustedCombatMissionRewardAllowed(def);
        if (!legacyClientAllowed && !runId) {
            return res.status(200).json({
                ok: true,
                queued: false,
                reason: COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON,
            });
        }

        let authoritativeBinding: MissionCombatBinding | null = null;
        if (runId) {
            const binding = await kv.get<MissionCombatBinding>(missionCombatBindingKey(runId));
            const session = await readSession(runId);
            const validation = validateCompletedMissionCombatSession({ binding, session, playerName, mission: def });
            if (!validation.ok) return res.status(200).json({ ok: true, queued: false, reason: validation.reason });
            authoritativeBinding = validation.binding;
        }

        const saveKey = `save:${playerName}`;

        // Read-modify-write of the save goes under the same lock the save
        // endpoint uses so a concurrent autosave can't clobber the queued flag.
        const queueUnderSaveLock = () => withKvLock<QueueOutcome>(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as SaveChar | undefined;
            if (!record || !char) return { queued: false, reason: 'no-save' };
            const eligibility = canPlayerReceiveMission(char, def);
            if (!eligibility.ok) return { queued: false, reason: missionEligibilityFailureBody(eligibility).reason };

            const pending = Array.isArray(char.pendingCombatMissionClaims) ? char.pendingCombatMissionClaims as string[] : [];
            const nextPending = pending.includes(def.key) ? pending : [...pending, def.key];
            const nextChar = { ...char, pendingCombatMissionClaims: nextPending };
            const updated: Record<string, unknown> = bumpSaveVersion({ ...record, character: nextChar });
            await kv.set(saveKey, mergePreservingImages(updated, record));

            // Mint the single-use claim gate. Set (not NX) so re-queuing the same
            // mission refreshes the TTL rather than leaving a near-expired token.
            const tokenKey = `missions:combat-claim:${playerName}:${def.key}`;
            await kv.set(tokenKey, authoritativeBinding
                ? { authority: 'server-combat', runId, missionId: def.key, wonAt: Date.now() }
                : { authority: 'legacy-client', missionId: def.key, queuedAt: Date.now() },
            { ex: COMBAT_CLAIM_TOKEN_TTL_SECONDS }).catch(() => undefined);

            return { queued: true, saveVersion: Number(updated._saveVersion ?? 0), character: nextChar };
        });

        const outcome = authoritativeBinding
            ? await withKvLock<QueueOutcome>(missionCombatBindingKey(runId), async () => {
                const freshBinding = await kv.get<MissionCombatBinding>(missionCombatBindingKey(runId));
                const freshSession = await readSession(runId);
                const freshValidation = validateCompletedMissionCombatSession({
                    binding: freshBinding,
                    session: freshSession,
                    playerName,
                    mission: def,
                });
                if (!freshValidation.ok) return { queued: false, reason: freshValidation.reason };
                const queued = await queueUnderSaveLock();
                if (queued.queued) {
                    // The battle engine, not the client, recorded these uses.
                    // Deduct them through the same per-run receipt path as Tower
                    // and Weekly Boss so retries cannot charge an item twice.
                    await settleConsumedItemsForMember({ session: freshSession!, slug: playerName });
                    await kv.set(
                        missionCombatBindingKey(runId),
                        settleMissionCombatBinding(freshValidation.binding),
                        { ex: MISSION_COMBAT_SESSION_TTL_SECONDS },
                    );
                }
                return queued;
            }, { failClosed: true })
            : await queueUnderSaveLock();

        if (!outcome.queued) return res.status(200).json({ ok: true, queued: false, reason: outcome.reason });
        return res.status(200).json({ ok: true, queued: true, character: outcome.character, _saveVersion: outcome.saveVersion });
    } catch (err) {
        console.error('[missions/queue-combat-claim]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
