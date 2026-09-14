import {clanExchangeIntentTime} from '../../../shared/clan-exchange-intent';
import {serverNow} from './server-clock';

const pending = new Map<string,string>();

function intentKey(playerName: string, clan: string, itemId: string) {
    return `shinobix.clan-exchange:${JSON.stringify([playerName.trim().toLowerCase(),clan.trim().toLowerCase(),itemId])}`;
}

function retainedIntent(key: string, requestId: string) {
    return {requestId, complete: () => {
        // A late response from an earlier request must not clear a newer intent.
        if (pending.get(key) === requestId) pending.delete(key);
        try { if (sessionStorage.getItem(key) === requestId) sessionStorage.removeItem(key); } catch { /* in-memory fallback */ }
    }};
}

/** Reading for recovery must never create a purchase. */
export function readPendingClanExchangeIntent(playerName: string, clan: string, itemId: string) {
    const key = intentKey(playerName, clan, itemId);
    let id = pending.get(key);
    try { id = sessionStorage.getItem(key) || id; } catch { /* in-memory fallback */ }
    if (clanExchangeIntentTime(id) === null) return null;
    pending.set(key, id!);
    return retainedIntent(key, id!);
}

/** Reuse the existing session-storage retry pattern without adding a UI step. */
export function pendingClanExchangeIntent(playerName: string, clan: string, itemId: string) {
    const key = intentKey(playerName, clan, itemId);
    let requestId = readPendingClanExchangeIntent(playerName, clan, itemId)?.requestId;
    if (!requestId) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        requestId = `cex-${Math.floor(serverNow())}-${Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')}`;
    }
    // Preserve the retry write when storage becomes available after an outage.
    pending.set(key,requestId);
    try { sessionStorage.setItem(key,requestId); } catch { /* in-memory fallback */ }
    return retainedIntent(key, requestId);
}
