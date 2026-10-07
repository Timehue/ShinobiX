import { useEffect, type MutableRefObject } from 'react';

/** Await an existing heartbeat, including its normal inbox and session handling. */
export function createRoadPositionConfirmation(beat: () => void, timeoutMs = 12_000) {
    const waiting = new Set<{ sector: number; tile: number; finish: (accepted: boolean) => void }>();
    return {
        request(sector: number, tile: number): Promise<boolean> {
            return new Promise(resolve => {
                const entry = { sector, tile, finish: (accepted: boolean) => {
                    clearTimeout(timer); waiting.delete(entry); resolve(accepted);
                } };
                const timer = setTimeout(() => entry.finish(false), timeoutMs);
                waiting.add(entry);
                beat();
            });
        },
        observe(sector: unknown, tile: unknown) {
            for (const entry of waiting) if (entry.sector === sector && entry.tile === tile) entry.finish(true);
        },
        dispose() { for (const entry of waiting) entry.finish(false); },
    };
}

let active: { name: string; confirmation: ReturnType<typeof createRoadPositionConfirmation> } | undefined;
export function useRoadPositionHeartbeat(name: string | undefined, heartbeat: MutableRefObject<() => void>) {
    useEffect(() => {
        if (!name) return;
        const connection = { name: name.toLowerCase(), confirmation: createRoadPositionConfirmation(() => heartbeat.current()) };
        active = connection;
        return () => { connection.confirmation.dispose(); if (active === connection) active = undefined; };
    }, [name, heartbeat]);
}
export function observeRoadPosition(name: string, sector: unknown, tile: unknown) {
    if (active?.name === name.toLowerCase()) active.confirmation.observe(sector, tile);
}
export function confirmRoadPosition(name: string, sector: number, tile: number): Promise<boolean> {
    return active?.name === name.toLowerCase() ? active.confirmation.request(sector, tile) : Promise.resolve(false);
}
