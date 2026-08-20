import { saveConflictAccountKey } from "./save-conflict";

type MutableNumberRef = { current: number };

/** Binds one boot/login/create request chain to a unique client generation. */
export function beginSessionLoad(generationRef: MutableNumberRef, accountName: string) {
    const generation = ++generationRef.current;
    return {
        accountKey: saveConflictAccountKey(accountName),
        isCurrent: () => generationRef.current === generation,
        retire: () => { if (generationRef.current === generation) generationRef.current += 1; },
    };
}

export async function sessionLoadFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15_000): Promise<Response> {
    // AbortSignal.timeout (not a self-cleared controller): the old shape
    // disarmed its timer the moment HEADERS arrived, leaving the body read —
    // the largest thing the entry path streams — unbounded. This signal stays
    // armed through body consumption, so `await res.json()` at the call sites
    // inherits the same deadline instead of hanging a login gate forever.
    return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
