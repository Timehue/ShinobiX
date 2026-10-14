/** Owns only a mounted map's presentation callbacks. Disposing the map must
 * never cancel the server's durable journey, but must retire its local work. */
export function createTravelPresentationScope(timer = {
    set: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clear: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
}) {
    let active = true;
    let arrival: ReturnType<typeof setTimeout> | undefined;
    const cancelArrival = () => {
        if (arrival !== undefined) timer.clear(arrival);
        arrival = undefined;
    };
    return {
        isCurrent: () => active,
        scheduleArrival(callback: () => void, ms: number) {
            cancelArrival();
            if (!active) return;
            arrival = timer.set(() => {
                arrival = undefined;
                if (active) callback();
            }, ms);
        },
        dispose() { active = false; cancelArrival(); },
    };
}

/** Capture the map/account lifetime, but read position and travel locks live. */
export function createSectorActionGuard(
    presentation: { isCurrent: () => boolean },
    position: () => { sector: number; traveling: boolean },
    requestInFlight: () => boolean,
    sector: number,
): () => boolean {
    return () => {
        const current = position();
        return presentation.isCurrent() && !requestInFlight() && !current.traveling && current.sector === sector;
    };
}
