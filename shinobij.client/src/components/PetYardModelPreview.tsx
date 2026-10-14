import { Suspense, useCallback, useRef, useState } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { petCurrentHappiness, petDisplayName } from '../lib/pet';
import { PetArtwork } from './PetArtwork';
import { PetModelBoundary } from './PetModelBoundary';
import { Modal } from './ui/Modal';
import { rankedBuildForPet } from '../../../shared/pet-tactics-build';
import { tacticsSpecies, TACTICS_MOVES } from '../../../shared/pet-tactics-roster';
import '../styles/pet-yard-model-preview.css';
import { PetYardInspectorActions, type PetYardInspectorActionsProps } from './PetYardInspectorActions';
import type { PetAppearancePreview, PetCareCue } from '../lib/pet-yard-interactions';

// No runtime Three.js imports in the Yard. Opening the inspector is the only
// thing that requests the stage chunk or a model; roster cards stay pictures.
const Stage = lazyWithRetry(() => import('./PetYardModelStage').then(m => ({ default: m.PetYardModelStage })));

function Inspector({ pet, sharedImages, careCue, onEditTechniques, ...actions }: PetYardInspectorActionsProps & {
    sharedImages: Record<string, string>; careCue?: PetCareCue; onEditTechniques: () => void;
}) {
    const [failed, setFailed] = useState(false);
    const failPreview = useCallback(() => setFailed(true), []);
    const [paused, setPaused] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const [turn, setTurn] = useState(0);
    const [take, setTake] = useState(0);
    const [appearance, setAppearance] = useState<PetAppearancePreview>('current');
    const [initialCareSerial] = useState(careCue?.serial ?? 0);
    const currentCollar = pet.loadout?.collar ?? '';
    const [collarDraft, setCollarDraft] = useState<{ base: string; id: string } | null>(null);
    const collarId = collarDraft?.base === currentCollar ? collarDraft.id : currentCollar;
    const build = rankedBuildForPet(pet);
    const species = build ? tacticsSpecies(build.speciesId) : undefined;
    const moves = species ? [...species.pool.map(id => TACTICS_MOVES[id]).filter(Boolean), species.signature] : [];
    const [moveId, setMoveId] = useState(build?.moveIds[0] ?? moves[0]?.id ?? '');
    const move = moves.find(m => m.id === moveId);
    const artwork = <PetArtwork pet={pet} sharedImages={sharedImages} alt={petDisplayName(pet)} loading="eager" />;
    return <div className="pet-yard-inspector">
        <div className="pet-yard-inspector-identity"><span>Level {pet.level}</span><span>{pet.rarity}</span><span>{pet.element === 'None' ? 'Neutral' : pet.element}</span><span>Bond {petCurrentHappiness(pet)}%</span></div>
        <div className="pet-yard-inspector-stage" aria-label={`${petDisplayName(pet)} 3D preview`}>
            <div className="pet-yard-inspector-stage-labels" aria-hidden="true"><span>{failed ? 'Companion artwork' : paused ? 'Paused' : 'Live preview'}</span>
                {!failed && (appearance !== 'current' || collarId !== currentCollar) && <span>Appearance preview</span>}
            </div>
            {failed ? artwork : <PetModelBoundary onFail={failPreview}>
                <Suspense fallback={<>{artwork}<p role="status">Loading companion…</p></>}>
                    <Stage pet={pet} paused={paused} turn={turn} take={take} move={move} appearance={appearance} collarId={collarId}
                        careCue={careCue} onFail={failPreview} />
                </Suspense>
            </PetModelBoundary>}
            {careCue && careCue.serial > initialCareSerial && <span key={careCue.serial}
                className={`pet-yard-inspector-reaction pet-yard-inspector-reaction--${careCue.kind}`}
                style={{ animationPlayState: paused ? 'paused' : 'running' }} aria-hidden="true">
                {careCue.kind === 'training' ? '✦' : '♥'}
            </span>}
        </div>
        {failed ? <p role="status">3D preview is unavailable. Your companion artwork is still available.</p> : <>
            <div className="pet-yard-inspector-controls pet-yard-inspector-toolbar">
                <button type="button" onClick={() => setTurn(t => t - Math.PI / 4)} aria-label="Rotate pet left">↶ Rotate</button>
                <button type="button" onClick={() => setTurn(t => t + Math.PI / 4)} aria-label="Rotate pet right">Rotate ↷</button>
                <button type="button" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Resume preview' : 'Pause preview'}</button>
            </div>
            {move && <details className="pet-yard-inspector-disclosure" name={`pet-inspector-${pet.id}`}><summary>Technique motion</summary><div className="pet-yard-inspector-controls">
                <label>Technique<select aria-label="Preview technique" value={moveId} onChange={event => { setMoveId(event.target.value); setTake(0); }}>
                    {moves.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === species?.signature.id ? ' · Signature' : build?.moveIds.includes(m.id) ? ' · Equipped' : ''}</option>)}
                </select></label>
                <button type="button" onClick={() => { setTake(t => t + 1); setPaused(false); }}>Play technique</button>
            </div><p className="pet-yard-inspector-move"><strong>{move.element === 'None' ? 'Neutral' : move.element} · {move.cost} STA</strong>{move.effect}</p>
                <button type="button" className="pet-yard-inspector-link" disabled={actions.busy} onClick={onEditTechniques}>Edit ranked loadout →</button></details>}
        </>}
        <PetYardInspectorActions {...actions} pet={pet} collarId={collarId} appearance={appearance} previewAvailable={!failed}
            onCollarChange={id => setCollarDraft({ base: currentCollar, id })} onAppearanceChange={setAppearance}
            onActionConfirmed={care => { if (care) { setTake(0); if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPaused(false); } }} />
    </div>;
}

export function PetYardModelPreview({ pet, sharedImages, careCue, onEditTechniques, ...actions }: PetYardInspectorActionsProps & {
    sharedImages: Record<string, string>; careCue?: PetCareCue; onEditTechniques: () => void;
}) {
    const [open, setOpen] = useState(false);
    const opener = useRef<HTMLButtonElement>(null);
    return <div className="pet-yard-model-preview">
        <button type="button" ref={opener} onClick={() => setOpen(true)}>View 3D &amp; techniques</button>
        {open && <Modal open onClose={() => setOpen(false)} title={<span className="pet-yard-inspector-title"><small>Companion</small>{petDisplayName(pet)}</span>} size="md" returnFocusRef={opener}
            backdropClassName="pet-yard-inspector-backdrop" className="pet-yard-inspector-dialog">
            <Inspector key={`${pet.id}:${pet.evolutionStage}:${pet.rarity}`} {...actions} pet={pet} sharedImages={sharedImages} careCue={careCue}
                onEditTechniques={() => { setOpen(false); onEditTechniques(); }} />
        </Modal>}
    </div>;
}
