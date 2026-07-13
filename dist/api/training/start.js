"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _training_config_js_1 = require("../_training-config.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _session_js_1 = require("./_session.js");
/*
 * /api/training/start — POST only
 *
 * Mints a single-use token for a stat-training session (two-axis training; see
 * docs/leveling-training-redesign-plan.md). The chosen stat, tier, start/end
 * timestamps and the AUTHORITATIVE stat gain + XP trickle are SEALED into the
 * token here so /api/training/complete pays the stored save from the sealed
 * values, not the client body. The gain is computed from the tier rate and a CLAMPED
 * client-reported training bonus (village/clan bonus formula lives in a client
 * lib; clamping it here bounds the trust surface).
 *
 * Gates: a daily mint cap + a per-session time-gate (complete can't redeem before
 * endsAt). Start also debits stamina and persists activeTraining under the same
 * save lock; the client never applies a local fallback grant.
 *
 * Body: { playerName, stat, tierId }
 * Token: `training-token:<player>:<uuid>`, single-use (complete deletes on redeem).
 */
const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
// Generous anti-abuse ceiling, not a play-limit: an idle player restarts the 8h
// tier ~3×/day; an active short-tier player far more. Well above legit cadence.
const MAX_TRAINING_STARTS_PER_DAY = 96;
// Clamp the client-reported village/clan training bonus. The real max is well
// under this; the clamp bounds how much a tampered body can inflate the seal.
// Covers the 8h max tier + a long collect window (a player may close the game for
// days). The single-use deletion + time-gate + daily cap are the real bounds.
const TOKEN_TTL_SECONDS = _session_js_1.TRAINING_TOKEN_TTL_SECONDS;
function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}
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
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'training-start', 6, 30_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const stat = STAT_KEYS.includes(body.stat) ? String(body.stat) : null;
        const tier = _training_config_js_1.TRAINING_TIERS.find((t) => t.id === body.tierId) ?? null;
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!stat)
            return res.status(400).json({ error: 'Invalid stat.' });
        if (!tier)
            return res.status(400).json({ error: 'Invalid training tier.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own training.' });
        }
        // Daily mint cap, read-check-increment under a lock so concurrent starts
        // can't both slip past the boundary. Fail-open (no failClosed): a rare
        // over-mint costs a bounded stat gain, and we'd rather start than 500.
        const today = utcDateKey();
        const dailyKey = `training-start-count:${playerName}:${today}`;
        const capCheck = await (0, _lock_js_1.withKvLock)(dailyKey, async () => {
            const startedToday = Number((await _storage_js_1.kv.get(dailyKey)) ?? 0);
            if (startedToday >= MAX_TRAINING_STARTS_PER_DAY)
                return { capped: true };
            await _storage_js_1.kv.set(dailyKey, startedToday + 1, { ex: 25 * 60 * 60 }).catch(() => undefined);
            return { capped: false };
        });
        if (capCheck.capped) {
            return res.status(200).json({ ok: true, reason: 'daily-training-cap', token: null });
        }
        const startedAt = Date.now();
        const endsAt = startedAt + tier.ms;
        const { sealedGain, sealedXp } = (0, _session_js_1.trustedTrainingRewards)(tier);
        const saveKey = `save:${playerName}`;
        const result = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            const character = record?.character;
            if (!record || !character)
                return { ok: false, status: 404, error: 'Player save not found.' };
            const prior = (0, _session_js_1.normalizeActiveTrainingSession)(record.activeTraining);
            const priorTokenExists = prior ? !!(await _storage_js_1.kv.get(`training-token:${playerName}:${prior.token}`)) : false;
            if ((0, _session_js_1.activeTrainingBlocksStart)(prior, priorTokenExists, startedAt)) {
                return { ok: false, status: 409, error: 'A training session is already active.' };
            }
            const stamina = Math.max(0, Number(character.stamina) || 0);
            if (stamina < tier.staminaCost)
                return { ok: false, status: 409, error: 'Not enough stamina.' };
            const tokenId = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
            const expiresAt = startedAt + TOKEN_TTL_SECONDS * 1000;
            const activeTraining = {
                label: `${tier.label} ${stat} Training`, stat, xp: sealedXp, statGain: sealedGain,
                staminaCost: tier.staminaCost, startedAt, endsAt, expiresAt, durationMs: tier.ms, token: tokenId,
            };
            await _storage_js_1.kv.set(`training-token:${playerName}:${tokenId}`, {
                playerName, stat, tierId: tier.id, startedAt, endsAt, sealedGain, sealedXp,
            }, { ex: TOKEN_TTL_SECONDS });
            await _storage_js_1.kv.set(`training-active:${playerName}`, activeTraining, { ex: TOKEN_TTL_SECONDS });
            const nextCharacter = { ...character, stamina: stamina - tier.staminaCost };
            const written = await (0, _mutate_player_save_js_1.writeVersionedPlayerSave)(saveKey, { ...record, activeTraining }, nextCharacter);
            return { ok: true, tokenId, activeTraining, character: nextCharacter, _saveVersion: written._saveVersion };
        }, { failClosed: true });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true, token: result.tokenId, startedAt, endsAt, durationMs: tier.ms,
            sealedGain, sealedXp, activeTraining: result.activeTraining,
            character: result.character, _saveVersion: result._saveVersion,
        });
    }
    catch (err) {
        console.error('[training/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
