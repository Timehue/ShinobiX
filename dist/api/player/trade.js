"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _player_ips_js_1 = require("../_player-ips.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _trade_core_js_1 = require("./_trade-core.js");
const _economy_js_1 = require("../_economy.js");
/*
 * /api/player/trade — POST (direct player-to-player transfer)
 *
 * One-way taxed SEND. The sender is debited the full amount; the recipient
 * receives amount minus a burned tax (the economy sink). Server-authoritative:
 * balances are read fresh under BOTH save locks (sorted order → no deadlock,
 * both failClosed → currency safety), the split is recomputed from _trade-core,
 * and neither side's amount comes from the client body.
 *
 *   POST { playerName, toPlayer, currency, amount, nonce? }
 *     → { ok, currency, debit, credit, burned, toPlayer }
 *
 * Money safety:
 *   - only ryo / fateShards / boneCharms / auraStones are tradeable (honor seals
 *     are Vanguard-locked, mythic seals are top-rarity — both excluded).
 *   - VOID when sender + recipient share an IP/device (no funnelling to an alt).
 *   - optional client `nonce` makes a retried request idempotent (NX receipt).
 */
const AUDIT_PREFIX = 'audit:player-trade:';
const NONCE_TTL_SECONDS = 24 * 60 * 60;
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'player-trade', 20, 60_000, identity.name)))
            return;
        const currency = String(body.currency ?? '');
        if (!(0, _trade_core_js_1.isTradeCurrency)(currency))
            return res.status(400).json({ error: 'That currency cannot be traded.' });
        const amount = Math.floor(num(body.amount));
        const toRaw = typeof body.toPlayer === 'string' ? body.toPlayer.trim() : '';
        if (!toRaw)
            return res.status(400).json({ error: 'Choose a player to send to.' });
        const toSlug = (0, _utils_js_1.safeName)(toRaw);
        if (!toSlug)
            return res.status(400).json({ error: 'Invalid recipient.' });
        if (toSlug === playerName)
            return res.status(400).json({ error: "You can't send to yourself." });
        const toRec = await _storage_js_1.kv.get(`save:${toSlug}`);
        const toChar = (toRec?.character ?? null);
        if (!toRec || !toChar)
            return res.status(404).json({ error: 'That player was not found.' });
        const toDisplay = toChar.name ?? toRaw;
        // No funnelling currency to an account on your own connection.
        if (!identity.admin) {
            try {
                if (await (0, _player_ips_js_1.hasRecentIpOrFpOverlap)(playerName, toSlug)) {
                    return res.status(403).json({ error: "You can't send to someone sharing your connection." });
                }
            }
            catch { /* fail open — a broken anti-cheat check must not block a legit transfer */ }
        }
        // Optional idempotency: a client-supplied nonce makes a retried send a
        // no-op instead of a double-debit. The nonce receipt is written ONLY
        // after a successful commit (see below) and stores the original receipt,
        // so a genuine retry replays that receipt rather than re-running the
        // transfer. Checking it here is read-only — a request that failed AFTER
        // a pre-commit nonce write (e.g. lock contention 500, insufficient funds,
        // missing save) never persisted a nonce, so its retry runs for real.
        const nonce = typeof body.nonce === 'string' ? body.nonce.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '') : '';
        const nonceKey = nonce ? `trade:nonce:${playerName}:${nonce}` : '';
        if (nonceKey) {
            const prior = await _storage_js_1.kv.get(nonceKey);
            if (prior?.receipt)
                return res.status(200).json({ ...prior.receipt, duplicate: true });
        }
        const now = Date.now();
        // Lock BOTH saves in a stable (sorted) order so concurrent autosaves /
        // other transfers can't clobber the read-modify-write and two trades in
        // opposite directions can't deadlock.
        const senderKey = `save:${playerName}`;
        const recipientKey = `save:${toSlug}`;
        const [k1, k2] = [senderKey, recipientKey].sort();
        const out = await (0, _lock_js_1.withKvLock)(k1, async () => (0, _lock_js_1.withKvLock)(k2, async () => {
            const senderRec = await _storage_js_1.kv.get(senderKey);
            const senderChar = (senderRec?.character ?? null);
            if (!senderRec || !senderChar)
                return { status: 404, body: { error: 'Your save was not found.' } };
            const recipientRec = await _storage_js_1.kv.get(recipientKey);
            const recipientChar = (recipientRec?.character ?? null);
            if (!recipientRec || !recipientChar)
                return { status: 404, body: { error: 'That player was not found.' } };
            const plan = (0, _trade_core_js_1.planTrade)(currency, amount, num(senderChar[currency]));
            if (!plan.ok)
                return { status: 400, body: { error: plan.reason } };
            const senderUpdated = (0, _save_version_js_1.bumpSaveVersion)({ ...senderRec, character: { ...senderChar, [currency]: num(senderChar[currency]) - plan.debit } });
            await _storage_js_1.kv.set(senderKey, (0, _utils_js_1.mergePreservingImages)(senderUpdated, senderRec));
            const recipientUpdated = (0, _save_version_js_1.bumpSaveVersion)({ ...recipientRec, character: { ...recipientChar, [currency]: num(recipientChar[currency]) + plan.credit } });
            await _storage_js_1.kv.set(recipientKey, (0, _utils_js_1.mergePreservingImages)(recipientUpdated, recipientRec));
            return { status: 200, body: { ok: true, currency, debit: plan.debit, credit: plan.credit, burned: plan.burned, toPlayer: toDisplay } };
        }, { failClosed: true }), { failClosed: true });
        if (out.status === 200) {
            // Record the idempotency receipt only on success: a retry of THIS
            // committed transfer replays it; a retry of a failed attempt (which
            // wrote no nonce) runs for real.
            if (nonceKey) {
                await _storage_js_1.kv.set(nonceKey, { ts: now, receipt: out.body }, { ex: NONCE_TTL_SECONDS }).catch(() => undefined);
            }
            await _storage_js_1.kv.set(`${AUDIT_PREFIX}${now}`, { ts: now, from: playerName, to: toSlug, currency, debit: out.body.debit, credit: out.body.credit, burned: out.body.burned }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            // Economy telemetry — the 10% trade burn is a real "currency destroyed"
            // signal (sink), logged as a negative delta.
            const burned = Number(out.body.burned) || 0;
            if (burned > 0)
                await (0, _economy_js_1.recordEconomyTxn)({ txnId: `trade-burn:${now}`, player: playerName, currency, delta: -burned, source: 'trade.burn' });
        }
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        console.error('[player/trade]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
