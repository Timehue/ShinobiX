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
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    finally { window.clearTimeout(timeoutId); }
}
