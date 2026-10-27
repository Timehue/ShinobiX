import { inventoryGrowthBlock } from '../_inventory-capacity.js';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { purchaseCatalogItem } from './_purchase.js';
import { captureServerProductEvent } from '../_product-analytics.js';
import { recordEconomyTxn } from '../_economy.js';
import { shopPurchaseIdentityContract, shopPurchaseRequestContract, shopPurchaseResponseContract } from '../../shared/shop-purchase-contract.js';
import { contractResponse } from '../_contract-response.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    const reply = contractResponse(res, shopPurchaseResponseContract);
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const identityRequest = shopPurchaseIdentityContract.safeParse(body);
        if (!identityRequest.success) return reply(400, { error: identityRequest.error });
        const playerName = safeName(identityRequest.data.playerName);
        const requestId = identityRequest.data.requestId;
        if (!playerName) return reply(400, { error: 'Invalid player or request id.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return reply(401, { error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return reply(403, { error: 'Not your purchase.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'shop-purchase', 60, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const receipts = Array.isArray(character.redeemedShopPurchases)
                ? (character.redeemedShopPurchases as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry.id === 'string') : [];
            const prior = receipts.find((entry) => entry.id === requestId);
            if (prior) return { ok: true as const, character, value: { purchase: prior.purchase, replayed: true } };
            // Replay lookup precedes line validation, as it always has: an
            // existing identity retrieves its receipt without a second debit.
            const request = shopPurchaseRequestContract.safeParse(body);
            if (!request.success) return { ok: false as const, status: 409, error: request.error };
            const bought = purchaseCatalogItem(character, request.data.itemId, request.data.qty);
            if (!bought.ok) return { ok: false as const, status: 409, error: bought.reason };
            // Reachable ONLY for non-stackable items: `purchaseCatalogItem` routes
            // every stackable buy into `itemStacks`, so a bulk consumable order
            // never touches `inventory[]` and can never be refused here. The one
            // non-stackable bulk buy is the evolution stone (the evolve route reads
            // inventory[]), and each stone is a real slot this gate must count. That ordering is load-bearing — gating the raw
            // pre-routing result would have told a full-bag veteran "Your
            // inventory is full." when they tried to buy a healing potion.
            //
            // `purchaseCatalogItem` is pure and `bought` is discarded on refusal,
            // so the currency is never debited. (MMORPG behavior audit F7 step 2.)
            const grew = inventoryGrowthBlock(character, bought.character);
            if (grew) return { ok: false as const, status: grew.status, error: grew.error };
            const receipt = { id: requestId, purchase: bought.item, at: Date.now() };
            return { ok: true as const, character: { ...bought.character, redeemedShopPurchases: [...receipts.slice(-99), receipt] }, value: { purchase: bought.item, replayed: false } };
        });
        if (!result.ok) return reply(result.status, { error: result.error });
        if (!result.value.replayed) {
            const purchase = result.value.purchase as { id?: unknown } | undefined;
            captureServerProductEvent('shop_purchase_settled', {
                source: 'shop',
                contentId: String(purchase?.id ?? 'unknown'),
            });
            // Economy telemetry (I-19): the Quartermaster / Marketplace sink, after
            // the commit and only for the request that paid. A replayed requestId
            // returns its stored receipt and records nothing.
            const paid = result.value.purchase as { currency?: unknown; totalCost?: unknown } | undefined;
            const totalCost = Math.max(0, Math.floor(Number(paid?.totalCost) || 0));
            const currency = paid?.currency === 'fateShards' ? 'fateShards' : 'ryo';
            if (totalCost > 0) {
                void recordEconomyTxn({
                    txnId: `shop.purchase:${playerName}:${requestId}`,
                    player: playerName,
                    currency,
                    delta: -totalCost,
                    source: 'shop.purchase',
                    balanceAfter: Number(result.character[currency] ?? 0),
                });
            }
        }
        return reply(200, { ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[shop/purchase]', safeLogValue(error));
        return reply(500, { error: 'Internal server error.' });
    }
}
