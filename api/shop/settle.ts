import { safeLogValue } from '../_safe-log.js';
import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { recordEconomyTxn } from '../_economy.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { parseSettlementRequestId } from '../_settlement-receipts.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { loadSettlementCatalogs } from './_catalog.js';
import { applyCardPackPurchase, applyItemPurchase, type ShopPackId } from './_settlement.js';
import { chronicleUnlocked, CHRONICLE_LOCKED_ERROR } from '../card-clash/_starter-cards.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = parseSettlementRequestId(body.requestId);
        const action = body.action && typeof body.action === 'object' && !Array.isArray(body.action)
            ? body.action as Record<string, unknown>
            : null;
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (!requestId) return res.status(400).json({ error: 'Invalid settlement request ID.' });
        if (!action || (action.type !== 'purchase-item' && action.type !== 'open-card-pack')) {
            return res.status(400).json({ error: 'Unknown shop settlement action.' });
        }

        const identityName = await authedPlayer(req, playerName);
        if (!identityName) return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName) return res.status(403).json({ error: 'You can only use your own shop account.' });
        if (!(await enforceRateLimitKv(req, res, 'shop-settlement', 30, 60_000, identityName, { strict: true }))) return;
        const catalogs = await loadSettlementCatalogs();

        const out = await mutatePlayerSave(playerName, ({ character }) => {
            if (action.type === 'purchase-item') {
                const itemId = typeof action.itemId === 'string' ? action.itemId : '';
                const item = catalogs.items.get(itemId);
                if (!item) return { ok: false as const, status: 400, error: 'Unknown shop item.' };
                const settled = applyItemPurchase(character, item, Number(action.quantity), requestId, Date.now());
                if (!settled.ok) return settled;
                return { ok: true as const, character: settled.character, value: { ...settled.value, replayed: settled.replayed } };
            }
            const packId = action.packId as ShopPackId;
            if (packId !== 'standard' && packId !== 'epic' && packId !== 'legendary') {
                return { ok: false as const, status: 400, error: 'Unknown card pack.' };
            }
            // No codex, no packs — the scribe event unlocks the Chronicle.
            if (!chronicleUnlocked(character)) {
                return { ok: false as const, status: 409, error: CHRONICLE_LOCKED_ERROR };
            }
            const settled = applyCardPackPurchase(character, catalogs.cards, packId, requestId, Date.now(), randomInt);
            if (!settled.ok) return settled;
            return { ok: true as const, character: settled.character, value: { ...settled.value, replayed: settled.replayed } };
        });
        if (!out.ok) return res.status(out.status).json({ error: out.error });

        if (!out.value.replayed && out.value.totalCost > 0) {
            await recordEconomyTxn({
                txnId: `shop:${playerName}:${requestId}`,
                player: playerName,
                currency: out.value.currency,
                delta: -out.value.totalCost,
                source: out.value.kind === 'card-pack' ? 'shop.card-pack' : 'shop.item-purchase',
                balanceAfter: Number(out.character[out.value.currency] ?? 0),
            });
        }
        return res.status(200).json({ ok: true, settlement: out.value, character: out.character, _saveVersion: out._saveVersion });
    } catch (error) {
        console.error('[shop/settle]', safeLogValue(error));
        return res.status(503).json({ error: 'Could not settle the shop action. Nothing was changed; please retry.' });
    }
}
