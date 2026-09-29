import { useEffect, useLayoutEffect, useRef } from 'react';
import { createTravelPresentationScope } from './travel-presentation';
import { travelMaskMs } from './travel-mask';

/** The shell's Village shortcut owns its journey across WorldMap mounts. */
export function useHomeVillageTravel(options: {
    name: string | undefined;
    onStart: (arrivalAt: number) => void;
    onArrival: () => void;
    onError: (message: string) => void;
}) {
    const latest = useRef(options);
    useLayoutEffect(() => { latest.current = options; });
    const scope = useRef(createTravelPresentationScope());
    const busy = useRef(false);
    useEffect(() => {
        const active = createTravelPresentationScope();
        scope.current = active;
        busy.current = false;
        return () => active.dispose();
    }, [options.name]);

    return {
        isBusy: () => busy.current,
        async start() {
            if (!latest.current.name || busy.current) return;
            busy.current = true;
            const active = scope.current;
            const owner = latest.current.name;
            const isCurrent = () => active.isCurrent() && latest.current.name === owner;
            try {
                const response = await fetch('/api/player/travel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destinationSector: 0 }),
                    signal: AbortSignal.timeout(12_000),
                });
                const data = await response.json().catch(() => null) as { arrivalAt?: number; travelMs?: number; error?: string } | null;
                if (!isCurrent()) return;
                if (!response.ok || !data?.arrivalAt) {
                    busy.current = false;
                    latest.current.onError(data?.error || 'Could not start travel. Please try again.');
                    return;
                }
                const ms = travelMaskMs(data.travelMs);
                const arrive = () => {
                    if (!isCurrent()) return;
                    busy.current = false;
                    latest.current.onArrival();
                };
                if (ms === 0) { arrive(); return; }
                latest.current.onStart(Date.now() + ms);
                active.scheduleArrival(arrive, ms);
            } catch {
                if (!isCurrent()) return;
                busy.current = false;
                latest.current.onError('Could not reach the travel server. Please try again.');
            }
        },
    };
}
