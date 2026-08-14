import type { Character } from '../types/character';
import type { EquipmentSlot } from '../types/combat';

export type ShopPackId = 'standard' | 'epic' | 'legendary';

type SettlementResponse<T> =
    | { ok: true; character: Character; settlement: T; _saveVersion?: number }
    | { ok: false; error: string };

const pendingRequestIds = new Map<string, string>();

function freshRequestId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function postSettlement<T>(path: string, body: Record<string, unknown>, fallback: string): Promise<SettlementResponse<T>> {
    const pendingKey = `shinobix.settlement:${path}:${JSON.stringify(body)}`;
    let id = pendingRequestIds.get(pendingKey);
    try { id = sessionStorage.getItem(pendingKey) || id; } catch { /* in-memory fallback */ }
    if (!id) {
        id = freshRequestId();
        pendingRequestIds.set(pendingKey, id);
        try { sessionStorage.setItem(pendingKey, id); } catch { /* in-memory fallback */ }
    }
    try {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, requestId: id }),
        });
        const data = await response.json().catch(() => ({})) as {
            ok?: boolean;
            error?: string;
            character?: Character;
            settlement?: T;
            _saveVersion?: number;
        };
        if (!response.ok || !data.ok || !data.character || !data.settlement) {
            // Retain the same ID for ambiguous server/network failures. A later
            // click then replays the stored result instead of charging twice.
            if (response.status < 500) clearPendingRequest(pendingKey);
            return { ok: false, error: data.error || fallback };
        }
        clearPendingRequest(pendingKey);
        return { ok: true, character: data.character, settlement: data.settlement, _saveVersion: data._saveVersion };
    } catch {
        return { ok: false, error: fallback };
    }
}

function clearPendingRequest(key: string): void {
    pendingRequestIds.delete(key);
    try { sessionStorage.removeItem(key); } catch { /* in-memory fallback */ }
}

export function settleShopItemPurchase(playerName: string, itemId: string, quantity: number) {
    return postSettlement<{ kind: 'item-purchase'; itemId: string; quantity: number; totalCost: number }>(
        '/api/shop/settle',
        { playerName, action: { type: 'purchase-item', itemId, quantity } },
        'Could not complete the purchase. Nothing was changed; please retry.',
    );
}

export function settleShopCardPack(playerName: string, packId: ShopPackId) {
    return postSettlement<{ kind: 'card-pack'; packId: ShopPackId; drawn: string[]; totalCost: number }>(
        '/api/shop/settle',
        { playerName, action: { type: 'open-card-pack', packId } },
        'Could not open the card pack. Nothing was changed; please retry.',
    );
}

export function settleInventorySale(
    playerName: string,
    itemId: string,
    source: 'backpack' | 'equipped',
    quantity: number,
    equipmentSlot?: EquipmentSlot,
) {
    return postSettlement<{ kind: 'inventory-sale'; itemId: string; quantity: number; ryo: number }>(
        '/api/inventory/sell',
        { playerName, itemId, source, quantity, equipmentSlot },
        'Could not sell the item. Nothing was changed; please retry.',
    );
}
