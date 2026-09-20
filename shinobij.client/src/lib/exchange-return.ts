import { parseExchangeMarketQuery, type ExchangeMarketQuery } from '../../../shared/sunscar-exchange';

export const EXCHANGE_RETURN_TTL_MS = 30 * 60_000;

export type ExchangeReturnContext = {
    v: 1;
    account: string;
    origin: 'sunscarFestival';
    listingId: string;
    market: ExchangeMarketQuery;
    expiresAt: number;
};

const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
const key = (account: string) => `sunscar-exchange:return:${slug(account)}`;

function valid(value: unknown, account: string, now = Date.now()): value is ExchangeReturnContext {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const context = value as ExchangeReturnContext;
    return context.v === 1 && context.account === slug(account) && context.origin === 'sunscarFestival'
        && /^[a-f0-9]{32}$/.test(context.listingId) && Number.isFinite(context.expiresAt) && context.expiresAt > now
        && !!parseExchangeMarketQuery(context.market);
}

export function saveExchangeReturnContext(account: string, listingId: string, market: ExchangeMarketQuery, now = Date.now()): boolean {
    try {
        const context: ExchangeReturnContext = { v: 1, account: slug(account), origin: 'sunscarFestival', listingId, market, expiresAt: now + EXCHANGE_RETURN_TTL_MS };
        sessionStorage.setItem(key(account), JSON.stringify(context));
        return true;
    } catch { return false; }
}

export function peekExchangeReturnContext(account: string, now = Date.now()): ExchangeReturnContext | null {
    try {
        const storageKey = key(account);
        const raw = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (valid(raw, account, now)) return raw;
        sessionStorage.removeItem(storageKey);
    } catch { /* Optional storage must never block navigation. */ }
    return null;
}

export function takeExchangeReturnContext(account: string, now = Date.now()): ExchangeReturnContext | null {
    const context = peekExchangeReturnContext(account, now);
    try { sessionStorage.removeItem(key(account)); } catch { /* Optional storage. */ }
    return context;
}

export function clearExchangeReturnContext(account: string): void {
    try { sessionStorage.removeItem(key(account)); } catch { /* Optional storage. */ }
}
