import { useRef, useState } from 'react';
import type { TacticsBuild, TacticsMove } from '../../../shared/pet-tactics-contract';
import { sameTacticsBuild, tacticsBuildIssue } from '../../../shared/pet-tactics-build';
import { TACTICS_ITEMS, TACTICS_MOVES, tacticsPreset, tacticsSpecies } from '../../../shared/pet-tactics-roster';
import { petTacticsAbilityUnlockLevel } from '../../../shared/pet-ability-progression';
import { ShowdownIcon, type ShowdownIconName } from './icons/ShowdownIcon';
import '../styles/pet-techniques.css';

function MoveTitle({ move }: { move: TacticsMove }) {
    return <strong className="pet-technique-title" data-element={move.element}>
        <ShowdownIcon name={`elem-${move.element.toLowerCase()}` as ShowdownIconName} size={18} />
        <span>{move.name}</span>
    </strong>;
}

function MoveDescription({ move }: { move: TacticsMove }) {
    const target = { foe: 'Enemy', ally: 'Ally', self: 'Self', team: 'Both allies' }[move.target];
    return <><small>{move.element !== 'None' ? `${move.element} · ` : ''}{move.cls.charAt(0).toUpperCase() + move.cls.slice(1)} · {move.cost} STA · {target}</small>
        <span className="pet-technique-effect">{move.effect}</span>
        <small>{[move.power > 0 ? `Power ${move.power}` : '', move.cooldown > 0 ? `${move.cooldown}-round cooldown` : '', move.hold > 0 ? `Requires ${move.hold} field ${move.hold === 1 ? 'round' : 'rounds'}` : ''].filter(Boolean).join(' · ')}</small></>;
}

