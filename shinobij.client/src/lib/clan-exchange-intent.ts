import {clanExchangeIntentTime} from '../../../shared/clan-exchange-intent';
import {serverNow} from './server-clock';

const pending = new Map<string,string>();

/** Reuse the existing session-storage retry pattern without adding a UI step. */
export function pendingClanExchangeIntent(playerName: string, clan: string, itemId: string) {
    const key = `shinobix.clan-exchange:${JSON.stringify([playerName.trim().toLowerCase(),clan.trim().toLowerCase(),itemId])}`;
    let id = pending.get(key);
    try { id = sessionStorage.getItem(key) || id; } catch { /* in-memory fallback */ }
    if (clanExchangeIntentTime(id) === null) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        id = `cex-${Math.floor(serverNow())}-${Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')}`;
    }
    const requestId = id!;
    pending.set(key,requestId);
    try { sessionStorage.setItem(key,requestId); } catch { /* in-memory fallback */ }
    return {requestId, complete: () => {
        // A late response from an earlier request must not clear a newer intent.
        if (pending.get(key) === requestId) pending.delete(key);
        try { if (sessionStorage.getItem(key) === requestId) sessionStorage.removeItem(key); } catch { /* in-memory fallback */ }
    }};
}
