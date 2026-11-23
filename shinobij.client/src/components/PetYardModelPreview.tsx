import { useCallback, useRef, useState } from 'react';
import { petCurrentHappiness, petDisplayName } from '../lib/pet';
import { PetArtwork } from './PetArtwork';
import { PetPreviewStage } from './PetPreviewStage';
import { Modal } from './ui/Modal';
import type { TacticsBuild } from '../../../shared/pet-tactics-contract';
import { PetRankedTechniques } from './PetRankedTechniques';
import '../styles/pet-yard-model-preview.css';
import { PetYardInspectorActions, type PetYardInspectorActionsProps } from './PetYardInspectorActions';
import type { PetAppearancePreview, PetCareCue } from '../lib/pet-yard-interactions';

function Inspector({ pet, sharedImages, careCue, onSaveLoadout, ...actions }: PetYardInspectorActionsProps & {
    sharedImages: Record<string, string>; careCue?: PetCareCue; onSaveLoadout: (build: TacticsBuild) => Promise<void>;
}) {
    const [failed, setFailed] = useState(false);
    const failPreview = useCallback(() => setFailed(true), []);
    const [paused, setPaused] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const [turn, setTurn] = useState(0);
    const [appearance, setAppearance] = useState<PetAppearancePreview>('current');
    const [initialCareSerial] = useState(careCue?.serial ?? 0);
    const currentCollar = pet.loadout?.collar ?? '';
    const [collarDraft, setCollarDraft] = useState<{ base: string; id: string } | null>(null);
    const collarId = collarDraft?.base === currentCollar ? collarDraft.id : currentCollar;
    const artwork = <PetArtwork pet={pet} sharedImages={sharedImages} alt={petDisplayName(pet)} loading="eager" />;
    return <div className="pet-yard-inspector">
        <div className="pet-yard-inspector-identity"><span>Level {pet.level}</span><span>{pet.rarity}</span><span>{pet.element === 'None' ? 'Neutral' : pet.element}</span><span>Bond {petCurrentHappiness(pet)}%</span></div>
        <div className="pet-yard-inspector-stage" aria-label={`${petDisplayName(pet)} 3D preview`}>
            <div className="pet-yard-inspector-stage-labels" aria-hidden="true"><span>{failed ? 'Companion artwork' : paused ? 'Paused' : 'Live preview'}</span>
                {!failed && (appearance !== 'current' || collarId !== currentCollar) && <span>Appearance preview</span>}
            </div>
            {failed ? artwork : <PetPreviewStage fallback={<>{artwork}<p role="status">Loading companion…</p></>}
                pet={pet} paused={paused} turn={turn} take={0} appearance={appearance} collarId={collarId}
                careCue={careCue} onFail={failPreview} />}
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
        </>}
        <PetRankedTechniques pet={pet} onSave={onSaveLoadout} inspector
            disabled={actions.busy || Boolean(actions.lockedReason)} lockedReason={actions.lockedReason} />
        <PetYardInspectorActions {...actions} pet={pet} collarId={collarId} appearance={appearance} previewAvailable={!failed}
            onCollarChange={id => setCollarDraft({ base: currentCollar, id })} onAppearanceChange={setAppearance}
            onActionConfirmed={care => { if (care && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPaused(false); }} />
    </div>;
}

export function PetYardModelPreview({ pet, sharedImages, careCue, onSaveLoadout, ...actions }: PetYardInspectorActionsProps & {
    sharedImages: Record<string, string>; careCue?: PetCareCue; onSaveLoadout: (build: TacticsBuild) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const opener = useRef<HTMLButtonElement>(null);
    return <div className="pet-yard-model-preview">
        <button type="button" ref={opener} onClick={() => setOpen(true)}>View companion</button>
        {open && <Modal open onClose={() => setOpen(false)} title={<span className="pet-yard-inspector-title"><small>Companion</small>{petDisplayName(pet)}</span>} size="md" returnFocusRef={opener}
            backdropClassName="pet-yard-inspector-backdrop" className="pet-yard-inspector-dialog">
            <Inspector key={`${pet.id}:${pet.evolutionStage}:${pet.rarity}`} {...actions} pet={pet} sharedImages={sharedImages} careCue={careCue}
                onSaveLoadout={onSaveLoadout} />
        </Modal>}
    </div>;
}
