import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { recordEconomyTxn } from '../_economy.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { parseSettlementRequestId } from '../_settlement-receipts.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { loadSettlementCatalogs } from '../shop/_catalog.js';
import { applyInventorySale, type InventorySaleSource } from './_sale.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = parseSettlementRequestId(body.requestId);
        const itemId = typeof body.itemId === 'string' ? body.itemId : '';
        const source = body.source as InventorySaleSource;
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (!requestId) return res.status(400).json({ error: 'Invalid settlement request ID.' });
        if (!itemId || (source !== 'backpack' && source !== 'equipped')) return res.status(400).json({ error: 'Invalid sale request.' });

        const identityName = await authedPlayer(req, playerName);
        if (!identityName) return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName) return res.status(403).json({ error: 'You can only sell your own items.' });
        if (!(await enforceRateLimitKv(req, res, 'inventory-sale', 30, 60_000, identityName, { strict: true }))) return;
        const catalogs = await loadSettlementCatalogs();
        const item = catalogs.items.get(itemId);
        if (!item) return res.status(400).json({ error: 'Unknown sale item.' });

        const out = await mutatePlayerSave(playerName, ({ character }) => {
            const settled = applyInventorySale(
                character,
                item,
                source,
                Number(body.quantity),
                typeof body.equipmentSlot === 'string' ? body.equipmentSlot : undefined,
                requestId,
                Date.now(),
            );
            if (!settled.ok) return settled;
            return { ok: true as const, character: settled.character, value: { ...settled.value, replayed: settled.replayed } };
        });
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        if (!out.value.replayed && out.value.ryo > 0) {
            await recordEconomyTxn({
                txnId: `inventory-sale:${playerName}:${requestId}`,
                player: playerName,
                currency: 'ryo',
                delta: out.value.ryo,
                source: 'inventory.sale',
                balanceAfter: Number(out.character.ryo ?? 0),
            });
        }
        return res.status(200).json({ ok: true, settlement: out.value, character: out.character, _saveVersion: out._saveVersion });
    } catch (error) {
        console.error('[inventory/sell]', error);
        return res.status(503).json({ error: 'Could not sell the item. Nothing was changed; please retry.' });
    }
}
