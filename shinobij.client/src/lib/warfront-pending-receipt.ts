import { postPetBattleReceipt } from "./pet-battle-receipt";

export type PendingWarfrontReceipt = Record<string, unknown> & {
    playerName: string;
    battleToken: string;
    reportKey: string;
    warfrontPlan: Record<string, unknown>;
};
type ReceiptResponse = { error?: string; retryAfterMs?: number; character?: { name?: string } };
type Pending = { body: PendingWarfrontReceipt; response?: ReceiptResponse; request?: Promise<ReceiptResponse> };
// Session memory only. The battle token is never written to browser storage.
// Retain one exact report per account across screen navigation, then release it
// when the authoritative response has been applied. There are no polling loops.
const pending = new Map<string, Pending>();
const key = (name: string) => name.trim().toLowerCase();
export function readPendingWarfrontReceipt(playerName: string): PendingWarfrontReceipt | null {
    return pending.get(key(playerName))?.body ?? null;
}
export function queueWarfrontReceipt(body: PendingWarfrontReceipt): boolean {
    const previous = pending.get(key(body.playerName));
    if (previous) return previous.body.battleToken === body.battleToken && previous.body.reportKey === body.reportKey;
    if (pending.size >= 8) return false;
    pending.set(key(body.playerName), { body: structuredClone(body) });
    return true;
}
export async function sendQueuedWarfrontReceipt<T extends ReceiptResponse>(body: PendingWarfrontReceipt): Promise<T> {
    if (!queueWarfrontReceipt(body)) throw new Error("Finish recording the previous Warfront result before starting another.");
    const entry = pending.get(key(body.playerName))!;
    if (entry.response) return entry.response as T;
    if (entry.request) return entry.request as Promise<T>;
    const request = postPetBattleReceipt<T>(entry.body);
    entry.request = request;
    try {
        const response = await request;
        if (!response.character?.name || key(response.character.name) !== key(entry.body.playerName)) {
            throw new Error("The arena did not return this player's recorded roster. Retry Settlement.");
        }
        entry.response = response;
        return response;
    } finally { entry.request = undefined; }
}
export function clearPendingWarfrontReceipt(body: PendingWarfrontReceipt): void {
    const current = pending.get(key(body.playerName));
    if (current?.body.battleToken === body.battleToken && current.body.reportKey === body.reportKey) pending.delete(key(body.playerName));
}
