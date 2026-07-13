import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { purchaseCatalogItem } from './_purchase.js';

const cleanId = (value: unknown) => {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = cleanId(body.requestId);
        if (!playerName || !requestId) return res.status(400).json({ error: 'Invalid player or request id.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your purchase.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'shop-purchase', 60, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const receipts = Array.isArray(character.redeemedShopPurchases)
                ? (character.redeemedShopPurchases as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry.id === 'string') : [];
            const prior = receipts.find((entry) => entry.id === requestId);
            if (prior) return { ok: true as const, character, value: { purchase: prior.purchase, replayed: true } };
            const bought = purchaseCatalogItem(character, body.itemId, body.qty);
            if (!bought.ok) return { ok: false as const, status: 409, error: bought.reason };
            const receipt = { id: requestId, purchase: bought.item, at: Date.now() };
            return { ok: true as const, character: { ...bought.character, redeemedShopPurchases: [...receipts.slice(-99), receipt] }, value: { purchase: bought.item, replayed: false } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[shop/purchase]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
