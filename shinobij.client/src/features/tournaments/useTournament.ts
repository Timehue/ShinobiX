import { useCallback, useEffect, useRef, useState } from 'react';
import type { TournamentResponse } from '../../../../shared/tournaments';
import { visiblePoll } from '../../lib/poll';
import { tournamentRequest } from './client';
export function useTournament(credential?: string) {
    const [data, setData] = useState<TournamentResponse | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(Date.now);
    const offset = useRef(0), generation = useRef(0), mutating = useRef(false), alive = useRef(true);
    const apply = useCallback((next: TournamentResponse) => {
        offset.current = next.serverNow - Date.now(); setData(next); setNow(next.serverNow);
    }, []);
    const refresh = useCallback(async () => {
        if (mutating.current) return;
        const request = ++generation.current;
        try { const next = await tournamentRequest(undefined, credential); if (alive.current && request === generation.current) { apply(next); setError(''); } }
        catch (e) { if (alive.current && request === generation.current) setError(e instanceof Error ? e.message : 'Unable to load tournaments.'); }
    }, [credential, apply]);
    useEffect(() => {
        alive.current = true;
        const stop = visiblePoll(refresh, 5000, .1, { immediate: true });
        const clock = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
        return () => { alive.current = false; stop(); window.clearInterval(clock); };
    }, [refresh]);
    const act = useCallback(async (action: Record<string, unknown>) => {
        if (mutating.current) return;
        const request = ++generation.current; mutating.current = true; setBusy(true); setError('');
        try { const next = await tournamentRequest(action, credential); if (alive.current && request === generation.current) apply(next); }
        catch (e) { if (alive.current && request === generation.current) setError(e instanceof Error ? e.message : 'Unable to update tournament.'); }
        finally { mutating.current = false; if (alive.current) setBusy(false); }
    }, [credential, apply]);
    return { data, error, busy, now, act, refresh };
}
export function tournamentCountdown(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
