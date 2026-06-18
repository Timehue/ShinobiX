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

export type TradeResult = { ok: boolean; error?: string; debit?: number; credit?: number; burned?: number; toPlayer?: string; duplicate?: boolean };

export async function sendCurrency(playerName: string, toPlayer: string, currency: TradeCurrency, amount: number): Promise<TradeResult> {
    // A per-attempt nonce makes a network-retry idempotent server-side (no double debit).
    const nonce = `${currency}-${amount}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
        const res = await fetch('/api/player/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, toPlayer, currency, amount, nonce }),
        });
        const data = await res.json().catch(() => ({})) as TradeResult;
        if (!res.ok || !data.ok) return { ok: false, error: data.error || 'Could not send.' };
        return data;
    } catch {
        return { ok: false, error: 'Could not send. Please try again.' };
    }
}
