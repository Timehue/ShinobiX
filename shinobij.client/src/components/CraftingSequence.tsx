import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CraftPickerRecipe } from './CraftMaterialPicker';
import { craftMaterialName, type CraftMaterialSelection } from '../../../shared/crafting-recipes';
import { playGameSfx } from '../lib/game-audio';
import forgeScene from '../assets/central/crafter-forge-v1.webp';
import { GameArtIcon } from './GameArtIcon';
import './crafting-sequence.css';

/** Presentation only: the server settles the craft even if this view is closed. */
export function CraftingSequence({ recipe, materials, confirmed, onClose }: {
    recipe: CraftPickerRecipe; materials: CraftMaterialSelection; confirmed: boolean; onClose: () => void;
}) {
    const [step, setStep] = useState(0);
    const [skipped, setSkipped] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const continueRef = useRef<HTMLButtonElement>(null);
    const method = recipe.kind === 'armor' ? 'stitch' : recipe.kind === 'weapon' || recipe.ingredients.some(group =>
        group.ids.some(id => /iron-sand|ember-ore/.test(id))) ? 'forge' : 'prepare';
    const stages = method === 'forge' ? ['Heat the metal', 'Shape the edge', 'Quench & finish']
        : method === 'stitch' ? ['Fit the plates', 'Stitch the lining', 'Secure the bindings']
            : ['Prepare ingredients', 'Bind the batch', 'Seal for the road'];
    const finished = skipped || step === 3;
    const revealed = confirmed && finished;
    const consumed = Object.entries(materials.reduce<Record<string, number>>((stock, group) => {
        for (const [id, count] of Object.entries(group)) if (count > 0) stock[id] = (stock[id] ?? 0) + count;
        return stock;
    }, {}));

    useEffect(() => {
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => { if (motion.matches) setSkipped(true); };
        motion.addEventListener('change', update);
        return () => motion.removeEventListener('change', update);
    }, []);
    useEffect(() => {
        if (skipped) return;
        const timers = [700, 1400, 2100].map((ms, index) => window.setTimeout(() => setStep(index + 1), ms));
        [420, 1120, 1820].forEach(ms => timers.push(window.setTimeout(() => playGameSfx(
            method === 'forge' ? 'guard' : method === 'stitch' ? 'card-place' : 'paper', { gain: .45 }), ms)));
        return () => timers.forEach(clearTimeout);
    }, [method, skipped]);
    useEffect(() => {
        if (!revealed) return;
        playGameSfx('reveal', { gain: .55 });
        continueRef.current?.focus({ preventScroll: true });
    }, [revealed]);

    return <section className={`craft-sequence craft-sequence--${method}${finished ? ' is-finished' : ''}${revealed ? ' is-revealed' : ''}`}
        aria-label="Crafting workbench" data-phase={revealed ? 'complete' : finished ? 'waiting' : 'working'} data-step={step}>
        <div className="craft-workbench" aria-hidden="true">
            <img className="craft-workshop-scene" src={forgeScene} alt="" />
            <span className="craft-bench-caption">CENTRAL WORKSHOP <i>{method === 'forge' ? 'METALWORK' : method === 'stitch' ? 'ARMORWORK' : 'FIELD SUPPLIES'}</i></span>
            <div className="craft-workpiece-stage">
                <div className="craft-workpiece-light" />
                <div className="craft-workpiece">
                    {recipe.image ? <img src={recipe.image} alt="" /> : <GameArtIcon kind={method === 'prepare' ? 'supply' : 'blacksmith'} size={180} />}
                    {recipe.image && <span className="craft-workpiece-glint" style={{ maskImage: `url("${recipe.image}")`, WebkitMaskImage: `url("${recipe.image}")` }} />}
                </div>
                <div className="craft-embers">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties} />)}</div>
            </div>
            <span className="craft-order-mark">{revealed ? 'CRAFTED' : 'OUTPUT'} <b>×{recipe.output}</b></span>
        </div>
        <div className="craft-sequence-copy" role="status" aria-live="polite" aria-atomic="true">
            <small>{revealed ? 'ORDER FULFILLED' : finished ? 'FINAL INSPECTION' : 'AT THE WORKBENCH'}</small>
            <h3>{revealed ? 'Craft complete' : finished ? 'Finishing your order…' : stages[step]}</h3>
            {revealed && <p>{recipe.recipeId.startsWith('currency:')
                ? `${recipe.name} ×${recipe.output} added to your wallet.`
                : `${recipe.output} ${recipe.output === 1 ? 'item' : 'items'} added to your inventory.`}</p>}
        </div>
        {!revealed && <ol className="craft-work-stages" aria-label="Crafting stages">{stages.map((stage, index) =>
            <li key={stage} className={finished || index < step ? 'done' : index === step ? 'current' : ''}><span>{finished || index < step ? '✓' : index + 1}</span>{stage}</li>)}</ol>}
        <div className="craft-bench-materials" aria-label="Selected crafting materials">
            <span>{revealed ? 'Materials used' : 'On the bench'}</span>
            <div>{consumed.slice(0, 4).map(([id, count]) => <span key={id} className="craft-bench-material" title={`${count} ${craftMaterialName(id)}`}>
                {recipe.materialImages?.[id] ? <img src={recipe.materialImages[id]} alt={craftMaterialName(id)} /> : <span>{craftMaterialName(id)}</span>}<b>×{count}</b>
            </span>)}{consumed.length > 4 && <small>+{consumed.length - 4} more</small>}</div>
        </div>
        <footer>
            {revealed ? <button type="button" ref={continueRef} className="craft-picker-confirm" onClick={onClose}>Back to Crafter</button>
                : <><p className="craft-settlement-note">Craft submitted. Closing this menu will not cancel the craft.</p>
                    <div className="craft-picker-actions"><button type="button" onClick={onClose}>Close</button>
                        {!finished && <button type="button" className="craft-skip" onClick={() => setSkipped(true)}>Skip animation</button>}</div></>}
        </footer>
    </section>;
}
