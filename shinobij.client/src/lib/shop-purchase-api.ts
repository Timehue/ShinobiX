import { apiErrorContract, type ContractType } from '../../../shared/api-contract';
import { shopPurchaseRequestContract, shopPurchaseResponseContract, type ShopPurchaseRequest, type ShopPurchaseResponse } from '../../../shared/shop-purchase-contract';
import type { Character } from '../types/character';

type PurchaseResult = (Omit<ShopPurchaseResponse, 'character'> & { character: Character; error?: undefined })
    | (ContractType<typeof apiErrorContract> & { character?: undefined; _saveVersion?: undefined });

export function readShopPurchaseReply(response: Pick<Response, 'ok'>, raw: unknown, request: ShopPurchaseRequest): PurchaseResult | null {
    if (!response.ok) {
        const error = apiErrorContract.safeParse(raw);
        return error.success ? error.data : null;
    }
    const parsed = shopPurchaseResponseContract.safeParse(raw);
    if (!parsed.success) return null;
    const result = parsed.data;
    const accountKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
    if (result.purchase.id !== request.itemId || accountKey(result.character.name) !== accountKey(request.playerName)) return null;
    // The transport validates the receipt and spent balance. Other character
    // fields keep their server-owned shape; the coordinator orders snapshots.
    return result as PurchaseResult;
}

export async function purchaseShopItem(request: ShopPurchaseRequest) {
    const body = shopPurchaseRequestContract.parse(request);
    const response = await fetch('/api/shop/purchase', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    const raw: unknown = await response.json().catch(() => null);
    return { response, result: readShopPurchaseReply(response, raw, body) };
}
