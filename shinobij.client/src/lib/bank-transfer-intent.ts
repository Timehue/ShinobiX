type Direction = 'deposit' | 'withdraw';

const pending = new Map<string, string>();

function intentKey(playerName: string, direction: Direction, amount: number) {
    return `shinobix.bank-transfer:${JSON.stringify([playerName.trim().toLowerCase(), direction, amount])}`;
}

function retainedIntent(key: string, requestId: string) {
    return { requestId, complete: () => {
        if (pending.get(key) === requestId) pending.delete(key);
        try { if (sessionStorage.getItem(key) === requestId) sessionStorage.removeItem(key); } catch { /* in-memory fallback */ }
    } };
}

/** Inspect an uncertain transfer without creating a new operation. */
export function readPendingBankTransferIntent(playerName: string, direction: Direction, amount: number) {
    const key = intentKey(playerName, direction, amount);
    let requestId = pending.get(key);
    try { requestId = sessionStorage.getItem(key) || requestId; } catch { /* in-memory fallback */ }
    if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) return null;
    pending.set(key, requestId);
    return retainedIntent(key, requestId);
}

/** A retry of the same player, direction and amount keeps its original receipt ID. */
export function pendingBankTransferIntent(playerName: string, direction: Direction, amount: number) {
    const key = intentKey(playerName, direction, amount);
    const requestId = readPendingBankTransferIntent(playerName, direction, amount)?.requestId ?? crypto.randomUUID();
    pending.set(key, requestId);
    try { sessionStorage.setItem(key, requestId); } catch { /* in-memory fallback */ }
    return retainedIntent(key, requestId);
}
