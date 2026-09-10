/** Beat work is cancelled when playback advances. Effect removals live across
 * beats, but both scopes must be retired when the battle closes. */
export function createShowdownTimerScope(host: {
    setTimeout: (callback: () => void, delay: number) => number;
    clearTimeout: (id: number) => void;
}) {
    const pending = new Set<number>();
    return {
        get size() { return pending.size; },
        schedule(callback: () => void, delay: number) {
            const id = host.setTimeout(() => {
                pending.delete(id);
                callback();
            }, delay);
            pending.add(id);
        },
        clear() {
            for (const id of pending) host.clearTimeout(id);
            pending.clear();
        },
    };
}
