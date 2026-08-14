import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../_settlement-receipts.js';
import { recordAudit } from '../_audit.js';

function cleanId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{1,96}$/.test(id) ? id : '';
}

export function applyAdminItemGrant(
    character: Record<string, unknown>,
    itemId: string,
    requestId: string,
    now = Date.now(),
): { ok: true; character: Record<string, unknown>; replayed: boolean } | { ok: false; error: string } {
    const fingerprint = `admin-item-grant:${itemId}`;
    const inspected = inspectSettlementReceipt(character, requestId, fingerprint);
    if (inspected.status === 'replay') return { ok: true, character, replayed: true };
    if (inspected.status !== 'fresh') return { ok: false, error: `receipt-${inspected.status}` };
    const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
    const granted = { ...character, inventory: [...inventory, itemId] };
    return {
        ok: true,
        replayed: false,
        character: appendSettlementReceipt(granted, inspected.receipts, {
            requestId,
            fingerprint,
            value: { kind: 'admin-item-grant', itemId },
            settledAt: now,
        }),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!isAdmin(req)) return res.status(401).json({ error: 'Admin authentication required.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const itemId = cleanId(body.itemId);
        const requestId = cleanId(body.requestId);
        if (!playerName || !itemId || !requestId) return res.status(400).json({ error: 'Invalid player, item, or request id.' });

        const adminContent = await loadAdminCombatContent();
        if (!ITEM_CATALOG[itemId] && !adminContent.items.has(itemId)) {
            return res.status(409).json({ error: 'Publish this item before granting it.' });
        }

        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const applied = applyAdminItemGrant(character, itemId, requestId);
            if (!applied.ok) return { ok: false as const, status: 409, error: applied.error };
            return { ok: true as const, character: applied.character, value: { replayed: applied.replayed }, write: !applied.replayed };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });

        if (!result.value.replayed) {
            await recordAudit({ domain: 'content', actor: 'admin', action: 'item.grant', entityType: 'item', entityId: itemId });
        }
        return res.status(200).json({ ok: true, replayed: result.value.replayed, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[admin/grant-item]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
