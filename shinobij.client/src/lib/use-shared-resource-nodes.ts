import { useEffect, useRef, useState } from 'react';
import { resourceRequest } from './resource-api';
import type { SharedResourceNodeView } from '../../../shared/shared-resource-node';

/** Read-only world view; never applies a character snapshot over a newer save.
 * One request at a time, paused in hidden tabs, discarded on sector/account switch. */
export function useSharedResourceNodes(name: string, sector: number) {
    const [snapshot, setSnapshot] = useState<{ name: string; sector: number; nodes: Record<string, SharedResourceNodeView> }>();
    const [error, setError] = useState('');
    const refreshRef = useRef<() => void>(() => {});
    useEffect(() => {
        let alive = true, pending = false, rerun = false;
        async function refresh() {
            if (!alive || document.hidden) return;
            if (pending) { rerun = true; return; }
            pending = true;
            try {
                const result = await resourceRequest({ action: 'nodes', playerName: name });
                if (!alive) return;
                if (!result.ok || !result.nodes || result.sector !== sector) {
                    setError(result.error ?? 'Shared node availability is reconnecting.');
                    return;
                }
                setSnapshot({ name, sector, nodes: result.nodes }); setError('');
            } finally {
                pending = false;
                if (alive && rerun) { rerun = false; void refresh(); }
            }
        }
        refreshRef.current = () => { void refresh(); };
        void refresh();
        const timer = window.setInterval(() => { void refresh(); }, 5000);
        document.addEventListener('visibilitychange', refreshRef.current);
        const onVisibility = refreshRef.current;
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
    }, [name, sector]);
    return { nodes: snapshot?.name === name && snapshot.sector === sector ? snapshot.nodes : undefined,
        error, refresh: () => refreshRef.current() };
}
