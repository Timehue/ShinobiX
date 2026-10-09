import { useRef, useState } from 'react';
import { craftMaterialName, planSelectedCraftIngredients, type CraftIngredient, type CraftMaterialSelection } from '../../../shared/crafting-recipes';
import { Modal } from './ui/Modal';
import { CraftingSequence } from './CraftingSequence';
import { primeGameAudio } from '../lib/game-audio';
import './craft-material-picker.css';

export type CraftPickerRecipe = {
    kind: 'supply' | 'weapon' | 'armor'; recipeId: string; name: string;
    quantity: number; output: number; ryo: number; ingredients: readonly CraftIngredient[]; image?: string; materialImages?: Record<string, string>;
};
type Props = {
    recipe: CraftPickerRecipe; owned: (id: string) => number; ryo: number;
    opener: HTMLElement;
    onCancel: () => void; onConfirm: (materials: CraftMaterialSelection) => Promise<string | undefined>;
};

export function CraftMaterialPicker({ recipe, owned, ryo, opener, onCancel, onConfirm }: Props) {
    const returnFocusRef = useRef(opener);
    const [materials, setMaterials] = useState<Record<string, number>[]>(() => recipe.ingredients.map(ingredient =>
        Object.fromEntries(ingredient.ids.map(id => [id, ingredient.ids.length === 1 ? ingredient.count * recipe.quantity : 0]))));
    const [busy, setBusy] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState('');
    const submitting = useRef(false);
    const ready = planSelectedCraftIngredients(recipe.ingredients, owned, recipe.quantity, materials) !== null && ryo >= recipe.ryo;
    return <Modal open bare size="lg" ariaLabel="Choose crafting materials" className={`craft-material-picker${busy ? ' craft-material-picker--working' : ''}`}
        returnFocusRef={returnFocusRef} onClose={onCancel}>
        <form onSubmit={async event => {
            event.preventDefault();
            if (!ready || busy || submitting.current) return;
            submitting.current = true; setBusy(true); setError('');
            primeGameAudio(['guard', 'card-place', 'paper', 'reveal']);
            try {
                const failure = await onConfirm(materials);
                if (failure) { setError(failure); setBusy(false); }
                else setConfirmed(true);
            } catch { setError('The forge response was lost. Try again to check this craft.'); setBusy(false); }
            finally { submitting.current = false; }
        }}>
            <header>
                <div><small>CRAFTER · {busy ? 'WORKSHOP' : 'MATERIALS'}</small><h2>{recipe.name}</h2></div>
                <button type="button" onClick={onCancel} aria-label="Close material selection">×</button>
            </header>
            {busy ? <CraftingSequence recipe={recipe} materials={materials} confirmed={confirmed} onClose={onCancel} /> : <>
            <p className="craft-picker-intro">Choose exactly what to spend. You can mix eligible materials within each group.</p>
            <div className="craft-picker-groups">
                {recipe.ingredients.map((ingredient, index) => {
                    const required = ingredient.count * recipe.quantity;
                    const selected = Object.values(materials[index]).reduce((total, amount) => total + amount, 0);
                    return <fieldset key={index}>
                        <legend>{ingredient.label.replace(' or better', ' minimum')} <span>{selected} / {required}</span></legend>
                        <div className="craft-picker-options">
                            {ingredient.ids.map(id => <label key={id} className="craft-picker-option">
                                <span><strong>{craftMaterialName(id)}</strong><small>{owned(id)} owned</small></span>
                                {ingredient.ids.length === 1 ? <b>×{required}</b> : <input type="number" min={0} max={Math.min(required, owned(id))} step={1}
                                    aria-label={`${craftMaterialName(id)} quantity`} value={materials[index][id]}
                                    disabled={busy || owned(id) === 0} onChange={event => {
                                        const amount = event.currentTarget.valueAsNumber || 0;
                                        setMaterials(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [id]: amount } : row));
                                        setError('');
                                    }} />}
                            </label>)}
                        </div>
                    </fieldset>;
                })}
            </div>
            <footer>
                <p className="craft-picker-summary">Batch ×{recipe.quantity} · Output ×{recipe.output} · {recipe.ryo ? `${recipe.ryo.toLocaleString()} ryo` : 'No ryo cost'}</p>
                {error && <p role="alert" className="craft-picker-error">{error}</p>}
                {!ready && <p className="craft-picker-hint" role="status">{ryo < recipe.ryo ? 'Not enough ryo for this batch.' : 'Fill each material group to its required quantity using stock you own.'}</p>}
                <div className="craft-picker-actions">
                    <button type="button" onClick={onCancel}>{busy ? 'Close' : 'Cancel'}</button>
                    <button type="submit" className="craft-picker-confirm" disabled={!ready || busy}>{busy ? 'Crafting…' : 'Confirm craft'}</button>
                </div>
            </footer>
            </>}
        </form>
    </Modal>;
}
