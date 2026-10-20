import type { LifeSceneView } from '../../../shared/sector-life';
import { noteServerTime } from './server-clock';

export type LifeReply = { ok: boolean; view?: LifeSceneView; error?: string; changed?: boolean };
export async function requestSectorLife(playerName: string, sector: number, signal?: AbortSignal, action?: { window: number; step: number }): Promise<LifeReply> {
    const sentAt = Date.now();
    try {
        const response = await fetch(action ? '/api/sector/life' : `/api/sector/life?${new URLSearchParams({ playerName, sector: String(sector) })}`, action
            ? { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, sector, ...action }) }
            : { signal });
        const data = await response.json();
        noteServerTime(data.serverNow, sentAt);
        const unavailable='The road activity could not be loaded.';
        if (!response.ok) return { ok: false, error: data.error ?? unavailable };
        if (!data.ok || !data.view || data.view.sector !== sector || !['active','aftermath','unattended'].includes(data.view.phase)) return { ok: false, error: unavailable };
        return data;
    } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, error: 'The connection was interrupted. Check the activity again.' };
    }
}
