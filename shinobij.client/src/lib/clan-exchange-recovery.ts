import {readPendingClanExchangeIntent} from './clan-exchange-intent';
import {postClanExchangePurchase, type ClanExchangePurchaseResponse} from './player-api';

export type PaidClanExchangeRequest = {itemId: string; requestId: string};

/** The saved debit is a scheduling hint; the server still verifies its private journal. */
export function paidPendingClanExchangeRequests(
    character: {name: string; clanExchangeSettlements?: unknown},
    clan: string,
): PaidClanExchangeRequest[] {
    const receipts = character.clanExchangeSettlements;
    if (!Array.isArray(receipts)) return [];
    const clanSlug = clan.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ['warSupplyGrant','greaterWarSupplyGrant'].flatMap(itemId => {
        const intent = readPendingClanExchangeIntent(character.name, clan, itemId);
        if (!intent) return [];
        const paid = receipts.some((entry: unknown) => {
            if (!entry || typeof entry !== 'object') return false;
            const receipt = entry as {requestId?: unknown; clanSlug?: unknown; proofToken?: unknown; item?: {id?: unknown}};
            return receipt.requestId === intent.requestId && receipt.clanSlug === clanSlug
                && typeof receipt.proofToken === 'string' && receipt.proofToken.length > 0 && receipt.item?.id === itemId;
        });
        return paid ? [{itemId, requestId:intent.requestId}] : [];
    });
}

// Share a continuation during StrictMode remounts and reconnect events.
const recovering = new Map<string,Promise<ClanExchangePurchaseResponse | null>>();
export function recoverPaidClanExchangePurchase(playerName: string, clan: string, itemId: string, requestId: string) {
    const key = JSON.stringify([playerName,clan,itemId,requestId]);
    const active = recovering.get(key);
    if (active) return active;
    const request = postClanExchangePurchase(playerName,clan,itemId,requestId)
        .finally(() => { if (recovering.get(key) === request) recovering.delete(key); });
    recovering.set(key,request);
    return request;
}
