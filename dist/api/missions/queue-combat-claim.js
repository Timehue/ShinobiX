"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _mission_catalog_js_1 = require("./_mission-catalog.js");
const _release_flags_js_1 = require("../_release-flags.js");
const _eligibility_js_1 = require("./_eligibility.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
const _authoritative_combat_session_js_1 = require("./_authoritative-combat-session.js");
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
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'queue-combat-claim', 10, 10_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const missionId = String(body.missionId ?? '').slice(0, 80);
        const runId = String(body.runId ?? '').slice(0, 96);
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only queue your own missions.' });
        }
        const def = (0, _mission_catalog_js_1.combatMissionByKey)(missionId);
        // Unknown / creator-authored ids aren't in the combat catalog. Return 200
        // (not an error): the client keeps its local flag + autosave fallback and
        // the legacy claim path still pays creator missions.
        if (!def)
            return res.status(200).json({ ok: true, queued: false, reason: 'unknown-mission' });
        const legacyClientAllowed = (0, _release_flags_js_1.clientTrustedCombatMissionRewardAllowed)(def);
        if (!legacyClientAllowed && !runId) {
            return res.status(200).json({
                ok: true,
                queued: false,
                reason: _release_flags_js_1.COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON,
            });
        }
        let authoritativeBinding = null;
        if (runId) {
            const binding = await _storage_js_1.kv.get((0, _authoritative_combat_session_js_1.missionCombatBindingKey)(runId));
            const session = await (0, _tower_store_js_1.readSession)(runId);
            const validation = (0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session, playerName, mission: def });
            if (!validation.ok)
                return res.status(200).json({ ok: true, queued: false, reason: validation.reason });
            authoritativeBinding = validation.binding;
        }
        const saveKey = `save:${playerName}`;
        // Read-modify-write of the save goes under the same lock the save
        // endpoint uses so a concurrent autosave can't clobber the queued flag.
        const queueUnderSaveLock = () => (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            const char = record?.character;
            if (!record || !char)
                return { queued: false, reason: 'no-save' };
            const eligibility = (0, _eligibility_js_1.canPlayerReceiveMission)(char, def);
            if (!eligibility.ok)
                return { queued: false, reason: (0, _eligibility_js_1.missionEligibilityFailureBody)(eligibility).reason };
            const pending = Array.isArray(char.pendingCombatMissionClaims) ? char.pendingCombatMissionClaims : [];
            const nextPending = pending.includes(def.key) ? pending : [...pending, def.key];
            const nextChar = { ...char, pendingCombatMissionClaims: nextPending };
            const updated = (0, _save_version_js_1.bumpSaveVersion)({ ...record, character: nextChar });
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
            // Mint the single-use claim gate. Set (not NX) so re-queuing the same
            // mission refreshes the TTL rather than leaving a near-expired token.
            const tokenKey = `missions:combat-claim:${playerName}:${def.key}`;
            await _storage_js_1.kv.set(tokenKey, authoritativeBinding
                ? { authority: 'server-combat', runId, missionId: def.key, wonAt: Date.now() }
                : { authority: 'legacy-client', missionId: def.key, queuedAt: Date.now() }, { ex: COMBAT_CLAIM_TOKEN_TTL_SECONDS }).catch(() => undefined);
            return { queued: true, saveVersion: Number(updated._saveVersion ?? 0), character: nextChar };
        });
        const outcome = authoritativeBinding
            ? await (0, _lock_js_1.withKvLock)((0, _authoritative_combat_session_js_1.missionCombatBindingKey)(runId), async () => {
                const freshBinding = await _storage_js_1.kv.get((0, _authoritative_combat_session_js_1.missionCombatBindingKey)(runId));
                const freshSession = await (0, _tower_store_js_1.readSession)(runId);
                const freshValidation = (0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({
                    binding: freshBinding,
                    session: freshSession,
                    playerName,
                    mission: def,
                });
                if (!freshValidation.ok)
                    return { queued: false, reason: freshValidation.reason };
                const queued = await queueUnderSaveLock();
                if (queued.queued) {
                    // The battle engine, not the client, recorded these uses.
                    // Deduct them through the same per-run receipt path as Tower
                    // and Weekly Boss so retries cannot charge an item twice.
                    await (0, _tower_store_js_1.settleConsumedItemsForMember)({ session: freshSession, slug: playerName });
                    await _storage_js_1.kv.set((0, _authoritative_combat_session_js_1.missionCombatBindingKey)(runId), (0, _authoritative_combat_session_js_1.settleMissionCombatBinding)(freshValidation.binding), { ex: _authoritative_combat_session_js_1.MISSION_COMBAT_SESSION_TTL_SECONDS });
                }
                return queued;
            }, { failClosed: true })
            : await queueUnderSaveLock();
        if (!outcome.queued)
            return res.status(200).json({ ok: true, queued: false, reason: outcome.reason });
        return res.status(200).json({ ok: true, queued: true, character: outcome.character, _saveVersion: outcome.saveVersion });
    }
    catch (err) {
        console.error('[missions/queue-combat-claim]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
