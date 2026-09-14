export class PetSettlementRetryError extends Error {
    readonly retryAfterMs: number;
    constructor(message: string, retryAfterMs: number) {
        super(message);
        this.name = "PetSettlementRetryError";
        this.retryAfterMs = retryAfterMs;
    }
}

type Receipt = { error?: string; retryAfterMs?: number };

/** Retrying must send the identical sealed token and command transcript. A
 * stalled connection is bounded so the result UI can always offer that retry. */
export async function postPetBattleReceipt<T extends Receipt>(
    body: Record<string, unknown>,
    timeoutMs = 15_000,
): Promise<T> {
    const response = await fetch("/api/pet/battle-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null) as T | null;
    const retryAfterMs = Number(data?.retryAfterMs);
    if (response.status === 425 && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        throw new PetSettlementRetryError(data?.error || "Beastbound Warfront is still in progress.", retryAfterMs);
    }
    if (!response.ok) throw new Error(data?.error || "The arena could not record this pet battle.");
    if (!data) throw new Error("The arena returned an unreadable pet battle receipt.");
    return data;
}
