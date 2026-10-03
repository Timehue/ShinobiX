const running = new Set<Promise<unknown>>();
let stopping = false;

export function backgroundWorkStopped(): boolean { return stopping; }

/** Admit one whole job, retaining it until all its asynchronous work settles. */
export function runBackgroundWork<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (stopping) return Promise.resolve(undefined);
    const work = Promise.resolve().then(fn);
    running.add(work);
    void work.finally(() => running.delete(work)).catch(() => undefined);
    return work;
}

/** Stop admission synchronously; drain jobs already admitted before pool close. */
export function stopBackgroundWork(): void { stopping = true; }

export async function drainBackgroundWork(): Promise<void> {
    while (running.size) await Promise.allSettled([...running]);
}