/** One move library for the ranked squad screen and the Pet Yard. */
export function PetTacticsBuildEditor({ build, name, onChange, onSave, savedBuild, disabled = false, lockedReason, defaultExpanded = true, summaryLabel, description, progressionLevel, inactivePreferenceIds = [], preferenceState = 'saved' }: {
    build: TacticsBuild; name?: string; onChange: (build: TacticsBuild) => void;
    onSave?: (build: TacticsBuild) => Promise<void>; savedBuild?: TacticsBuild;
    disabled?: boolean; lockedReason?: string;
    defaultExpanded?: boolean;
    summaryLabel?: string; description?: string;
    /** Omit in normalized competitive screens. Saved preferences remain editable. */
    progressionLevel?: number;
    inactivePreferenceIds?: readonly string[];
    preferenceState?: 'default' | 'draft' | 'saved';
}) {
    const pet = tacticsSpecies(build.speciesId)!;
    const points = Object.values(build.allocation).reduce((a, b) => a + b, 0);
    const issue = tacticsBuildIssue(build);
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState(defaultExpanded);
    const saveLock = useRef(false);
    const [notice, setNotice] = useState<{ key: string; text: string; error?: boolean } | null>(null);
    const buildKey = JSON.stringify(build);
    const saved = sameTacticsBuild(savedBuild, build);
    async function save() {
        if (!onSave || issue || saveLock.current) return;
        saveLock.current = true; setSaving(true); setNotice(null);
        try { await onSave(build); setNotice({ key: buildKey, text: 'Loadout preferences saved. Progression battles use earned moves; locked choices stay saved for later.' }); }
        catch (error) { setNotice({ key: buildKey, text: error instanceof Error ? error.message : 'The loadout could not be saved.', error: true }); }
        finally { saveLock.current = false; setSaving(false); }
    }
    return <details className={`pta-build pet-techniques-editor${issue ? ' has-issue' : ''}`} open={expanded}
        onToggle={event => setExpanded(event.currentTarget.open)}><summary><strong>{summaryLabel ?? name ?? pet.name}</strong><span>{build.moveIds.length}/4 abilities{!summaryLabel && ` · ${points}/49 points`}</span></summary>
        <fieldset disabled={disabled || saving} aria-busy={saving}>
            {description && <p>{description}</p>}
            {preferenceState === 'default' && <p className="pet-techniques-hint">These checked default choices have not been saved and do not replace the native loadout above.</p>}
            {progressionLevel != null && <p className="pet-techniques-hint">The technique library below shows Competitive Tactics costs and effects. Progression costs, mastery and reuse are shown in the sealed battle menu.</p>}
            <p className="pta-trait">{pet.traitText}</p>
            <div className="pta-preset">{pet.builds.map((preset, i) => <button type="button" key={preset.name} onClick={() => onChange({ ...tacticsPreset(pet.id, i), ...(build.ownedPetId ? { ownedPetId: build.ownedPetId } : {}) })}>{preset.name} build</button>)}</div>
            <h4>Learnable techniques</h4>
            <p className="pet-techniques-hint">{progressionLevel == null ? 'Equip four abilities for Competitive Tactics.' : 'Choose four preferences. Locked moves can be saved for later; eligible defaults fill their slots in progression battles.'} Unequip a move to make room for another.</p>
            <div className="pta-move-pool">{pet.pool.map(id => {
                const move = TACTICS_MOVES[id], checked = build.moveIds.includes(id);
                const unlock = petTacticsAbilityUnlockLevel(id);
                const locked = progressionLevel != null && unlock != null && progressionLevel < unlock;
                let stateLabel = 'Available';
                if (locked) stateLabel = `Level ${unlock} · ${!checked ? 'Locked in progression' : preferenceState === 'default' ? 'Default choice, not saved' : preferenceState === 'draft' ? 'Unsaved for later' : 'Saved for later'}`;
                else if (checked) stateLabel = `Slot ${build.moveIds.indexOf(id) + 1} · ${preferenceState === 'default' ? 'Default choice, not saved' : inactivePreferenceIds.includes(id) ? preferenceState === 'draft' ? 'Unsaved, inactive in progression' : 'Saved, inactive in progression' : preferenceState === 'draft' ? 'Unsaved choice' : progressionLevel == null ? 'Equipped' : 'Active preference'}`;
                return <label key={id} className={checked ? 'is-equipped' : ''}><input type="checkbox" aria-label={`Equip ${move.name}`} checked={checked} disabled={!checked && build.moveIds.length >= 4}
                    onChange={() => onChange({ ...build, moveIds: checked ? build.moveIds.filter(m => m !== id) : [...build.moveIds, id] })} />
                    <span><MoveTitle move={move} /><MoveDescription move={move} /><b className="pet-technique-state">{stateLabel}</b></span></label>;
            })}</div>
            <div className="pet-technique-signature"><h4>Competitive Tactics signature · normalized format only</h4><MoveTitle move={pet.signature} /><MoveDescription move={pet.signature} />
                {progressionLevel != null && <p>Progression battles keep your companion&apos;s native Final Art, shown above. It {progressionLevel >= 20 ? 'is earned at level 20' : 'unlocks at level 20'}; saved ordinary techniques do not replace it.</p>}
            </div>
            <details className="pet-techniques-advanced"><summary>Competitive attributes & item · {points}/49 points</summary>
                <p>Competitive Tactics normalizes the battle level, gives every build 49 points and 100 stamina, and uses these attributes and this item. Adventure Growth Points and equipment are separate.</p>
                <div className="pta-allocation">{(['vitality', 'power', 'guard', 'agility'] as const).map(key => <label key={key}>{key}<input aria-label={`${name ?? pet.name} ${key}`} type="number" min={0} max={25} step={1} value={build.allocation[key]}
                    onChange={e => onChange({ ...build, allocation: { ...build.allocation, [key]: Number(e.target.value) } })} /></label>)}</div>
                <p className="pta-item-effect">Vitality: HP · Power: physical and special offense · Guard: both defenses, with +1 passive stamina at 10 points and another +1 at 20 · Agility: speed and initiative. Maximum 25 per attribute.</p>
                <label className="pta-item">Competitive item<select value={build.item} onChange={e => onChange({ ...build, item: e.target.value as TacticsBuild['item'] })}>{TACTICS_ITEMS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <p className="pta-item-effect">{TACTICS_ITEMS.find(i => i.id === build.item)?.effect}</p>
            </details>
            <p className={`pet-techniques-validity${issue ? ' has-issue' : ''}`} role="status">{issue ?? 'Ready for battle.'}</p>
            {onSave && <button className="pet-techniques-save" type="button" disabled={!!issue || saved} onClick={() => void save()}>{saving ? 'Saving loadout…' : saved ? 'Loadout saved' : 'Save loadout'}</button>}
        </fieldset>
        {lockedReason && <p role="status">{lockedReason}</p>}
        {notice?.key === buildKey && <p role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    </details>;
}
