import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { Pet } from '../types/pet';
import type { ShowdownStateView, ShowdownTurnResponse } from '../../../shared/pet-showdown-contract';
import { PetShowdownBattle } from './PetShowdownBattle';
import type { WildBindingCinematic } from './WildBindingArenaFx';
import { petCardImage } from '../lib/pet-battle-anim';
import { warmShowdownModels } from '../lib/pet-model-preload';
import { activeCarriedPets } from '../lib/entitlements';
import { petHaptic, playPetSfx } from '../lib/pet-sfx';
import { declineWildPetEncounter } from '../lib/wild-pet-encounter-api';
import { wildTraitHint } from '../../../shared/wild-binding';
import {
    captureWildPet, forfeitWildBattle, startWildBattle, turnWildBattle,
    type WildBindingView,
} from '../lib/wild-binding-api';
import './WildPetBinding.css';
import './WildPetBindingCinematic.css';

type Outcome = 'captured' | 'ended' | 'left';
const CAPTURE_ANIMATION_MS = 3600;

export function WildPetBinding({
    character, token, pet, sharedImages, onVersionedCharacter, onResolved,
}: {
    character: Character;
    token: string;
    pet: Pet;
    sharedImages: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit;
    onResolved: (outcome: Outcome, destination?: 'roster' | 'sanctuary' | null) => void;
}) {
    const roster = useMemo(() => activeCarriedPets<Pet>(character), [character]);
    const [selectedPetId, setSelectedPetId] = useState(character.activePetId ?? roster[0]?.id ?? '');
    const chosenPetId = roster.some((companion) => companion.id === selectedPetId)
        ? selectedPetId : roster[0]?.id ?? '';
    const [battle, setBattle] = useState<ShowdownStateView | null>(null);
    const [wild, setWild] = useState<WildBindingView | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(true);
    const [selectedSeal, setSelectedSeal] = useState('beast-seal-reinforced');
    const [tutorialStep, setTutorialStep] = useState(0);
    const [captureStage, setCaptureStage] = useState<'idle' | 'binding' | 'success' | 'failed'>('idle');
    const [capturedPet, setCapturedPet] = useState<Pet | null>(null);
    const [captureDestination, setCaptureDestination] = useState<'roster' | 'sanctuary' | null>(null);
    const [arenaAvailable, setArenaAvailable] = useState(false);
    const [battleReady, setBattleReady] = useState(false);
    const [bindingCinematic, setBindingCinematic] = useState<WildBindingCinematic | null>(null);
    const [battleEnded, setBattleEnded] = useState(false);
    const attemptId = useRef('');
    const settled = useRef(false);
    const timer = useRef<number | null>(null);
    const effectTimers = useRef<number[]>([]);
    const resultRef = useRef<HTMLDivElement>(null);
    const available = wild?.seals.find((seal) => seal.id === selectedSeal);
    const cardArt = petCardImage(pet, sharedImages);
    const battlePets = useMemo(() => [...roster, ...(wild?.loanerPet ? [wild.loanerPet] : [])],
        [roster, wild?.loanerPet]);

    useEffect(() => () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        effectTimers.current.forEach(window.clearTimeout);
    }, []);
    useEffect(() => {
        if (captureStage === 'binding') {
            resultRef.current?.focus();
        } else if (captureStage === 'success' || captureStage === 'failed') {
            resultRef.current?.querySelector('button')?.focus();
        }
    }, [captureStage]);

    async function begin() {
        if (busy) return;
        setBusy(true); setError('');
        const response = await startWildBattle(character.name, token, chosenPetId);
        if ('error' in response) { setBusy(false); return setError(response.error); }
        if (response.state.finished) { setBusy(false); return finish('ended'); }
        await warmShowdownModels(response.state, [...roster, ...(response.wild.loanerPet ? [response.wild.loanerPet] : [])]);
        setBusy(false);
        setBattle(response.state);
        setWild(response.wild);
        setOpen(response.wild.tutorial);
        if (response.wild.tutorial) setSelectedSeal('beast-seal-reinforced');
    }

    async function leave() {
        if (busy || settled.current) return;
        setBusy(true); setError('');
        const result = await declineWildPetEncounter(character.name, token);
        setBusy(false);
        if (!result.ok) return setError(result.error ?? 'The encounter could not be left yet.');
        settled.current = true;
        onResolved('left');
    }

    async function submitTurn(commands: Parameters<typeof turnWildBattle>[2], expectedRound: number):
        Promise<ShowdownTurnResponse | { expired: true } | null> {
        if (captureStage !== 'idle') return null;
        const response = await turnWildBattle(character.name, token, commands, expectedRound);
        if ('error' in response) { setError(response.error); return null; }
        setWild(response.wild);
        setError('');
        return { ok: true, events: response.events ?? [], state: response.state };
    }

    async function attemptCapture() {
        if (!battleReady || !available?.available || busy || captureStage !== 'idle' || battleEnded) return;
        const stableId = attemptId.current || crypto.randomUUID();
        attemptId.current = stableId;
        const animationStartedAt = performance.now();
        playPetSfx('command', { gain: 0.8 });
        setBindingCinematic({
            playerId: battle?.player.find((fighter) => !fighter.benched)?.id ?? battle?.player[0]?.id ?? '',
            enemyId: battle?.enemy.find((fighter) => !fighter.benched)?.id ?? battle?.enemy[0]?.id ?? '',
            sealId: selectedSeal,
            startedAt: animationStartedAt,
            durationMs: CAPTURE_ANIMATION_MS,
        });
        setBusy(true); setError(''); setCaptureStage('binding');
        const response = await captureWildPet(character.name, token, selectedSeal, stableId);
        setBusy(false);
        if ('error' in response || !response.capture) {
            setCaptureStage('idle');
            setBindingCinematic(null);
            return setError('error' in response ? response.error : 'The seal did not answer. Retry the same attempt.');
        }
        attemptId.current = '';
        setWild(response.wild);
        if (response.character) onVersionedCharacter(response.character, response._saveVersion);
        const animationMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 250 : CAPTURE_ANIMATION_MS;
        const elapsedMs = performance.now() - animationStartedAt;
        const remainingAnimationMs = Math.max(0, animationMs - elapsedMs);
        if (animationMs === CAPTURE_ANIMATION_MS) {
            effectTimers.current.push(window.setTimeout(() => playPetSfx('finisher', { gain: 0.42 }), Math.max(0, 1250 - elapsedMs)));
            effectTimers.current.push(window.setTimeout(() => {
                playPetSfx('crit', { gain: 0.52 });
                petHaptic(35);
            }, Math.max(0, 2950 - elapsedMs)));
        }
        if (response.capture.success) {
            setCapturedPet(response.capture.pet);
            setCaptureDestination(response.capture.destination);
            timer.current = window.setTimeout(() => {
                playPetSfx('victory', { gain: 0.82 });
                setBindingCinematic(null);
                setCaptureStage('success');
            }, remainingAnimationMs);
        } else {
            timer.current = window.setTimeout(() => {
                playPetSfx('uiDenied', { gain: 0.65 });
                setBindingCinematic(null);
                setCaptureStage('failed');
            }, remainingAnimationMs);
        }
    }

    async function forfeit() {
        if (settled.current || captureStage !== 'idle') return;
        setBusy(true);
        const response = await forfeitWildBattle(character.name, token);
        setBusy(false);
        if ('error' in response) return setError(response.error);
        settled.current = true;
        onResolved('ended');
    }

    function finish(outcome: Outcome, destination?: 'roster' | 'sanctuary' | null) {
        if (settled.current) return;
        settled.current = true;
        onResolved(outcome, destination);
    }

    if (!battle || !wild) return (
        <section className="wild-binding-intro card cinematic-card" aria-label="Wild companion encounter">
            <div className="wild-binding-intro-art">
                <span className="wild-binding-intro-crest" aria-hidden="true">✦</span>
                {cardArt && <img src={cardArt} alt={pet.name} />}
                <span className="wild-binding-intro-art-label">WILD COMPANION</span>
            </div>
            <div className="wild-binding-intro-copy">
                <p className="wild-binding-eyebrow">WILD ENCOUNTER / SEALED DISCOVERY</p>
                <h2>{pet.name}</h2>
                <p className="wild-binding-intro-lead">A wild {pet.rarity} companion blocks the trail. Face it, lower its Resolve, then commit a Beast Seal before its HP reaches zero.</p>
                {pet.trait && wildTraitHint(pet.trait) && <p className="wild-binding-intro-trait"><span>FIELD CLUE · {pet.trait}</span>{wildTraitHint(pet.trait)}</p>}
                {roster.length > 0 ? <>
                    <label htmlFor="wild-binding-companion">Your companion</label>
                    <select id="wild-binding-companion" value={chosenPetId} onChange={(event) => setSelectedPetId(event.target.value)}>
                        {roster.map((companion) => <option key={companion.id} value={companion.id}>{companion.name} · Lv {companion.level}</option>)}
                    </select>
                </> : <p className="wild-binding-loaner-note">The Guild will lend you a fox for this first fight. The pet you bind becomes your own companion.</p>}
                {error && <p className="wild-binding-error" role="alert">{error}</p>}
                <div className="wild-binding-intro-actions">
                    <button type="button" className="wild-binding-primary" onClick={() => void begin()} disabled={busy}>
                        {busy ? 'Preparing battle…' : 'Face the wild pet'}
                    </button>
                    <button type="button" onClick={() => void leave()} disabled={busy}>Leave the trail</button>
                </div>
            </div>
        </section>
    );

    const overlay = <aside className={`wild-binding-overlay${open ? ' is-open' : ''}${captureStage !== 'idle' ? ` is-${captureStage}` : ''}${arenaAvailable && bindingCinematic ? ' has-arena-cinematic' : ''}`}
        onKeyDown={(event) => {
            if (captureStage === 'idle') return;
            if (event.key === 'Tab') {
                event.preventDefault();
                (resultRef.current?.querySelector('button') ?? resultRef.current)?.focus();
            }
            event.stopPropagation();
        }}>
        <button type="button" className="wild-binding-toggle" onClick={() => setOpen((value) => !value)}
            aria-expanded={open} aria-controls="wild-binding-panel">
            <img src="/items/beast-seal-reinforced.webp" alt="" />
            <span>{open ? 'Hide seals' : `Bind · ${wild.resolvePercent}% Resolve`}</span>
        </button>
        {open && <div id="wild-binding-panel" className="wild-binding-panel">
            <div className="wild-binding-panel-head">
                <span className="wild-binding-panel-crest" aria-hidden="true">✦</span>
                <div><p>WILD BINDING</p><strong>{wild.name}</strong></div>
                <span className="wild-binding-rarity">{wild.rarity}</span>
            </div>
            {wild.traitHint && <div className="wild-binding-trait"><span>FIELD CLUE · {wild.trait}</span><p>{wild.traitHint}</p></div>}
            <div className="wild-binding-vitals">
                <label htmlFor="wild-hp-meter">VITALITY <b>{wild.hpPercent}%</b></label>
                <meter id="wild-hp-meter" min={0} max={100} value={wild.hpPercent} />
                <label htmlFor="wild-resolve-meter">RESOLVE <b>{wild.resolvePercent}%</b></label>
                <meter id="wild-resolve-meter" min={0} max={100} value={wild.resolvePercent} />
            </div>
            {wild.tutorial && tutorialStep < 2 && <div className="wild-binding-tutorial" role="status">
                <span>FIRST ENCOUNTER · {tutorialStep + 1}/2</span>
                <p>{tutorialStep === 0
                    ? 'HP measures its strength. Resolve measures resistance to a seal. Rest and Guard steady the creature; attacks also lower Resolve. A defeated pet cannot be bound.'
                    : 'Your gifted Reinforced Seal works at 35% Resolve or lower. The first binding is guaranteed. Select that seal, then activate it.'}</p>
                <button type="button" onClick={() => setTutorialStep((step) => step + 1)}>Continue</button>
            </div>}
            <div className="wild-binding-seal-heading"><span>CHOOSE A BEAST SEAL</span><small>{wild.seals.filter((seal) => seal.count > 0).length} IN PACK</small></div>
            <div className="wild-binding-seals" role="group" aria-label="Beast seals">
                {wild.seals.map((seal) => <button key={seal.id} type="button"
                    className={`wild-binding-seal${selectedSeal === seal.id ? ' selected' : ''}`}
                    onClick={() => setSelectedSeal(seal.id)}
                    disabled={busy || battleEnded || captureStage !== 'idle'}
                    aria-pressed={selectedSeal === seal.id}>
                    <img src={`/items/${seal.id}.webp`} alt="" />
                    <span><b>{seal.name.replace(' Beast Seal', '')}</b><small>Bind at {seal.resolveThreshold}% Resolve or less</small></span>
                    <em>{seal.count > 0 ? `×${seal.count}` : '—'}</em>
                    {!seal.available && <i>{seal.count < 1 ? 'EMPTY' : 'RESOLVE'}</i>}
                </button>)}
            </div>
            <div className="wild-binding-action-dock">
                <div className={`wild-binding-readiness${battleReady && available?.available ? ' is-ready' : ''}`} role="status">
                    <span>{!battleReady ? 'BATTLE IN MOTION' : available?.available ? 'SEAL READY' : available?.count ? 'LOWER RESOLVE' : 'NO SEAL IN PACK'}</span>
                    <strong>{!battleReady ? 'Wait for your next command' : available?.available ? available.opportunity : available?.count ? `Needs ${available.resolveThreshold}% Resolve or less` : 'Select an owned seal'}</strong>
                </div>
                <button type="button" className="wild-binding-primary wild-binding-capture"
                    disabled={!battleReady || !available?.available || busy || battleEnded || captureStage !== 'idle' || (wild.tutorial && tutorialStep < 2)}
                    onClick={() => void attemptCapture()}>
                    <img src={`/items/${selectedSeal}.webp`} alt="" />
                    <span>{busy ? 'Activating seal…' : available?.available ? `Bind with ${available.name}` : available?.count ? 'Lower Resolve to bind' : 'No seal available'}</span>
                </button>
            </div>
            <p className="wild-binding-footnote">The seal is spent on activation. If the bind fails, the fight continues.</p>
            {error && <p className="wild-binding-error" role="alert">{error}</p>}
        </div>}
        {captureStage !== 'idle' && <div ref={resultRef} className="wild-binding-result" role="dialog" aria-modal="true" aria-label="Binding result" tabIndex={-1}>
            <div className="wild-binding-result-top"><span>THE BINDING RITUAL</span><span>{wild.name.toUpperCase()} · {wild.rarity.toUpperCase()}</span></div>
            <div className="wild-binding-capture-scene" aria-hidden="true">
                <div className="wild-binding-capture-horizon" />
                <div className="wild-binding-sigil wild-binding-sigil-outer" />
                <div className="wild-binding-sigil wild-binding-sigil-inner" />
                <div className="wild-binding-glyphs">{Array.from({ length: 8 }, (_, index) => <i key={index}>✦</i>)}</div>
                <div className="wild-binding-capture-pet">
                    {cardArt ? <img src={cardArt} alt="" /> : <span>{wild.name.slice(0, 1)}</span>}
                </div>
                <div className="wild-binding-capture-beam" />
                <div className="wild-binding-capture-beam wild-binding-capture-beam-side" />
                <div className="wild-binding-magic-ring"><img src={`/items/${selectedSeal}.webp`} alt="" /></div>
                <div className="wild-binding-burst" /><div className="wild-binding-burst wild-binding-burst-late" />
                <div className="wild-binding-motes">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
            </div>
            <div className="wild-binding-ritual-steps" aria-hidden="true"><span>ATTUNE</span><span>DRAW</span><span>SEAL</span></div>
            {captureStage === 'binding' ? <><h2>A bond takes shape</h2><p>{wild.name} is being drawn into the seal.</p></>
                : captureStage === 'success' ? <><span className="wild-binding-result-kicker">NEW COMPANION</span><h2>Bond formed</h2><strong className="wild-binding-reward-name">{capturedPet?.name ?? wild.name}</strong><p>Joined your {captureDestination === 'sanctuary' ? 'Sanctuary' : 'companions'}.</p>
                    {capturedPet?.trait && <p className="wild-binding-reward-trait">TRAIT · {capturedPet.trait}</p>}
                    <button type="button" className="wild-binding-primary" onClick={() => finish('captured', captureDestination)}>Continue</button></>
                    : <><h2>The seal fractured</h2><p>{wild.name} broke free. The fight continues.</p>
                        <button type="button" className="wild-binding-primary" onClick={() => { setBindingCinematic(null); setCaptureStage('idle'); }}>Keep fighting</button></>}
        </div>}
    </aside>;

    return <>
        <PetShowdownBattle
            initialState={battle}
            wildBinding={bindingCinematic}
            onRenderMode={setArenaAvailable}
            onCommandReady={setBattleReady}
            inputLocked={captureStage !== 'idle'}
            playerPets={battlePets}
            sharedImages={sharedImages}
            submitTurn={submitTurn}
            onForfeit={() => void forfeit()}
            onFinished={() => { setBattleReady(false); setBattleEnded(true); }}
            onExit={() => finish('ended')}
            onRematch={() => finish('ended')}
            hideRematch
            exitLabel="Return to the trail"
            resultTitle={(outcome) => outcome === 'win' ? 'WILD PET DEFEATED' : 'ENCOUNTER LOST'}
            resultNote={(outcome) => outcome === 'win'
                ? 'The creature was defeated before it could be bound. The discovery is over.'
                : 'Your companion could not continue. The wild pet slipped away.'}
            eventLabel="Wild binding"
        />
        {!battleEnded && createPortal(overlay, document.body)}
    </>;
}
