/** A view owns its delayed effects, including callbacks that schedule more work. */
export function createOwnedTimeouts(schedule: (run: () => void, ms: number) => number, cancel: (id: number) => void) {
    const pending = new Set<number>();
    return {
        schedule(run: () => void, ms: number) {
            const id = schedule(() => { pending.delete(id); run(); }, ms);
            pending.add(id);
            return id;
        },
        cancel(id: number) { cancel(id); pending.delete(id); },
        clear() { pending.forEach(cancel); pending.clear(); },
        get size() { return pending.size; },
    };
}
