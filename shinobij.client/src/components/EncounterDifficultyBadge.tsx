import type { OrdinaryPveEncounter } from '../../../shared/ordinary-pve-encounter';
import { encounterLabel, ORDINARY_PVE_TELLS } from '../lib/ordinary-pve-presentation';

export function EncounterDifficultyBadge({ encounter, showTell = false }: { encounter: OrdinaryPveEncounter; showTell?: boolean }) {
    return <><span className={`encounter-difficulty encounter-difficulty--${encounter.difficulty}`}
        title={ORDINARY_PVE_TELLS[encounter.difficulty]} data-encounter-id={encounter.id}
        style={{ display: 'inline-block', border: '1px solid currentColor', borderRadius: 5, padding: '2px 6px', fontSize: '.72rem', lineHeight: 1.4 }}>
        {encounterLabel(encounter)}
    </span>{showTell && <p style={{ fontSize: '.74rem', margin: '6px 0' }}>{ORDINARY_PVE_TELLS[encounter.difficulty]}</p>}</>;
}
