/** Combat completion and physical-outcome reporting share one receipt request. */
export function createWeeklyBossSettlementCoordinator(timeoutMs = 10_000) {
    let receipt: Promise<unknown> | null = null;
    return (request: () => Promise<unknown>): Promise<unknown> => {
        if (!receipt) {
            let timer: ReturnType<typeof setTimeout>;
            const pending = new Promise<unknown>((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Weekly Boss settlement timed out. Retry this saved attempt.')), timeoutMs);
                void Promise.resolve().then(request).then(resolve, reject);
            }).finally(() => clearTimeout(timer));
            receipt = pending;
            void pending.catch(() => { if (receipt === pending) receipt = null; });
        }
        return receipt;
    };
}
