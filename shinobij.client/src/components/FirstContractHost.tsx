import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readFirstContract, firstContractReturnedLater, type FirstContractRoute } from '../../../shared/first-contract';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { Screen } from '../types/core';
import type { ActiveTraining } from '../types/combat';
import { commitAcademyNarrativeAction, type AcademyNarrativeAction } from '../lib/academy-narrative-api';
import { FIRST_CONTRACT_COPY, FIRST_CONTRACT_OPEN, claimFirstContractOpen, firstContractPreparation } from '../lib/first-contract';
import { openFirstContractActivity } from '../lib/first-contract-navigation';
import { academyVowDefinition } from '../lib/academy-narrative';
import { captureProductEvent } from '../lib/analytics';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { useSharedNow } from '../lib/use-shared-now';
import { FirstContractRoutes } from './FirstContractRoutes';
import './first-contract.css';

const SAFE_SCREENS: Screen[] = ['village', 'centralHub', 'logbook', 'missions', 'pets', 'profile', 'inventory', 'jutsuTraining', 'training', 'hospital', 'cafeteria'];

export function FirstContractHost({ character, screen, blocked, navigate, onVersionedCharacter, activeTraining }: {
    character: Character; screen: Screen; blocked: boolean; navigate: (screen: Screen) => void;
    onVersionedCharacter: VersionedCharacterCommit; activeTraining: ActiveTraining | null;
}) {
    const state = readFirstContract(character.firstContract);
    const now = useSharedNow();
    const [open, setOpen] = useState(false);
    const [choosing, setChoosing] = useState(false);
    const [basics, setBasics] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLElement>(null);
    const actionLock = useRef(false);
    const mounted = useRef(true);
    const eventKeys = useRef(new Set<string>());
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const eligible = Boolean(state && character.onboardingStep === 'done' && !blocked);
    const allowed = eligible && (SAFE_SCREENS.includes(screen) || screen === 'worldMap');
    useEffect(() => {
        const show = () => {
            if (!claimFirstContractOpen() || !eligible) return;
            // Other non-combat screens keep their journal shortcut functional
            // without opening another overlay above their own specialized UI.
            if (!allowed) navigate('logbook');
            setOpen(true); setChoosing(false);
        };
        window.addEventListener(FIRST_CONTRACT_OPEN, show);
        // The rail can be clicked before this lazy host mounts. Answer that click now.
        show();
        return () => window.removeEventListener(FIRST_CONTRACT_OPEN, show);
    }, [allowed, eligible, navigate]);
    const modal = open && allowed;
    useBodyScrollLock(modal);
    useEffect(() => {
        if (!modal) return;
        const previous = document.activeElement as HTMLElement | null;
        dialogRef.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, [modal]);
    useEffect(() => {
        if (!allowed || !state) return;
        const milestone = state.completedAt ? 'activity-completed' : state.route ? 'route-active' : 'journal-offered';
        const key = `${state.offeredAt}:${milestone}`;
        if (eventKeys.current.has(key)) return;
        eventKeys.current.add(key);
        captureProductEvent('first_hour_milestone', { source: 'first-contract', stateCategory: milestone, mode: state.route ?? 'undecided' });
    }, [allowed, state]);
    if (!allowed || !state) return null;
    const laterDay = firstContractReturnedLater(state, now) && !state.returnedAt;
    if (state.acknowledgedAt && !laterDay && !open && screen !== 'logbook') return null;
    const route = state.route;
    const copy = route ? FIRST_CONTRACT_COPY[route] : null;
    const complete = Boolean(state.completedAt);
    const preparation = route ? firstContractPreparation(character, route) : null;
    const journalTitle = laterDay ? 'Welcome back to the road.' : complete ? 'Your first assignment, recorded.' : route && !choosing ? copy!.title : 'Your legend starts here.';
    const execute = async (action: AcademyNarrativeAction, destination?: Screen, activity?: FirstContractRoute) => {
        if (actionLock.current) return;
        actionLock.current = true; setBusy(true); setError('');
        try {
            const result = await commitAcademyNarrativeAction(character.name, action);
            if (!mounted.current) return;
            if (!onVersionedCharacter(result.character, result._saveVersion)) throw new Error('Your save changed while the journal was open. Please try again.');
            setChoosing(false);
            if (activity) { setOpen(false); openFirstContractActivity(result.character, activity, navigate); }
            else if (destination) { setOpen(false); navigate(destination); }
        } catch (reason) {
            if (mounted.current) setError(reason instanceof Error ? reason.message : 'Your journal could not be saved. Try again.');
        } finally { actionLock.current = false; if (mounted.current) setBusy(false); }
    };
    const choose = (next: FirstContractRoute) => { void execute(next, undefined, next); };
    const go = () => {
        captureProductEvent('first_hour_milestone', { source: 'first-contract', stateCategory: 'activity-opened', mode: route ?? 'undecided' });
        setOpen(false); openFirstContractActivity(character, route!, navigate);
    };
    const trainingNote = activeTraining
        ? activeTraining.endsAt <= now ? 'Your stat-training timer has finished. Check the Training Grounds to collect it.' : 'Your stat training is running. Check the Training Grounds when its timer finishes.'
        : 'Before you leave, start a stat-training timer. It keeps running while you are away.';
    const content = <>
        <header className="fc-journal-hero">
            <div className="fc-journal-art" aria-hidden="true" />
            <div className="fc-hero-copy">
                <p className="fc-eyebrow">{laterDay ? 'The next chapter' : complete ? 'Field journal · Entry 01' : 'First Contract · Beyond the Academy'}</p>
                <h2>{journalTitle}</h2>
                <span className="fc-hero-rule" aria-hidden="true" />
            </div>
        </header>
        <div className="fc-journal-body">
            {laterDay ? <>
                <p>Your first assignment is behind you. Decide what you want to improve today.</p><p className="fc-note">{trainingNote}</p>
                <div className="fc-actions"><button className="fc-primary" disabled={busy} onClick={() => { void execute('contract-return', 'training'); }}>Check your training</button><button className="fc-secondary" disabled={busy} onClick={() => { void execute('contract-return', 'missions'); }}>Take a mission</button></div>
            </> : complete ? <>
                <p className="fc-success"><span aria-hidden="true">✓</span> {copy?.success}</p>
                {state.evidence?.sector && <p>Field record: Sector {state.evidence.sector}.</p>}
                {character.academyVow && <blockquote>“{academyVowDefinition(character.academyVow).quote}”<cite>Your answer to Shiranui</cite></blockquote>}
                <p className="fc-note">{trainingNote}</p>
                <div className="fc-actions"><button className="fc-primary" disabled={busy} onClick={() => { void execute('contract-acknowledge', undefined, route ?? 'combat'); }}>{copy?.next ?? 'Take another assignment'}</button><button className="fc-secondary" disabled={busy} onClick={() => { void execute('contract-acknowledge', 'logbook'); }}>Choose your next goal</button></div>
            </> : !route || choosing ? <>
                <p className="fc-intro">{state.source === 'skip' ? 'Three paths beyond the Academy. Choose your first assignment; the refresher is here whenever you need it.' : 'The Academy opened the gate. Now take your first assignment into the world.'}</p>
                <FirstContractRoutes onChoose={choose} busy={busy} hasCompanion={character.pets.length > 0} selected={route} />
                <p className="fc-footnote">Your path. Your pace. You can change direction; each activity keeps its usual rewards.</p>
            </> : <>
                <p>{copy!.line}</p><p className="fc-note">{preparation?.detail ?? copy!.why}</p>
                {route === 'combat' && <p className="fc-footnote">Mission Hall → Combat → E-Rank Drill. After winning, return to claim the reward.</p>}
                <div className="fc-actions"><button className="fc-primary" disabled={busy} onClick={go}>{preparation?.label ?? copy!.action}</button><button className="fc-secondary" disabled={busy} onClick={() => setChoosing(true)}>Choose another route</button></div>
            </>}
            {<div className="fc-basics"><button type="button" className="fc-text-button" aria-expanded={basics} onClick={() => { setBasics(!basics); if (!basics) captureProductEvent('first_hour_milestone', { source: 'first-contract', stateCategory: 'basics-opened' }); }}>Two-minute refresher <span aria-hidden="true">{basics ? '−' : '+'}</span></button>
                {basics && <ol><li><strong>Prepare.</strong> Equip learned jutsu in Profile and starter gear in Inventory. Spend unused stat points in Profile.</li><li><strong>Fight.</strong> Move into range, spend AP on attacks or jutsu, and Wait to pass the turn. Watch chakra and cooldowns.</li><li><strong>Collect.</strong> A mission win may leave a reward to claim in Mission Hall. Recover at the Cafeteria; a knockout sends you to the Hospital.</li><li><strong>Grow.</strong> Start stat training before logging out. Your Logbook points to the next goal.</li></ol>}
            </div>}
            {busy && <p role="status">Saving your journal…</p>}{error && <p className="fc-error" role="alert">{error}</p>}
        </div>
    </>;
    return <>
        {screen === 'worldMap' && <button type="button" className="fc-map-hint" onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}>
            <span><span className="fc-eyebrow">{laterDay ? 'Welcome back' : complete ? 'Assignment complete' : 'First Contract'}</span><strong>{laterDay ? 'Choose your next step' : complete ? 'Read your field journal' : route === 'discovery' ? 'Travel to a sector · Explore one field tile' : copy?.title ?? 'Choose your first assignment'}</strong></span>
            <span aria-hidden="true">↗</span>
        </button>}
        {screen !== 'worldMap' && <section className="fc-ribbon" aria-label="First Contract">
            <span className="fc-ribbon-mark" aria-hidden="true">01</span><div><span className="fc-eyebrow">{laterDay ? 'Welcome back' : complete ? 'Assignment complete' : 'Your first contract'}</span><strong>{complete ? 'A new entry in your field journal' : copy?.title ?? 'Choose your next step'}</strong></div>
            <button type="button" onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}>{laterDay ? 'Continue' : complete ? 'Read your entry' : route ? 'View assignment' : 'Choose a route'} <span aria-hidden="true">↗</span></button>
        </section>}
        {modal && createPortal(<div className="fc-backdrop"><section className="fc-journal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="First Contract field journal" tabIndex={-1} onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
            if (event.key !== 'Tab') return;
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]'));
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first?.focus(); }
        }}><button className="fc-close" type="button" aria-label="Close field journal" onClick={() => setOpen(false)}>×</button><div className="fc-journal-scroll">{content}</div></section></div>, document.body)}
    </>;
}
