import { useEffect, useRef } from 'react';
import { useCircuit } from './useCircuit';
import { CircuitMark } from './CircuitMark';
import ceremony from '../../assets/dojo-circuit/ceremony-mobile.webp';
import './dojo-circuit.css';

/** AI card settlement is already server-owned; the passport check-in remains explicit. */
export function CircuitCardResult({ won, draw, onReturn }: { won: boolean; draw: boolean; onReturn: () => void }) {
    return <section className="dojo-circuit dc-combat-result dc-card-result" aria-label="Circuit card trial result"><img src={ceremony} alt="" /><div className="dc-result-copy"><span className="dc-eyebrow">DOJO CIRCUIT · CARD CLASH</span><CircuitMark discipline="cards" /><h2>{won ? 'A hand well played.' : draw ? 'An unfinished chapter.' : 'A wiser return.'}</h2><p>{won ? 'Your duel is complete. Return to the Circuit scribe and record your victory before the event closes to earn the Seal of Insight.' : 'No earned seals are lost. Return to the Circuit to resume this trial or choose your next step.'}</p><div><button className="dc-primary" onClick={onReturn}>Return to Circuit <span aria-hidden="true">↗</span></button></div></div></section>;
}

export function CircuitCombatResult({ playerName, won, draw, settleState, onRetry, onExit }: {
    playerName: string; won: boolean; draw: boolean; settleState: 'idle' | 'pending' | 'settled' | 'failed'; onRetry: () => void; onExit: () => void;
}) {
    const { data, refresh } = useCircuit();
    const dialog = useRef<HTMLDivElement>(null);
    useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus(); }, []);
    useEffect(() => { if (settleState === 'settled') void refresh(); }, [settleState, refresh]);
    const earned = data?.event?.entrants.find(e => e.name.toLowerCase() === playerName.toLowerCase())?.seals.some(s => s.discipline === 'combat');
    return <div ref={dialog} tabIndex={-1} className="dc-result-overlay" role="dialog" aria-modal="true" aria-label="Circuit trial result" onKeyDown={e => {
        if (e.key === 'Escape' && settleState !== 'pending') { e.preventDefault(); e.stopPropagation(); onExit(); }
        if (e.key !== 'Tab') return;
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const first = buttons[0]; const last = buttons.at(-1);
        if (!first) { e.preventDefault(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus(); }
    }}><section className="dojo-circuit dc-combat-result">
        <img src={ceremony} alt="" /><div className="dc-result-copy"><span className="dc-eyebrow">DOJO CIRCUIT · SHINOBI COMBAT</span><CircuitMark discipline="combat" /><h2>{won ? earned ? 'Courage, recorded.' : 'A trial won.' : draw ? 'The trial is drawn.' : 'Every path has a next step.'}</h2>
            <p aria-live="polite">{settleState === 'failed' ? 'Your result could not be confirmed. Retry verification, or return to the Circuit and resume recovery later.' : settleState !== 'settled' ? 'The dojo scribe is verifying the result…' : earned ? 'The Seal of Courage is on your passport. Return to the Circuit to choose your next step.' : won ? 'Your fight is verified. Return to the Circuit to check your passport and event status.' : 'No Circuit progress is lost. Return to the dojo when you are ready to try again.'}</p>
            <div>{settleState === 'failed' && <button className="dc-secondary" onClick={onRetry}>Retry verification</button>}<button className="dc-primary" disabled={settleState === 'pending'} onClick={onExit}>Return to Circuit <span aria-hidden="true">↗</span></button></div>
        </div></section></div>;
}
