import { useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { BIOME_GATHER_IDS, COMMON_GATHER_IDS, GATHER_NAMES, gatherYield, type CommonGatherId, type PendingGatherFind } from '../../../shared/gathering';
import { buildGatherVn, FIND_SCENES, gatherSceneImage } from '../lib/gathering-vn';
import { claimGatherFind } from '../lib/gathering-api';
import { TriggeredVisualNovel } from './TriggeredVisualNovel';
import { Modal } from './ui/Modal';
import './GatheringFind.css';

const USES: Record<CommonGatherId, string> = {
    'gather-field-herb': 'Rations · rejuvenation · village supplies',
    'gather-binding-fiber': 'Smoke bombs · legendary blades · village supplies',
    'gather-iron-sand': 'Shuriken · legendary blades · village supplies',
};
export function GatheringFind({ find, character, sharedImages, onCharacter, onClose }: {
    find: PendingGatherFind; character: Character; sharedImages?: Record<string, string>;
    onCharacter: VersionedCharacterCommit; onClose: () => void;
}) {
    const [stage, setStage] = useState<'story' | 'choice' | 'collected'>(character.gatherIntroSeen ? 'choice' : 'story');
    const [page, setPage] = useState(0);
    const [line, setLine] = useState(0);
    const [common, setCommon] = useState<CommonGatherId>('gather-field-herb');
    const [takeTrace, setTakeTrace] = useState(find.rareTrace);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [error, setError] = useState('');
    const [collected, setCollected] = useState('');
    const preview = gatherYield(find, { common, takeTrace }) ?? [];
    const summary = preview.map((r) => `${r.count} × ${GATHER_NAMES[r.itemId]}`).join(' + ');
    const scene = FIND_SCENES[find.biome];
    async function collect() {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setError('');
        try {
            const result = await claimGatherFind(character.name, find, { common, takeTrace });
            if (!result.character) { setError(result.error || 'Your find remains saved. Try again.'); return; }
            if (!onCharacter(result.character, result.saveVersion)) {
                setError('Your save is refreshing. Retry to confirm this collection.'); return;
            }
            setCollected((result.rewards ?? []).map((r) => `${r.count} × ${GATHER_NAMES[r.itemId]}`).join(' + '));
            setStage('collected');
        } finally { inFlight.current = false; setBusy(false); }
    }
    if (stage === 'story') return <TriggeredVisualNovel event={buildGatherVn(find, !!character.gatherIntroSeen)} character={character}
            pageIndex={page} lineIndex={line} setPageIndex={setPage} setLineIndex={setLine}
            onCancel={() => setStage('choice')} onComplete={() => setStage('choice')} onBattle={() => undefined}
            onChoice={() => setStage('choice')} sharedImages={sharedImages} />;
    return <Modal open onClose={onClose} bare size="lg" ariaLabel="The Find" className="gather-modal">
        <section className="gather-panel" aria-busy={busy}>
            <div className="gather-art" style={{ backgroundImage: `url("${gatherSceneImage(find.biome)}")` }} role="img" aria-label={scene.scene}>
                <div className="gather-heading"><span>FIELD DISCOVERY · SECTOR {find.sector}</span><h2>The Find</h2><p>{scene.title}</p></div>
                <button className="gather-close" onClick={onClose} aria-label="Close and keep find saved">×</button>
            </div>
            <div className="gather-body">
                {stage === 'collected' ? <div className="gather-complete" role="status">
                    <span>STOWED IN YOUR SATCHEL</span><h3>Gathering complete</h3><p>{collected}</p>
                    <button onClick={onClose}>Return to the map</button>
                </div> : <>
                    <p className="gather-description">{find.rareTrace ? scene.trace : scene.common}</p>
                    <fieldset className="gather-materials" disabled={busy}><legend>Choose one material</legend>
                        {COMMON_GATHER_IDS.map((id) => <label key={id} className="gather-material" data-selected={common === id}>
                            <input type="radio" name="gather-common" value={id} checked={common === id} onChange={() => setCommon(id)} />
                            <img className="gather-material-mark" src={"/items/" + id + "-v1.webp"} alt="" />
                            <strong>{GATHER_NAMES[id]}</strong><small>{USES[id]}</small>
                        </label>)}
                    </fieldset>
                    {find.rareTrace ? <label className="gather-trace"><input type="checkbox" checked={takeTrace} disabled={busy} onChange={(e) => setTakeTrace(e.target.checked)} />
                        <img className="gather-trace-icon" src={"/items/" + BIOME_GATHER_IDS[find.biome] + "-v1.webp"} alt="" /><span><strong>Take the {GATHER_NAMES[BIOME_GATHER_IDS[find.biome]]}</strong><small>Collect 2 of your chosen material + 1 regional trace. Leave it for 3 common materials instead.</small></span>
                    </label> : <p className="gather-no-trace">A common harvest · 3 of your selected material</p>}

                </>}
            </div>
            {stage !== 'collected' && <footer className="gather-footer">
                    <div className="gather-reward" aria-live="polite"><span>YOU WILL RECEIVE</span><strong>{summary}</strong></div>
                    {error && <p className="gather-error" role="alert">{error}</p>}
                    <div className="gather-actions"><button onClick={() => void collect()} disabled={busy}>{busy ? 'Collecting…' : 'Collect this harvest'}</button>
                        <button onClick={onClose}>Save for later</button><button className="gather-read" onClick={() => setStage('story')}>Read the scene</button></div>
                    <p className="gather-saved-note">One harvest per find. Closing keeps this find saved in your map.</p>
            </footer>}
        </section>
    </Modal>;
}
