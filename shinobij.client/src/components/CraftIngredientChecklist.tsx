import type { CraftChecklistRow } from '../lib/craft-ingredient-checklist';
import './craft-ingredient-checklist.css';

const STATE_TEXT = { missing: 'missing', partial: 'partly gathered', done: 'ready' } as const;

/** Forge card ingredient list: one row per material, still-needed rows first. */
export function CraftIngredientChecklist({ rows }: { rows: readonly CraftChecklistRow[] }) {
    if (!rows.length) return null;
    return (
        <ul className="cf-checklist" aria-label="Materials">
            {rows.map(row => (
                <li key={row.label} className="cf-check-row" data-state={row.state} data-ingredient={row.label} title={row.label}>
                    <span className="cf-check-mark" aria-hidden="true">{row.state === 'done' ? '✓' : ''}</span>
                    <span className="cf-check-name">
                        {row.name}
                        {row.orBetter && <><span className="cf-check-grade" aria-hidden="true">+</span><span className="cf-sr-only"> or better</span></>}
                    </span>
                    <span className="cf-check-count">
                        {row.have}/{row.need}
                        {row.extra > 0 && <span className="cf-check-extra"> +{row.extra}</span>}
                        <span className="cf-sr-only">, {STATE_TEXT[row.state]}</span>
                    </span>
                </li>
            ))}
        </ul>
    );
}
