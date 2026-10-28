import { useEffect, useState } from 'react';
import type { PlayerRecord } from '../types/character';
import { visiblePoll } from './poll';

/** Small sector read runs independently of the expensive public directory.
 * Keep the directory as an initial/offline fallback, but an empty fresh snapshot
 * is authoritative too (a KO or reconnect must remove the old sleeper). */
export function useSectorSleepers(sector: number | null, fallback: readonly PlayerRecord[]): readonly PlayerRecord[] {
    const [snapshot, setSnapshot] = useState<{ sector: number; players: PlayerRecord[] } | null>(null);
    useEffect(() => {
        if (sector == null || sector < 1) return;
        const controller = new AbortController();
        const stop = visiblePoll(async () => {
            try {
                const response = await fetch(`/api/player/roster?sector=${sector}`, {
                    cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
                });
                if (!response.ok) return;
                const data = await response.json() as { sector?: number; sleepers?: PlayerRecord[] };
                if (controller.signal.aborted || data.sector !== sector || !Array.isArray(data.sleepers)) return;
                const players = data.sleepers;
                setSnapshot(previous => previous?.sector === sector && JSON.stringify(previous.players) === JSON.stringify(players)
                    ? previous : { sector, players });
            } catch { /* retain the last confirmed view; the next visible poll retries */ }
        }, 5_000, 0.1, { immediate: true });
        return () => { controller.abort(); stop(); };
    }, [sector]);
    return snapshot?.sector === sector ? snapshot.players : fallback;
}
