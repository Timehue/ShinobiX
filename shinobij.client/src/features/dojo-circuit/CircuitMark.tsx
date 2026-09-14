import type { CircuitDiscipline } from '../../../../shared/dojo-circuit';
/** Native vector marks remain sharp at both passport and hero sizes. */
export function CircuitMark({ discipline, className = '' }: { discipline?: CircuitDiscipline; className?: string }) {
    return <svg className={`dc-mark ${className}`} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M32 3 53 15v34L32 61 11 49V15Z" /><path d="m32 8 17 10v28L32 56 15 46V18Z" opacity=".45" />
        {discipline === 'combat' ? <><path d="m21 17 24 25-6 6-24-25 1-7 5 1ZM43 17 19 42l6 6 24-25-1-7-5 1M16 40l11 11M37 51l11-11" /><path d="m19 45-4 5m30-5 4 5" /></>
            : discipline === 'cards' ? <><rect x="23" y="18" width="21" height="29" rx="2" transform="rotate(12 33 32)" /><path d="m20 20-5 24 6 2m12-21 6 8-6 8-6-8Z" /></>
                : discipline === 'pets' ? <><path d="M22 40c0-5 6-13 10-13s10 8 10 13c0 7-7 2-10 2s-10 5-10-2Z" /><ellipse cx="22" cy="27" rx="3" ry="4" transform="rotate(-25 22 27)" /><ellipse cx="29" cy="21" rx="3" ry="4" /><ellipse cx="37" cy="21" rx="3" ry="4" /><ellipse cx="44" cy="28" rx="3" ry="4" transform="rotate(25 44 28)" /></>
                    : <><path d="M19 40V25l13-8 13 8v15l-13 8ZM19 25l13 8 13-8M32 33v15" /><path d="m23 38 9-6 9 6M26 22v9m12-9v9" /></>}
    </svg>;
}
