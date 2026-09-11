import { useCallback, useEffect, useRef, useState } from 'react';
import type { CircuitResponse } from '../../../../shared/dojo-circuit';
import { visiblePoll } from '../../lib/poll';
import { fetchCircuit } from './client';
export function useCircuit(credential?: string) {
    const [data, setData] = useState<CircuitResponse | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const generation = useRef(0);
    const mutating = useRef(false);
    const alive = useRef(true);
    const refresh = useCallback(async () => {
        if (mutating.current) return;
        const request = ++generation.current;
        try { const next = await fetchCircuit(undefined, credential); if (alive.current && request === generation.current) { setData(next); setError(''); } }
        catch (e) { if (alive.current && request === generation.current) setError(e instanceof Error ? e.message : 'Unable to reach the Circuit.'); }
    }, [credential]);
    useEffect(() => { alive.current = true; const stop = visiblePoll(refresh, 15_000, .1, { immediate: true }); return () => { alive.current = false; ++generation.current; stop(); }; }, [refresh]);
    const act = useCallback(async (action: Record<string, unknown>) => {
        if (mutating.current) return null;
        const request = ++generation.current; mutating.current = true; setBusy(true); setError('');
        try { const next = await fetchCircuit(action, credential); if (alive.current && request === generation.current) { setData(next); return next; } return null; }
        catch (e) { if (alive.current && request === generation.current) setError(e instanceof Error ? e.message : 'Unable to update the Circuit.'); return null; }
        finally { mutating.current = false; if (alive.current) setBusy(false); }
    }, [credential]);
    return { data, error, busy, act, refresh };
}
