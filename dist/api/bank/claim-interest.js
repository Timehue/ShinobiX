"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _bank_interest_js_1 = require("../_bank-interest.js");
const _economy_js_1 = require("../_economy.js");
/*
 * /api/bank/claim-interest  — POST only
 *
 * Server-authoritative Bank-interest claim (audit #7 / Stage 3 Phase 4f, the
 * first deterministic non-PvP source). The old flow let the CLIENT compute
 * `projectedInterest = floor(bankRyo × rate)` and self-apply it to `bankRyo`
 * via the save blob; the sanitizer only enforced the 24h timestamp window and
 * leaves `bankRyo` uncapped, so a crafted client could mint arbitrary banked
 * ryo through the interest claim.
 *
 * This endpoint OWNS the claim end-to-end: under `lock:save:<name>` (the
 * autosave's lock) it reads the saved `bankRyo` + bank-upgrade rate, recomputes
 * the interest with the verbatim-ported `computeBankInterest` (server clock for
 * the 24h gate → no clock-rollback repeat), credits `bankRyo` and stamps
 * `lastBankInterestAt` atomically, `failClosed` → 503/retry. The client adds the
 * returned `claimed` delta to its OWN `bankRyo` (preserving concurrent deposits/
 * withdrawals) and re-asserts via autosave; the two converge. There is no
 * separate completion to verify — claiming interest IS the action, fully owned
 * here. Body: { playerName }. Caller MUST be the player (or admin). 30/min.
 */
const AUDIT_LOG_PREFIX = 'audit:bank-interest:';
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
            return res.status(403).json({ error: 'You can only claim your own bank interest.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'bank-claim-interest', 30, 60_000, identity.name)))
            return;
        const now = Date.now();
        const saveKey = `save:${playerName}`;
        let out;
        try {
            out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { error: 'no-save' };
                const result = (0, _bank_interest_js_1.computeBankInterest)(char, now);
                if (!result.eligible) {
                    return { credited: false, reason: result.reason, nextClaimAt: result.nextClaimAt };
                }
                const nextBankRyo = (Number(char.bankRyo) || 0) + result.interest;
                const nextChar = { ...char, bankRyo: nextBankRyo, lastBankInterestAt: now };
                const nextRecord = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: nextChar });
                await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(nextRecord, rec));
                return { credited: true, interest: result.interest, bankRyo: nextBankRyo, nextClaimAt: now + _bank_interest_js_1.BANK_INTEREST_WINDOW_MS };
            }, { failClosed: true });
        }
        catch (e) {
            console.error('[bank/claim-interest] credit failed', e);
            return res.status(503).json({ error: 'Could not claim bank interest — please retry.' });
        }
        if ('error' in out)
            return res.status(404).json({ error: 'Your save was not found.' });
        if (!out.credited) {
            return res.status(200).json({ ok: true, eligible: false, claimed: 0, reason: out.reason, nextClaimAt: out.nextClaimAt });
        }
        await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${playerName}:${now}`, {
            ts: now,
            actor: identity.admin ? 'admin' : identity.name,
            claimed: out.interest,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        // Economy telemetry — bank interest is the top inflation faucet, so log it.
        await (0, _economy_js_1.recordEconomyTxn)({ txnId: `bank-interest:${playerName}:${now}`, player: playerName, currency: 'ryo', delta: out.interest, source: 'bank.interest', balanceAfter: out.bankRyo });
        return res.status(200).json({
            ok: true,
            eligible: true,
            claimed: out.interest,
            bankRyo: out.bankRyo,
            lastBankInterestAt: now,
            nextClaimAt: out.nextClaimAt,
        });
    }
    catch (err) {
        console.error('[bank/claim-interest]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
