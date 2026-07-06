"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _auth_js_1 = require("../../_auth.js");
const _lock_js_1 = require("../../_lock.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _utils_js_1 = require("../../_utils.js");
const _save_version_js_1 = require("../../save/_save-version.js");
const _exchange_js_1 = require("../_exchange.js");
const AUDIT_LOG_PREFIX = 'audit:clan-exchange:';
const FAILURE_STATUS = {
    'not-in-clan': 403,
    'clan-not-found': 404,
    'wrong-clan': 403,
    'unknown-item': 400,
    'coming-soon': 409,
    'level-locked': 409,
    'insufficient-points': 409,
    'limit-reached': 409,
    'empty-cache': 409,
};
function exchangeItemCreditsTreasury(itemId) {
    return _exchange_js_1.CLAN_EXCHANGE_ITEMS.some((item) => item.id === itemId && item.reward.kind === 'treasury');
}
async function commitPlayerPurchase(args) {
    return await (0, _lock_js_1.withKvLock)(args.playerSaveKey, async () => {
        const playerRec = await _storage_js_1.kv.get(args.playerSaveKey);
        const character = (playerRec?.character ?? null);
        if (!playerRec || !character)
            return { ok: false, status: 404, error: 'Player save not found.' };
        if ((0, _utils_js_1.clanBareSlug)(String(character.clan ?? '')) !== args.targetSlug) {
            return { ok: false, status: 403, error: 'You are not a member of this clan.' };
        }
        const result = (0, _exchange_js_1.buyClanExchangeItem)({ character, clanData: args.clanRec, itemId: args.itemId, now: args.now });
        if (!result.ok) {
            return { ok: false, status: FAILURE_STATUS[result.code] ?? 400, error: result.error };
        }
        await _storage_js_1.kv.set(args.playerSaveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...playerRec, character: result.character }), playerRec));
        return { ok: true, result };
    }, { failClosed: true });
}
async function refundPlayerTreasuryPurchase(args) {
    return await (0, _lock_js_1.withKvLock)(args.playerSaveKey, async () => {
        const playerRec = await _storage_js_1.kv.get(args.playerSaveKey);
        const character = (playerRec?.character ?? null);
        if (!playerRec || !character)
            return false;
        const refunded = (0, _exchange_js_1.refundClanExchangeTreasuryPurchase)({ character, itemId: args.itemId, now: args.now });
        await _storage_js_1.kv.set(args.playerSaveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...playerRec, character: refunded }), playerRec));
        return true;
    }, { failClosed: true });
}
/*
 * /api/clan/exchange/purchase
 *
 * Server-authoritative Clan Exchange purchase. Clan Points are personal,
 * server-issued currency; the client only names the desired catalog item.
 * Purchases that grant War Supply lock the shared clan row first, then the
 * player save, matching the treasury donation lock order.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
        if (!playerName || !clan || !itemId)
            return res.status(400).json({ error: 'Missing playerName, clan, or itemId.' });
        const item = _exchange_js_1.CLAN_EXCHANGE_ITEMS.find((entry) => entry.id === itemId);
        if (!item)
            return res.status(400).json({ error: 'Unknown Clan Exchange item.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only purchase for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-exchange-purchase', 20, 60_000, identity.name)))
            return;
        const targetSlug = (0, _utils_js_1.clanBareSlug)(clan);
        if (!targetSlug)
            return res.status(400).json({ error: 'Invalid clan name.' });
        const clanSaveKey = (0, _utils_js_1.clanRecordKey)(clan);
        const playerSaveKey = `save:${playerName}`;
        const purchaseNow = new Date();
        const creditsTreasury = exchangeItemCreditsTreasury(itemId);
        const purchase = creditsTreasury
            ? await (0, _lock_js_1.withKvLock)(clanSaveKey, async () => {
                const clanRec = await _storage_js_1.kv.get(clanSaveKey);
                if (!clanRec)
                    return { ok: false, status: 404, error: 'Clan not found.' };
                const playerResult = await commitPlayerPurchase({ playerSaveKey, playerName, targetSlug, clanRec, itemId, now: purchaseNow });
                if (!playerResult.ok)
                    return playerResult;
                try {
                    await _storage_js_1.kv.set(clanSaveKey, playerResult.result.clanData);
                }
                catch (creditErr) {
                    console.error(`[clan/exchange/purchase] TREASURY CREDIT FAILED after point spend - refunding ${itemId} for ${playerName} in clan "${clan}":`, creditErr);
                    let refunded = false;
                    let refundError;
                    try {
                        refunded = await refundPlayerTreasuryPurchase({ playerSaveKey, itemId, now: purchaseNow });
                    }
                    catch (refundErr) {
                        refundError = refundErr instanceof Error ? refundErr.message : String(refundErr);
                        console.error(`[clan/exchange/purchase] TREASURY CREDIT REFUND FAILED - ${itemId} for ${playerName} in clan "${clan}":`, refundErr);
                    }
                    await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}LOSS:${targetSlug}:${playerName}:${Date.now()}`, {
                        ts: Date.now(),
                        actor: identity.admin ? 'admin' : identity.name,
                        playerName,
                        clan,
                        itemId,
                        cost: item.cost,
                        reward: item.reward,
                        refunded,
                        refundError,
                        error: creditErr instanceof Error ? creditErr.message : String(creditErr),
                    }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
                    return {
                        ok: false,
                        status: 503,
                        error: refunded
                            ? 'The clan treasury credit could not be saved, so your Clan Points were refunded. Please retry in a moment.'
                            : 'Clan Points were spent, but the clan treasury credit could not be saved. An admin can reconcile it; please do not retry this purchase.',
                    };
                }
                return playerResult;
            }, { failClosed: true })
            : await (async () => {
                const clanRec = await _storage_js_1.kv.get(clanSaveKey);
                if (!clanRec)
                    return { ok: false, status: 404, error: 'Clan not found.' };
                return await commitPlayerPurchase({ playerSaveKey, playerName, targetSlug, clanRec, itemId, now: purchaseNow });
            })();
        if (!purchase.ok)
            return res.status(purchase.status).json({ error: purchase.error });
        await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${playerName}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            playerName,
            clan,
            itemId,
            cost: item.cost,
            reward: item.reward,
        }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
        return res.status(200).json({
            ok: true,
            character: purchase.result.character,
            clan: {
                xp: purchase.result.clanData.xp,
                level: purchase.result.clanData.level,
                treasury: purchase.result.clanData.treasury,
            },
            item: purchase.result.item,
            purchaseCount: purchase.result.purchaseCount,
            remaining: purchase.result.remaining,
            reveal: purchase.result.reveal,
        });
    }
    catch (err) {
        console.error('[clan/exchange/purchase]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
