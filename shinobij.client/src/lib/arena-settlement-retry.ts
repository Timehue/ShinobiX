import { abortableDelay } from './pvp-session-runtime';

/** One mounted fight owns its retries. A completed attempt releases its deadline;
 * leaving the fight cancels pending requests and backoff without losing the
 * server's recoverable settlement receipt. */
export async function retryArenaSettlement<T>(
    settle: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
    { timeoutMs = 12_000, backoffMs = 600 } = {},
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
            const controller = new AbortController();
            let timeout: ReturnType<typeof setTimeout> | undefined;
            let onAbort: () => void = () => {};
            try {
                return await new Promise<T>((resolve, reject) => {
                    onAbort = () => { controller.abort(signal.reason); reject(signal.reason); };
                    signal.addEventListener('abort', onAbort, { once: true });
                    timeout = setTimeout(() => {
                        const error = new Error('settle attempt timed out');
                        controller.abort(error); reject(error);
                    }, timeoutMs);
                    // Defer invocation so a StrictMode cleanup can cancel the
                    // first mount before it dispatches a duplicate mutation.
                    void Promise.resolve().then(() => {
                        controller.signal.throwIfAborted();
                        return settle(controller.signal);
                    }).then(resolve, reject);
                });
            } finally {
                clearTimeout(timeout);
                signal.removeEventListener('abort', onAbort);
            }
        } catch (error) {
            signal.throwIfAborted();
            if (attempt === 3) throw error;
            await abortableDelay(backoffMs * 2 ** attempt, signal);
        }
    }
}
