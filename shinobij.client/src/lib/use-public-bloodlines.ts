import { useEffect, useState } from 'react';
import type { ReviewBloodline } from '../types/combat';
import { normalizeJutsu } from './jutsu';
import { visiblePoll } from './poll';

// The gallery is presentation data. Fetch it only while the archive is open;
// it must never authorize a bloodline purchase, ownership, or combat loadout.
export function usePublicBloodlines(active: boolean, playerName: string): ReviewBloodline[] {
    const [bloodlines, setBloodlines] = useState<ReviewBloodline[]>([]);
    useEffect(() => {
        if (!active || !playerName) return;
        const controller = new AbortController();
        const refresh = async () => {
            try {
                const response = await fetch('/api/bloodlines/list', {
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
                });
                if (!response.ok) return;
                const data = await response.json() as { bloodlines?: ReviewBloodline[] };
                if (controller.signal.aborted) return;
                setBloodlines((data.bloodlines ?? []).map(bloodline => ({
                    ...bloodline,
                    jutsus: (bloodline.jutsus ?? []).map(normalizeJutsu),
                })));
            } catch { /* The next visible poll retries a failed gallery read. */ }
        };
        const stop = visiblePoll(refresh, 300_000, 0.1, { immediate: true });
        return () => { controller.abort(); stop(); };
    }, [active, playerName]);
    return bloodlines;
}
