import { AMBIGUOUS_ACTION_MESSAGE } from "./ambiguous-action";

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
 * same operation instead of moving money again, and finishes one that was
 * interrupted. It is therefore generated ONCE per user intent and kept while
 * that intent is unconfirmed — a network failure, a timeout, a 5xx, a reply
 * without a confirmation, or a "still settling" answer — so the player's own
 * retry of the same transfer hits the same server record. A definitive answer
 * (success, or a refusal that ends the intent) releases it; a different intent
 * gets its own, and starting one never drops another's.
 *
 * It is kept in sessionStorage as well as in memory. "Refresh before retrying"
 * is what an unconfirmed transfer tells the player, and a nonce kept only in
 * memory did not survive that refresh: the retry became a second transfer.
 */
const unconfirmed = new Map<string, string>();
const STORAGE_PREFIX = 'shinobix.trade-intent:';
const NONCE_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

export function tradeIntentKey(playerName: string, toPlayer: string, currency: TradeCurrency, amount: number): string {
    return `${playerName.trim().toLowerCase()}|${toPlayer.trim().toLowerCase()}|${currency}|${Math.floor(amount)}`;
}

function storedNonce(key: string): string | null {
    try {
        const nonce = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
        return nonce && NONCE_SHAPE.test(nonce) ? nonce : null;
    } catch {
        return null;
    }
}

export function tradeNonceFor(key: string): string {
    const nonce = unconfirmed.get(key)
        ?? storedNonce(key)
        ?? `${key.split('|')[2] ?? 'x'}-${Math.floor(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
    unconfirmed.set(key, nonce);
    try { sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, nonce); } catch { /* in-memory fallback */ }
    return nonce;
}

/**
 * Release the retained nonce once the intent has a definitive answer. With
 * `nonce`, only while it is still the one retained: a late answer to an older
 * attempt must not release a newer attempt of the same intent.
 */
export function settleTradeNonce(key: string, definitive: boolean, nonce?: string): void {
    if (!definitive) return;
    if (nonce !== undefined && (unconfirmed.get(key) ?? storedNonce(key)) !== nonce) return;
    unconfirmed.delete(key);
    try { sessionStorage.removeItem(`${STORAGE_PREFIX}${key}`); } catch { /* in-memory fallback */ }
}

export function resetTradeNonceState(): void {
    for (const key of [...unconfirmed.keys()]) settleTradeNonce(key, true);
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
        // Definitive: a confirmed success, or a refusal (4xx) that is neither
        // a timeout nor the "still settling" answer — those end the intent.
        // Anything else may have moved money, so the nonce is kept and the
        // retry resumes the SAME operation.
        const confirmed = res.ok && data.ok === true;
        const refused = res.status >= 400 && res.status < 500 && res.status !== 408 && data.pending !== true;
        settleTradeNonce(key, confirmed || refused, nonce);
        if (!res.ok || !data.ok) return {
            ok: false,
            // A lost acknowledgement can follow a committed transfer; do not
            // invite a blind retry. (The retained nonce makes a retry safe.)
            error: res.status === 408 || res.status >= 500 || data.pending || (res.ok && !data.ok)
                ? AMBIGUOUS_ACTION_MESSAGE
                : data.error || 'Could not send.',
            ...(data.pending ? { pending: true } : {}),
        };
        return data;
    } catch {
        return { ok: false, error: 'Transfer unconfirmed. Refresh before retrying.' };
    }
}
