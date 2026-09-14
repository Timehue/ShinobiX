/*
 * Client wrapper for direct player-to-player transfers (api/player/trade.ts).
 * Plain fetch (auth headers come from the global authFetch interceptor). The
 * server is authoritative for the debit/credit/burn; the caller reflects the
 * returned `debit` locally so the autosave converges. KEEP the tax + currency
 * list in sync with api/player/_trade-core.ts.
 */

export const TRADE_TAX_PCT = 0.10;

export type TradeCurrency = 'ryo' | 'fateShards' | 'boneCharms' | 'auraStones';
export const TRADE_CURRENCIES: TradeCurrency[] = ['ryo', 'fateShards', 'boneCharms', 'auraStones'];
export const TRADE_CURRENCY_LABELS: Record<TradeCurrency, string> = {
    ryo: 'Ryo',
    fateShards: 'Fate Shards',
    boneCharms: 'Bone Charms',
    auraStones: 'Aura Stones',
};
export const TRADE_MINS: Record<TradeCurrency, number> = { ryo: 1_000, fateShards: 1, boneCharms: 1, auraStones: 1 };
export const TRADE_CAPS: Record<TradeCurrency, number> = { ryo: 200_000, fateShards: 200, boneCharms: 200, auraStones: 200 };

/** Recipient receives this; the rest of `amount` is burned. */
export function previewCredit(amount: number): number {
    return Math.max(0, Math.floor(Math.max(0, Math.floor(amount)) * (1 - TRADE_TAX_PCT)));
}

export type TradeResult = { ok: boolean; error?: string; debit?: number; credit?: number; burned?: number; toPlayer?: string; senderBalance?: number; duplicate?: boolean; pending?: boolean };

/*
 * Nonce retention (F15). The nonce is the transfer's replay identity on the
 * server: the same nonce with the same recipient/currency/amount returns the
 * same operation instead of moving money again. It is therefore generated ONCE
 * per user intent and kept while that intent is unconfirmed — a network
 * failure, a 5xx, or a "still settling" answer — so the player's own retry of
 * the same transfer hits the same server record. A definitive answer (success,
 * or a 4xx that ends the intent) releases it; a different intent gets its own.
 */
let unconfirmed: { key: string; nonce: string } | null = null;

export function tradeIntentKey(playerName: string, toPlayer: string, currency: TradeCurrency, amount: number): string {
    return `${playerName.trim().toLowerCase()}|${toPlayer.trim().toLowerCase()}|${currency}|${Math.floor(amount)}`;
}

export function tradeNonceFor(key: string): string {
    if (unconfirmed?.key === key) return unconfirmed.nonce;
    const nonce = `${key.split('|')[2] ?? 'x'}-${Math.floor(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
    unconfirmed = { key, nonce };
    return nonce;
}

/** Release the retained nonce once the intent has a definitive answer. */
export function settleTradeNonce(key: string, definitive: boolean): void {
    if (definitive && unconfirmed?.key === key) unconfirmed = null;
}

export function resetTradeNonceState(): void {
    unconfirmed = null;
}

export async function sendCurrency(playerName: string, toPlayer: string, currency: TradeCurrency, amount: number): Promise<TradeResult> {
    const key = tradeIntentKey(playerName, toPlayer, currency, amount);
    const nonce = tradeNonceFor(key);
    try {
        const res = await fetch('/api/player/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, toPlayer, currency, amount, nonce }),
        });
        const data = await res.json().catch(() => ({})) as TradeResult;
        // Definitive: success, or a client-side refusal (4xx) that is not the
        // "still settling" answer — those end the intent. A 409 pending or any
        // 5xx keeps the nonce so the retry resumes the SAME operation.
        settleTradeNonce(key, res.ok || (res.status >= 400 && res.status < 500 && data.pending !== true));
        if (!res.ok || !data.ok) return { ok: false, error: data.error || 'Could not send.', ...(data.pending ? { pending: true } : {}) };
        return data;
    } catch {
        return { ok: false, error: 'Transfer unconfirmed. Refresh before retrying.' };
    }
}
