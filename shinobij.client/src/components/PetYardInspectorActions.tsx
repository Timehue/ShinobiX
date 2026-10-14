import { useRef, useState } from 'react';
import type { Character } from '../types/character';
import type { Pet } from '../types/pet';
import type { PetAppearancePreview, PetCareAction } from '../lib/pet-yard-interactions';
import { petCollars, petFeedItems } from '../data/pet-config';
import { countItem, ownsItem } from '../lib/inventory';
import { petFreePettingLeft } from '../lib/pet';
import { serverNow } from '../lib/server-clock';

export type PetYardInspectorActionsProps = {
    pet: Pet; character: Character; busy: boolean; lockedReason?: string;
    onCare: (action: PetCareAction, itemId?: string) => Promise<string>;
    onEquipCollar: (collarId?: string) => Promise<void>;
};

export function PetYardInspectorActions({ pet, character, busy, lockedReason, onCare, onEquipCollar,
    collarId, onCollarChange, appearance, onAppearanceChange, onActionConfirmed, previewAvailable }: PetYardInspectorActionsProps & {
    collarId: string; onCollarChange: (id: string) => void;
    appearance: PetAppearancePreview; onAppearanceChange: (appearance: PetAppearancePreview) => void;
    onActionConfirmed: (care: boolean) => void;
    previewAvailable: boolean;
}) {
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const food = petFeedItems.filter(item => countItem(character, item.id) > 0);
    const [foodId, setFoodId] = useState<string>(food[0]?.id ?? '');
    const selectedFood = food.find(item => item.id === foodId) ?? food[0];
    const blocked = busy || pending || Boolean(lockedReason);
    const freePetting = petFreePettingLeft(pet);
    const trainingReady = Boolean(pet.training && pet.training.endsAt <= serverNow());
    const currentCollar = pet.loadout?.collar ?? '';
    const collarOwned = !collarId || ownsItem(character, collarId) || collarId === currentCollar;
    async function commit(action: () => Promise<string>, care = true) {
        if (blocked || pendingRef.current) return;
        pendingRef.current = true; setPending(true); setMessage(''); setError('');
        try { setMessage(await action()); onActionConfirmed(care); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'This action could not be completed.'); }
        finally { pendingRef.current = false; setPending(false); }
    }
    return <div className="pet-yard-inspector-actions" aria-busy={pending}>
        {pending && <p className="pet-yard-inspector-message" role="status">Saving companion changes…</p>}
        {lockedReason && <p className="pet-yard-inspector-notice">{lockedReason}</p>}
        {message && <p className="pet-yard-inspector-message" role="status">{message}</p>}
        {error && <p className="pet-yard-inspector-error" role="alert">{error}</p>}
        <details className="pet-yard-inspector-disclosure" name={`pet-inspector-${pet.id}`} open>
            <summary>Care &amp; companionship</summary>
            <p className="hint">Spend time together, share a treat, or collect completed training.</p>
            <div className="pet-yard-inspector-controls pet-yard-inspector-field-action">
                <button type="button" disabled={blocked || freePetting <= 0}
                    onClick={() => void commit(() => onCare('pet'))}>{freePetting > 0 ? 'Pet companion' : 'Petted out for today'}</button>
                {pet.training && <button type="button" disabled={blocked || !trainingReady}
                    onClick={() => void commit(() => onCare('complete-training'))}>{trainingReady ? 'Collect training' : 'Training in progress'}</button>}
            </div>
            <div className="pet-yard-inspector-controls pet-yard-inspector-field-action">
                <label>Treat<select aria-label="Companion treat" value={selectedFood?.id ?? ''}
                    disabled={blocked || !selectedFood} onChange={event => setFoodId(event.target.value)}>
                    {!food.length && <option value="">No treats available</option>}
                    {food.map(item => <option key={item.id} value={item.id}>{item.name} ×{countItem(character, item.id)}</option>)}
                </select></label>
                <button type="button" disabled={blocked || !selectedFood || pet.level >= pet.maxLevel}
                    title={pet.level >= pet.maxLevel ? 'Maximum level reached.' : !selectedFood ? 'No treats available.' : undefined}
                    onClick={() => selectedFood && void commit(() => onCare('feed', selectedFood.id))}>Feed companion</button>
            </div>
        </details>
        <details className="pet-yard-inspector-disclosure" name={`pet-inspector-${pet.id}`}>
            <summary>Collar &amp; appearance preview</summary>
            <div className="pet-yard-inspector-controls pet-yard-inspector-field-action">
                <label>Glow collar<select aria-label="Preview collar" value={collarId} disabled={pending}
                    onChange={event => onCollarChange(event.target.value)}>
                    <option value="">No collar</option>
                    {currentCollar && !petCollars.some(c => c.id === currentCollar) && <option value={currentCollar}>Equipped collar</option>}
                    {petCollars.map(collar => <option key={collar.id} value={collar.id}
                        disabled={!previewAvailable && !ownsItem(character, collar.id) && collar.id !== currentCollar}>
                        {collar.name}{ownsItem(character, collar.id) || collar.id === currentCollar ? ' · Owned' : ' · Preview'}</option>)}
                </select></label>
                <button type="button" disabled={blocked || !collarOwned || collarId === currentCollar}
                    onClick={() => void commit(async () => { await onEquipCollar(collarId || undefined); return collarId ? `Collar equipped: ${petCollars.find(c => c.id === collarId)?.name ?? 'Glow collar'}.` : 'Collar removed.'; }, false)}>
                    {collarId === currentCollar ? 'Equipped' : collarOwned ? collarId ? 'Equip collar' : 'Remove collar' : 'Preview only'}
                </button>
            </div>
            <div className="pet-yard-inspector-controls">
                <label>Appearance preview<select aria-label="Preview appearance" value={appearance}
                    disabled={!previewAvailable}
                    onChange={event => onAppearanceChange(event.target.value as PetAppearancePreview)}>
                    <option value="current">Current appearance</option><option value="original">Original colors</option><option value="chromatic">Chromatic colors</option>
                </select></label>
            </div>
            <p className="hint">{previewAvailable ? 'Color previews are temporary. Owned collars can be equipped for battle.' : 'Owned collars can still be equipped. Appearance previews need the 3D viewer.'}</p>
        </details>
    </div>;
}
