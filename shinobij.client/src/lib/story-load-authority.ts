function normalizedAccount(value: string): string {
    return value.trim().toLowerCase();
}

export type StoryContinuation<T> =
    | { current: true; value: T }
    | { current: false };

/** Resolve lazy story content without allowing an old effect or account to
 * mutate the session that replaced it while the content request was pending. */
export async function resolveStoryContinuation<T>(
    load: () => Promise<T>,
    originatingAccount: string,
    activeAccount: () => string,
    isStale: () => boolean = () => false,
): Promise<StoryContinuation<T>> {
    const origin = normalizedAccount(originatingAccount);
    const value = await load();
    if (!origin || isStale() || normalizedAccount(activeAccount()) !== origin) return { current: false };
    return { current: true, value };
}
