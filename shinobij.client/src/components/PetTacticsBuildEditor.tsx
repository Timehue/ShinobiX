import { useRef, useState } from 'react';
import type { TacticsBuild, TacticsMove } from '../../../shared/pet-tactics-contract';
import { sameTacticsBuild, tacticsBuildIssue } from '../../../shared/pet-tactics-build';
import { TACTICS_ITEMS, TACTICS_MOVES, tacticsPreset, tacticsSpecies } from '../../../shared/pet-tactics-roster';
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
export function PetTacticsBuildEditor({ build, name, onChange, onSave, savedBuild, disabled = false, lockedReason, defaultExpanded = true }: {
    build: TacticsBuild; name?: string; onChange: (build: TacticsBuild) => void;
    onSave?: (build: TacticsBuild) => Promise<void>; savedBuild?: TacticsBuild;
    disabled?: boolean; lockedReason?: string;
    defaultExpanded?: boolean;
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
        try { await onSave(build); setNotice({ key: buildKey, text: 'Ranked loadout saved. It will be ready when you next select this pet.' }); }
        catch (error) { setNotice({ key: buildKey, text: error instanceof Error ? error.message : 'The loadout could not be saved.', error: true }); }
        finally { saveLock.current = false; setSaving(false); }
    }
    return <details className={`pta-build pet-techniques-editor${issue ? ' has-issue' : ''}`} open={expanded}
        onToggle={event => setExpanded(event.currentTarget.open)}><summary><strong>{name ?? pet.name}</strong><span>{build.moveIds.length}/4 moves · {points}/49 points</span></summary>
        <fieldset disabled={disabled || saving} aria-busy={saving}>
            <p className="pta-trait">{pet.traitText}</p>
            <div className="pta-preset">{pet.builds.map((preset, i) => <button type="button" key={preset.name} onClick={() => onChange({ ...tacticsPreset(pet.id, i), ...(build.ownedPetId ? { ownedPetId: build.ownedPetId } : {}) })}>{preset.name} build</button>)}</div>
            <h4>Learnable techniques</h4>
            <p className="pet-techniques-hint">Equip four techniques for ranked battles. Unequip a move to make room for another.</p>
            <div className="pta-move-pool">{pet.pool.map(id => {
                const move = TACTICS_MOVES[id], checked = build.moveIds.includes(id);
                return <label key={id} className={checked ? 'is-equipped' : ''}><input type="checkbox" aria-label={`Equip ${move.name}`} checked={checked} disabled={!checked && build.moveIds.length >= 4}
                    onChange={() => onChange({ ...build, moveIds: checked ? build.moveIds.filter(m => m !== id) : [...build.moveIds, id] })} />
                    <span><MoveTitle move={move} /><MoveDescription move={move} /><b className="pet-technique-state">{checked ? `Slot ${build.moveIds.indexOf(id) + 1} · Equipped` : 'Available'}</b></span></label>;
            })}</div>
            <div className="pet-technique-signature"><h4>Signature · always equipped</h4><MoveTitle move={pet.signature} /><MoveDescription move={pet.signature} /></div>
            <details className="pet-techniques-advanced"><summary>Competitive attributes & item · {points}/49 points</summary>
                <div className="pta-allocation">{(['vitality', 'power', 'guard', 'agility'] as const).map(key => <label key={key}>{key}<input aria-label={`${name ?? pet.name} ${key}`} type="number" min={0} max={25} step={1} value={build.allocation[key]}
                    onChange={e => onChange({ ...build, allocation: { ...build.allocation, [key]: Number(e.target.value) } })} /></label>)}</div>
                <p className="pta-item-effect">Vitality: HP · Power: damage · Guard: defenses and +1 passive STA per 10 points · Agility: speed. Maximum 25 per attribute.</p>
                <label className="pta-item">Competitive item<select value={build.item} onChange={e => onChange({ ...build, item: e.target.value as TacticsBuild['item'] })}>{TACTICS_ITEMS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <p className="pta-item-effect">{TACTICS_ITEMS.find(i => i.id === build.item)?.effect}</p>
            </details>
            <p className={`pet-techniques-validity${issue ? ' has-issue' : ''}`} role="status">{issue ?? 'Ready for ranked.'}</p>
            {onSave && <button className="pet-techniques-save" type="button" disabled={!!issue || saved} onClick={() => void save()}>{saving ? 'Saving loadout…' : saved ? 'Loadout saved' : 'Save ranked loadout'}</button>}
        </fieldset>
        {lockedReason && <p role="status">{lockedReason}</p>}
        {notice?.key === buildKey && <p role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    </details>;
}
