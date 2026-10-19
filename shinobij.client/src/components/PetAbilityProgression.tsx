import { petSignatureMasteryDescription } from '../../../shared/pet-ability-mastery';
import type { Pet } from '../types/pet';
import { PET_MASTERY_LABELS, petProgressionPresentation } from '../lib/pet-progression-presentation';
import type { PetAbilityTier, PetAbilityUpgrade } from '../../../shared/pet-ability-progression';
import '../styles/pet-progression.css';

const MASTERY_HINTS: Record<PetAbilityUpgrade, string> = {
    'utility-mastery': 'Replaces earlier utility: costs 4 less stamina in the Colosseum; reuse still applies.',
    'offense-mastery': 'Replaces earlier offense: 8% more power for 4 more stamina in the Colosseum.',
    'signature-mastery': 'Replaces earlier signature: 15% bonus when prepared by Mark, Empower or favorable weather in the Colosseum.',
};
const TIER_HINTS: Record<PetAbilityTier, string> = {
    basic: 'Restrained species attack', utility: 'Role utility', advanced: 'Advanced offense',
    signature: 'Final Art requires meter and battle readiness in the Colosseum.',
};
const TIER_LABELS: Record<PetAbilityTier, string> = { basic: 'Basic', utility: 'Utility', advanced: 'Advanced', signature: 'Final Art' };

export function PetAbilityProgression({ pet, compact = false, draftPreferences = false }: { pet: Pet; compact?: boolean; draftPreferences?: boolean }) {
    const progression = petProgressionPresentation(pet);
    return <section className="pet-ability-progression" aria-label="Companion ability progression">
        <div className="pet-progression-heading"><h4>Ability progression</h4><strong>Level {progression.level}</strong></div>
        <p>{progression.nextUnlock ? `Next: level ${progression.nextUnlock.level}.` : 'All ability milestones earned.'} Abilities unlock automatically. The final upgrade is at level 75; levels 76–100 continue stat growth.</p>
        <p className="pet-progression-universal">Always available: Tackle, Guard, Rest and Switch when reserves are present.</p>
        <ol className="pet-progression-milestones">{progression.unlocks.map(unlock => {
            const earned = progression.level >= unlock.level;
            const moves = progression.allAbilities.filter(move => unlock.abilityIds.includes(move.abilityId));
            return <li key={unlock.level} data-earned={earned} aria-current={progression.nextUnlock?.level === unlock.level ? 'step' : undefined}>
                <span className="pet-progression-level">Lv {unlock.level}<small>{earned ? 'Earned' : 'Locked'}</small></span>
                <div>{moves.map(move => <div key={move.abilityId} className="pet-progression-ability">
                    <strong>{move.upgrade ? `${PET_MASTERY_LABELS[move.upgrade]}: ` : ''}{move.name}</strong>
                    <small>{move.upgrade === 'signature-mastery' ? `${petSignatureMasteryDescription(move.kind)} In the Colosseum, damaging Final Arts instead gain 15% when prepared.` : move.upgrade ? MASTERY_HINTS[move.upgrade] : TIER_HINTS[move.tier]}</small>
                </div>)}</div>
            </li>;
        })}</ol>
        {!compact && <><h4>{draftPreferences ? 'Eligible draft loadout (unsaved)' : 'Eligible loadout now'}</h4><ul className="pet-progression-active">{progression.active.map((move, index) => <li key={`${move.name}-${index}`}>{move.tier ? `${TIER_LABELS[move.tier]}: ` : ''}{String(move.name)}{'upgrade' in move && move.upgrade ? ` • ${PET_MASTERY_LABELS[move.upgrade]}` : ''}</li>)}</ul>
            {progression.savedLocked.length > 0 && <p role="status">{draftPreferences ? 'Draft for later' : 'Saved for later'}: {progression.savedLocked.map(move => `${move.name} (level ${move.unlockLevel})`).join(', ')}. Eligible defaults fill those slots until earned. Your saved choices are preserved.</p>}
            {progression.savedInactive.length > 0 && <p role="status">{draftPreferences ? 'Draft inactive in progression' : 'Saved but inactive in progression'}: {progression.savedInactive.map(move => move.name).join(', ')}. Your native basic attack takes one of four ordinary slots when no preferred basic is selected, so only the first three earned preferences fit. Choose a preferred basic attack to use all four preference slots.</p>}
            <details><summary>Progression update &amp; battle rules</summary>
                <p>Your companions, level, XP, Growth Points, evolution and equipment are preserved. Review your allocation in Growth &amp; training; the free respec returns committed points for redistribution and grants no extra points.</p>
                <p>Competitive Tactics uses its own normalized level, 49-point allocation, 100 stamina and full eligible competitive library. Its attributes and item do not replace your adventure Growth Points or gear.</p>
                <p>Happiness affects adventure summons and training. It does not change sealed Colosseum stats. In adventure summons, Final Art becomes ready after two companion techniques; movement does not count. Range applies only in spatial battles.</p>
                <p>Spatial battles and adventure summons apply mastery through their own rules: level 30 improves utility reuse, level 50 increases advanced power by 8%, and level 75 strengthens Final Art according to its effect, including stronger healing, shielding or stances. Damaging Final Arts gain 10% in spatial battles and after summon power caps; Colosseum damage mastery instead rewards preparation. Adventure companions act in a fixed summon phase; Agility affects initiative in formats that order pet actions by speed.</p>
            </details></>}
    </section>;
}
