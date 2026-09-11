import { useEffect, useState } from 'react';
import type { Character } from '../../types/character';
import { CIRCUIT_DISCIPLINES, circuitPhase, circuitFeatured, type CircuitDiscipline, type CircuitResponse } from '../../../../shared/dojo-circuit';
import { cardGameLockStatus } from '../../lib/chronicle-lock';
import { CircuitMark } from './CircuitMark';
import { CircuitBoard, CircuitHonours } from './CircuitBoard';
import { DISCIPLINES, PHASE_LABELS, circuitTime, eventDate, villageTone } from './presentation';
import hero from '../../assets/dojo-circuit/dojo-hero.webp';
import heroMobile from '../../assets/dojo-circuit/dojo-hero-mobile.webp';
import './dojo-circuit.css';

type Props = {
    character: Pick<Character, 'name' | 'village' | 'level' | 'starterCardsClaimed' | 'pets'>;
    data: CircuitResponse | null; busy?: boolean; error?: string; archive?: boolean; preview?: boolean;
    onBack: () => void; onAction: (action: string, discipline?: CircuitDiscipline) => void;
    onLaunch: (discipline: CircuitDiscipline) => void; onRefresh: () => void; onHistory: (id: string) => void;
};
export function CircuitExperience(props: Props) {
    // An archive is a separate view, with its own tab and briefing state.
    return <CircuitExperienceContent key={`${props.archive ? 'archive' : 'current'}:${props.data?.event?.id ?? ''}`} {...props} />;
}
function CircuitExperienceContent({ character, data, busy = false, error = '', archive = false, preview = false, onBack, onAction, onLaunch, onRefresh, onHistory }: Props) {
    const [tab, setTab] = useState<'trials' | 'board' | 'honours'>(archive ? 'honours' : 'trials');
    const [brief, setBrief] = useState<CircuitDiscipline | null>(null);
    const serverNow = data?.serverNow;
    const [clock, setClock] = useState(() => ({ serverNow, now: serverNow ?? Date.now() }));
    // New responses are reflected immediately; only timer callbacks update state.
    const now = clock.serverNow === serverNow ? clock.now : serverNow ?? clock.now;
    useEffect(() => {
        const receivedAt = Date.now();
        const tick = setInterval(() => setClock({ serverNow, now: (serverNow ?? receivedAt) + Date.now() - receivedAt }), 10_000);
        return () => clearInterval(tick);
    }, [serverNow]);
    const event = data?.event ? { ...data.event, featured: circuitFeatured(data.event, now) } : null;
    const phase = circuitPhase(archive || !!data?.enabled, event, now);
    const mine = event?.entrants.find(e => e.name.toLowerCase() === character.name.toLowerCase());
    const seals = mine?.seals ?? [];
    const active = phase === 'live' && !archive;
    const finished = phase === 'results';
    const lockedReason = (d: CircuitDiscipline) => d === 'cards' && cardGameLockStatus(character).locked ? cardGameLockStatus(character).body : d === 'pets' && !character.pets.length ? 'Adopt a companion before entering this discipline.' : '';
    const act = (action: string, discipline?: CircuitDiscipline) => { if (!preview) onAction(action, discipline); };
    const target = phase === 'upcoming' ? event?.startsAt : event?.endsAt;
    return <main className="dojo-circuit" data-village-tone={villageTone(character.village)} aria-label="Dojo Circuit">
        <div className="dc-topline"><button className="dc-back" onClick={onBack}><span aria-hidden="true">←</span> {archive ? 'Current Circuit' : 'Return to village'}</button><span>{preview ? 'ADMIN PREVIEW · No activity recorded' : archive ? 'CIRCUIT ARCHIVE' : 'WORLD EVENT · ALL FOUR VILLAGES'}</span></div>
        <header className="dc-hero">
            <picture><source media="(max-width: 700px)" srcSet={heroMobile} /><img src={hero} alt="Dojo courtyard at dusk with four village pennants, a card table, and a carved companion guardian" fetchPriority="high" /></picture>
            <div className="dc-hero-shade" />
            <div className="dc-hero-content"><div className="dc-brand"><CircuitMark /><span>THE FOUR VILLAGES PRESENT</span></div><h1>Dojo <em>Circuit</em></h1><p>Prove your courage. Play your hand.<br />Stand with your companion.</p>
                <div className="dc-hero-actions">{active && !mine ? <button className="dc-primary" disabled={busy || preview} onClick={() => act('join')}>{busy ? 'Joining…' : 'Join the Circuit'} <span aria-hidden="true">↗</span></button> : <button className="dc-primary" onClick={() => { setTab(finished ? 'honours' : 'trials'); document.getElementById('dc-content')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }}>{finished ? 'View the honours' : mine ? 'Your Circuit passport' : 'Explore the disciplines'} <span aria-hidden="true">↓</span></button>}<span className="dc-hero-note">Three disciplines. One shared gathering.</span></div>
            </div>
            <div className="dc-event-strip"><span className={`dc-live-dot ${active ? 'live' : ''}`} /><strong>{data ? PHASE_LABELS[phase] : 'Opening the event board…'}</strong><span className="dc-event-name">{event?.name ?? 'The next chapter awaits'}</span>{target && !finished && phase !== 'offline' ? <span className="dc-timer">{phase === 'upcoming' ? 'Begins in' : 'Closes in'} <b>{circuitTime(target, now)}</b></span> : <span className="dc-timer">{event ? `${event.entrants.length} participants` : 'Open to every village'}</span>}</div>
        </header>
        {error && <div className="dc-alert" role="alert"><span>{error}</span><button onClick={onRefresh} disabled={busy}>Retry</button></div>}
        {data?.message && <div className="dc-announcement" role="status">{data.message}</div>}
        {!data ? <div className="dc-loading" aria-busy="true"><CircuitMark /><p>Unrolling the Circuit record…</p><div /><div /><div /></div> : <>
            <nav className="dc-tabs" aria-label="Circuit pages">{([['trials', 'The disciplines'], ['board', 'World board'], ['honours', 'Honours & history']] as const).map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setBrief(null); }}>{label}{id === 'board' && event ? <span>{event.entrants.length}</span> : null}</button>)}</nav>
            <div id="dc-content" className="dc-content">
                {tab === 'trials' && <>
                    {(phase === 'offline' || phase === 'unscheduled' || phase === 'upcoming') && <section className="dc-state-note"><CircuitMark /><div><h2>{phase === 'upcoming' ? 'Your invitation is waiting.' : phase === 'offline' ? 'The dojo is resting.' : 'A new gathering is on the horizon.'}</h2><p>{phase === 'upcoming' && event ? `The Circuit opens ${eventDate(event.startsAt)}. Explore the disciplines while the lanterns are being lit.` : phase === 'offline' ? 'The host has closed entry for now. Earned seals and past honours remain in the record.' : 'The host has not scheduled the next Circuit yet. You can explore its disciplines and visit the archive.'}</p></div></section>}
                    {finished && <section className="dc-state-note"><CircuitMark /><div><h2>This chapter is complete.</h2><p>The trials have closed. Visit Honours & history to see the finishers and the champion, once named.</p></div><button className="dc-secondary" onClick={() => setTab('honours')}>View honours</button></section>}
                    <div className="dc-section-heading"><div><span className="dc-eyebrow">A challenge for every side of you</span><h2>Three paths to your place in the record.</h2></div><span className="dc-section-note">Complete them in any order</span></div>
                    <div className="dc-trial-grid">{CIRCUIT_DISCIPLINES.map((d, index) => { const def = DISCIPLINES[d]; const earned = seals.some(s => s.discipline === d); const selected = data.attempt?.discipline === d; return <button key={d} className={`dc-trial-card ${earned ? 'is-earned' : ''} ${brief === d ? 'is-selected' : ''}`} onClick={() => setBrief(d)} aria-expanded={brief === d} aria-controls="dc-brief"><img src={def.art} alt="" loading="lazy" /><span className="dc-trial-shade" /><span className="dc-trial-top"><span>0{index + 1}</span><span className="dc-tag">{earned ? 'Seal earned' : selected ? 'Trial in progress' : event?.featured === d ? 'Featured discipline' : def.seal.replace('Seal of ', '')}</span></span><span className="dc-trial-text"><CircuitMark discipline={d} /><span className="dc-eyebrow">{def.eyebrow}</span><strong>{def.title}</strong><span>{def.description}</span><span className="dc-trial-link">{earned ? 'View your seal' : 'View the trial'} <span aria-hidden="true">↗</span></span></span></button>; })}</div>
                    {brief && <section className="dc-brief dc-panel" id="dc-brief" aria-label={`${DISCIPLINES[brief].title} briefing`}><CircuitMark discipline={brief} /><div><span className="dc-eyebrow">Your trial briefing</span><h2>{DISCIPLINES[brief].seal}</h2><p>{DISCIPLINES[brief].detail}</p><strong>{DISCIPLINES[brief].objective}</strong>{lockedReason(brief) && <p className="dc-requirement">{lockedReason(brief)}</p>}</div><div className="dc-brief-actions"><button className="dc-primary" disabled={!active || busy || preview || !!lockedReason(brief) || seals.some(s => s.discipline === brief) || (!!data.attempt && data.attempt.discipline !== brief)} onClick={() => mine ? onLaunch(brief) : act('join')}>{seals.some(s => s.discipline === brief) ? 'Seal earned' : !mine ? 'Join to participate' : data.attempt?.discipline === brief ? 'Resume trial' : 'Enter this trial'} <span aria-hidden="true">↗</span></button><button className="dc-text-button" onClick={() => setBrief(null)}>Close briefing</button></div></section>}
                    <div className="dc-lower-grid">
                        <section className="dc-passport dc-panel"><div className="dc-section-heading"><div><span className="dc-eyebrow">Your Circuit passport</span><h2>{mine ? character.name : 'Make your mark.'}</h2></div><span className="dc-passport-count">{seals.length}<small> / 3 seals</small></span></div><div className="dc-passport-seals">{CIRCUIT_DISCIPLINES.map(d => <div key={d} className={seals.some(s => s.discipline === d) ? 'earned' : ''}><CircuitMark discipline={d} /><strong>{DISCIPLINES[d].seal.replace('Seal of ', '')}</strong><small>{seals.some(s => s.discipline === d) ? 'Recorded' : 'Awaiting your mark'}</small></div>)}</div>
                            {data.attempt && active ? <div className="dc-check-in"><p><strong>{DISCIPLINES[data.attempt.discipline].title}</strong> is in progress. {data.attempt.discipline === 'combat' ? 'Your seal is recorded when the verified fight settles.' : 'Return after your victory to have the scribe record your seal.'}</p><div><button className="dc-primary" disabled={busy || preview} onClick={() => act('check')}>Record my victory</button><button className="dc-text-button" disabled={busy || preview} onClick={() => act('leaveTrial')}>Leave trial</button></div></div> : <p className="dc-muted">{seals.length === 3 ? 'Your three-seal honour is recorded. Visit the world board and celebrate the next finisher.' : 'Earn one seal per discipline. Your passport stays with this Circuit, across visits and villages.'}</p>}
                        </section>
                        <aside className="dc-panel dc-how"><span className="dc-eyebrow">An invitation, wherever you call home</span><h2>One gathering.<br />Four village doors.</h2><p>Join from your own village. Every seal joins the same world record.</p><ol><li><span>01</span><div><strong>Enter the Circuit</strong><p>Choose a discipline and read its briefing.</p></div></li><li><span>02</span><div><strong>Earn your three seals</strong><p>Play on your schedule. Each discipline counts once.</p></div></li><li><span>03</span><div><strong>Be part of its history</strong><p>All finishers receive a place in the event archive.</p></div></li></ol></aside>
                    </div>
                    <details className="dc-rules"><summary>Event rules & rewards</summary><p>Each Circuit runs for the period shown above. Join and begin a trial before playing; earlier victories do not count. Combat seals are recorded automatically from verified new spars. Card AI and companion seals require a new win followed by a check-in before closing. Qualifying player card duels record automatically; see the card briefing for eligibility. Normal mode costs and unlocks apply. You may leave an unfinished trial and choose another, but leaving discards that trial’s pending credit.</p><p>Rewards are event honours: an individual seal for each discipline, the three-seal finisher distinction, and an optional host-selected champion from eligible finishers after closing. These are kept in the Circuit archive. No Circuit rating or additional currency is awarded. If the host turns the event off, recorded seals remain but unfinished trials must be started again when it reopens. The closing time continues while the event is off.</p></details>
                </>}
                {tab === 'board' && (event ? <CircuitBoard event={event} playerName={character.name} /> : <div className="dc-panel dc-empty"><CircuitMark /><h2>The next gathering awaits.</h2><p>A shared participant board will open when the host schedules the next Circuit.</p></div>)}
                {tab === 'honours' && <CircuitHonours event={event} history={data.history.filter(h => h.id !== event?.id)} onHistory={onHistory} />}
            </div>
            <footer className="dc-footer"><CircuitMark /><span>DOJO CIRCUIT</span><span>Stormveil · Ashen Leaf · Frostfang · Moonshadow</span><button className="dc-text-button" onClick={onRefresh}>Refresh board</button></footer>
        </>}
    </main>;
}
