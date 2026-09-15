import type { ExchangeListing, ExchangeOwnedAsset } from '../../../shared/sunscar-exchange';
import type { Character } from '../types/character';
import type { GameItem } from '../types/combat';

export type ExchangeSnapshot = {
    ok: true; listings: ExchangeListing[]; activity: ExchangeListing[];
    inventory: ExchangeOwnedAsset[]; character: Character; _saveVersion: unknown;
    creatorItems: GameItem[]; recoveryErrors: string[];
};
export type ExchangeRequest = { action: 'browse' | 'list' | 'buy' | 'cancel'; [key: string]: unknown };
export class ExchangeRequestError extends Error {
    readonly uncertain: boolean;
    constructor(message: string, uncertain: boolean) { super(message); this.uncertain = uncertain; }
}
export async function requestExchange(playerName: string, action: ExchangeRequest, signal?: AbortSignal): Promise<ExchangeSnapshot> {
    let response: Response;
    try {
        const timeout = AbortSignal.timeout(30_000);
        response = await fetch('/api/festival/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action, playerName }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new ExchangeRequestError('Connection interrupted. Retry the saved trade to check its outcome safely.', true);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new ExchangeRequestError(data?.error || 'The Exchange could not be reached. Please retry.', response.ok || response.status >= 500 || !!data?.pending);
    if (!data.character || !Number.isSafeInteger(data._saveVersion) || !Array.isArray(data.listings) || !Array.isArray(data.inventory) || !Array.isArray(data.activity)) {
        throw new ExchangeRequestError('The trade response was incomplete. Retry to confirm its outcome safely.', true);
    }
    return data as ExchangeSnapshot;
}
const pendingKey = (player: string) => `sunscar-exchange:pending:${player.trim().toLowerCase()}`;
export function pendingExchangeRequest(player: string): ExchangeRequest | null {
    try {
        const raw = JSON.parse(sessionStorage.getItem(pendingKey(player)) || 'null');
        return raw && ['list', 'buy', 'cancel'].includes(raw.action) ? raw as ExchangeRequest : null;
    } catch { return null; }
}
export function savePendingExchangeRequest(player: string, request: ExchangeRequest | null): void {
    try { if (request) sessionStorage.setItem(pendingKey(player), JSON.stringify(request)); else sessionStorage.removeItem(pendingKey(player)); } catch { /* In-memory retry remains available. */ }
}
