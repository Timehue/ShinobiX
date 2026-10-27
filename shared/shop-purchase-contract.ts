import { acknowledged, boolean, choice, contract, ContractError, record, text, whole, type ContractType } from './api-contract.js';

/** Keep the existing purchase identity normalization, including its 96-char cap. */
export const shopPurchaseIdentityContract = contract((value: unknown) => {
    const body = record(value, 'Invalid player or request id.');
    const playerName = text(body.playerName, 'Invalid player or request id.');
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim().slice(0, 96) : '';
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) throw new ContractError('Invalid player or request id.');
    return { playerName, requestId };
});

export const shopPurchaseRequestContract = contract((value: unknown) => {
    const body = record(value);
    const identity = shopPurchaseIdentityContract.parse(body);
    const itemId = text(body.itemId, 'item-not-for-sale');
    // Older clients send numeric strings or omit quantity. The catalog still
    // owns single-item rules and per-item hold caps, never a client price.
    if (body.qty !== undefined && body.qty !== null && typeof body.qty !== 'number' && typeof body.qty !== 'string') {
        throw new ContractError('Invalid quantity.');
    }
    const numeric = Number(body.qty ?? 1);
    if (!Number.isFinite(numeric)) throw new ContractError('Invalid quantity.');
    const qty = Math.max(1, Math.floor(numeric));
    return { ...identity, itemId, qty };
});

export const shopPurchaseResponseContract = contract((value: unknown) => {
    const body = acknowledged(value);
    const purchase = record(body.purchase, 'Missing purchase receipt.');
    const character = record(body.character, 'Missing authoritative character.');
    const currency = choice(purchase.currency, ['ryo', 'fateShards'], 'Invalid purchase currency.');
    const qty = whole(purchase.qty, 'Invalid purchased quantity.', 1, 9999);
    const unitCost = whole(purchase.unitCost, 'Invalid unit cost.', 1);
    const totalCost = whole(purchase.totalCost, 'Invalid purchase total.', 1);
    if (totalCost !== unitCost * qty) throw new ContractError('Purchase total does not match receipt.');
    // A replay returns the current character, which may carry a legacy
    // fractional Ryo balance from a later save. Do not rewrite that balance.
    const balance = character[currency];
    if (currency === 'fateShards') whole(balance, 'Invalid authoritative purchase balance.');
    else if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) {
        throw new ContractError('Invalid authoritative purchase balance.');
    }
    return {
        ...body,
        ok: true as const,
        replayed: boolean(body.replayed, 'Invalid purchase replay flag.'),
        purchase: { ...purchase, id: text(purchase.id, 'Missing purchased item.'), currency, qty, unitCost, totalCost },
        character: { ...character, name: text(character.name, 'Missing character name.') },
        _saveVersion: whole(body._saveVersion, 'Invalid save version.', 1),
    };
});

export type ShopPurchaseRequest = ContractType<typeof shopPurchaseRequestContract>;
export type ShopPurchaseResponse = ContractType<typeof shopPurchaseResponseContract>;
