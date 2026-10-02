import type { CSSProperties, RefObject } from 'react';
import { Modal } from './ui/Modal';
import { GiCrossedSwords, GiBreastplate } from './icons/LightweightGameIcons';

export type NamedForgeAnimation = { kind: 'weapon' | 'armor'; phase: 'rolling' | 'reveal' };
export type NamedForgeRevealStat = { label: string; value: string };

/** The server has sealed these stats; keep the reveal open until the player continues. */
export function NamedForgeRevealModal({ kind, phase, stats, onContinue, returnFocusRef }: NamedForgeAnimation & {
    stats: NamedForgeRevealStat[];
    onContinue: () => void;
    returnFocusRef?: RefObject<HTMLElement | null>;
}) {
    const Icon = kind === 'weapon' ? GiCrossedSwords : GiBreastplate;
    const itemLabel = kind === 'weapon' ? 'Named Weapon' : 'Named Armor';
    const rolling = phase === 'rolling';
    const rows = rolling
        ? (kind === 'weapon' ? ['Edge', 'Reach', 'Combat tags'] : ['Armor grade', 'Guard matrix', 'Special sigil'])
            .map((label, index) => ({ label, value: ['READING', 'BINDING', 'ETCHING'][index] }))
        : stats;

    return <Modal
        open
        bare
        size="lg"
        ariaLabel={`${itemLabel} Roll`}
        onClose={rolling ? () => undefined : onContinue}
        disableBackdropClose
        disableEscapeClose={rolling}
        returnFocusRef={returnFocusRef}
        className="nf-modal"
        backdropClassName="nf-backdrop"
    >
        <section className={`nf nf--${kind} is-${phase}`} role="status" aria-live="polite" aria-atomic="true">
            <div className="nf-relic" aria-hidden="true"><span><Icon /></span></div>
            <div className="nf-copy">
                <span>{rolling ? 'Master forge · fate in motion' : 'One of one · roll sealed'}</span>
                <h3>{rolling ? `Rolling ${itemLabel}` : `${itemLabel} Awakened`}</h3>
                <p>{rolling ? 'Heat, chakra, and chance are converging…' : 'Your roll is revealed. Take a moment to inspect it.'}</p>
            </div>
            <div className="nf-stats">
                {rows.map((row, index) => <div className="nf-stat" key={`${row.label}-${index}`} style={{ '--i': index } as CSSProperties}>
                    <span>{row.label}</span><strong>{row.value}</strong>
                </div>)}
            </div>
            <div className="nf-progress" aria-hidden="true"><i /></div>
        </section>
        {!rolling && <div className="nf-actions">
            <p>{kind === 'weapon' ? 'Combat caps apply to rolled tag strengths. ' : ''}Continue to name and forge this item.</p>
            <button className="nw-roll" onClick={onContinue}>Continue to Forge</button>
        </div>}
    </Modal>;
}
