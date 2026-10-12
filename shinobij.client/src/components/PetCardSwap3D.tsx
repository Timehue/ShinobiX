import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { PetSummon3D } from './PetSummon3D';

function Committed({ serial, onCommit }: { serial: number; onCommit: (serial: number, mounted: boolean) => void }) {
    useEffect(() => { onCommit(serial, true); return () => { onCommit(serial, false); }; }, [serial, onCommit]);
    return null;
}

/** Retain the previous companion until its recall ends, then release the new one. */
export function PetCardSwap3D({ identity, children, reducedMotion = false, effectScale = 1, onComplete }: {
    identity: string; children: ReactNode; reducedMotion?: boolean; effectScale?: number; onComplete?: () => void;
}) {
    const [state, setState] = useState(() => ({ identity, serial: 0, entries: [{ serial: 0, content: children }] }));
    const [committed, setCommitted] = useState<ReadonlySet<number>>(() => new Set());
    const markCommitted = useCallback((serial: number, mounted: boolean) => {
        setCommitted(previous => {
            if (previous.has(serial) === mounted) return previous;
            const next = new Set(previous);
            if (mounted) next.add(serial); else next.delete(serial);
            return next;
        });
    }, []);
    if (state.identity !== identity) {
        const serial = state.serial + 1;
        // A replaced model that is still loading never entered the field. Drop
        // it immediately instead of making the next summon wait for its download.
        setState({ identity, serial, entries: [...state.entries.filter(entry => committed.has(entry.serial)), { serial, content: children }] });
    }
    return <>{state.entries.map(entry => {
        const current = entry.serial === state.serial;
        return <Suspense key={entry.serial} fallback={null}><PetSummon3D present={current} playing={!current || state.entries.length === 1}
            effectScale={effectScale} reducedMotion={reducedMotion}
            onComplete={current ? onComplete : undefined}
            onRecallComplete={current ? undefined : () => setState(previous => ({ ...previous, entries: previous.entries.filter(item => item.serial !== entry.serial) }))}>
            {current ? children : entry.content}
            <Committed serial={entry.serial} onCommit={markCommitted} />
        </PetSummon3D></Suspense>;
    })}</>;
}
