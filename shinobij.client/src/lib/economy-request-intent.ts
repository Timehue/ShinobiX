/*
 * One retry identity per logical economy action (issue #179).
 *
 * The shrine offering, bounty placement and clan / village treasury donation
 * endpoints settle each `requestId` exactly once (api/_save-debit-saga.ts):
 * sending the same id again returns the first result instead of charging
 * again, and finishes a charge whose second half never landed. That only helps
 * if a retry of the same action carries the same id, so the id is kept — in
 * memory and in sessionStorage, which survives a reload of the tab — until the
 * server gives an answer that cannot change on a retry. The pattern is the
 * Bank screen's (bank-transfer-intent.ts), generalized over the action.
 *
 * While an id is pending the screen must not refuse the action locally: after
 * a reload the balance may already show the charge whose credit the retry is
 * about to finish.
 */

const pending = new Map<string, string>();

export type EconomyIntentScope = 'shrine-offer' | 'bounty-place' | 'clan-donate' | 'village-donate';

export type EconomyIntent = { requestId: string; complete: () => void };

function intentKey(scope: EconomyIntentScope, parts: readonly unknown[]): string {
    return `shinobix.economy-intent:${scope}:${JSON.stringify(parts)}`;
}

function retained(key: string, requestId: string): EconomyIntent {
    return {
        requestId,
        complete: () => {
            // A late answer to an earlier attempt must not clear a newer intent.
            if (pending.get(key) === requestId) pending.delete(key);
            try { if (sessionStorage.getItem(key) === requestId) sessionStorage.removeItem(key); } catch { /* in-memory fallback */ }
        },
    };
}

/** An action already in flight or unconfirmed, without creating a new one. */
export function readPendingEconomyIntent(scope: EconomyIntentScope, parts: readonly unknown[]): EconomyIntent | null {
    const key = intentKey(scope, parts);
    let requestId = pending.get(key);
    try { requestId = sessionStorage.getItem(key) || requestId; } catch { /* in-memory fallback */ }
    if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) return null;
    pending.set(key, requestId);
    return retained(key, requestId);
}

/** The id to send: the pending one for this exact action, or a new one. */
export function pendingEconomyIntent(scope: EconomyIntentScope, parts: readonly unknown[]): EconomyIntent {
    const key = intentKey(scope, parts);
    const requestId = readPendingEconomyIntent(scope, parts)?.requestId ?? crypto.randomUUID();
    pending.set(key, requestId);
    try { sessionStorage.setItem(key, requestId); } catch { /* in-memory fallback */ }
    return retained(key, requestId);
}

/**
 * Whether an answer is final for this id. A success is. So is a refusal that
 * nothing about a retry can change (invalid, forbidden, missing, conflicting).
 * Everything else keeps the id: an expired login (401), a rate limit (429), a
 * 5xx — including the saga's 503 "refunded" and "pending" answers — and a
 * transport failure may all follow a charge whose answer was lost. A 409 that
 * asks for an administrator also keeps it, so pressing again repeats that
 * answer instead of starting a second charge.
 */
export function economyIntentSettled(status: number, body: unknown): boolean {
    if (status >= 200 && status < 300) return true;
    if (status === 409) return !(body && typeof body === 'object' && (body as { reconcile?: unknown }).reconcile === true);
    return status === 400 || status === 403 || status === 404 || status === 422;
}
