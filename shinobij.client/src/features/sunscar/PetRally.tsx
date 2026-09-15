import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import { requestRally, type RallyResponse } from '../../lib/sunscar-rally';
import { petCardImage } from '../../lib/pet-battle-anim';
import { RALLY_TRACKS, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { RALLY_TECHNIQUES, rallyProfile } from '../../../../shared/sunscar/rally-profiles';
import { RALLY_RIVALS } from '../../../../shared/sunscar/rally-rivals';
import { rallyRank, rallyStandings } from '../../../../shared/sunscar/rally-championship';
import { rallyResult } from '../../../../shared/sunscar/rally-simulation';
import type { RallyAction, RallyElement, RallyState, RallyTrack } from '../../../../shared/sunscar/rally-types';
import { RallyRace } from './RallyRace';
import { RallySession } from './RallySession';
import { SunscarPrestige } from './SunscarPrestige';
import '../../styles/sunscar-modes.css';

function CoursePreview({ track }: { track: RallyTrack }) {
    const bends = track.sections.map((s, i) => `${35 + i * 38},${55 + s.curve}`).join(' ');
    return <svg className={`rally-course-preview rally-course-${track.scenery}`} viewBox="0 0 240 110" aria-hidden="true">
        <path d="M0 100 45 60 94 85 137 32 194 74 240 50V110H0Z" fill="currentColor" opacity=".12" />
        <polyline points={bends} fill="none" stroke="currentColor" strokeWidth="12" strokeLinejoin="round" opacity=".18" />
        <polyline points={bends} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" strokeLinejoin="round" />
        <circle cx="35" cy="55" r="5" fill="currentColor" /><path d="M205 31v25m0-24h18l-6 6 6 6h-18" stroke="currentColor" fill="none" />
    </svg>;
}
function RaceResults({ state, response, official, onContinue, onDesk }: { state: RallyState; response: RallyResponse | null; official: boolean; onContinue: () => void; onDesk: () => void }) {
    const results = rallyResult(state);
    const run = response?.progress.current;
    const complete = official && run?.status === 'complete';
    const standing = official && run ? rallyStandings(run.results) : [];
    const label = (id: string) => id === 'player' ? 'You' : RALLY_RIVALS.find(r => r.id === id)?.name ?? id;
    return <section className="rally-results" aria-labelledby="rally-results-title" tabIndex={-1}>
        <div><p className="sunscar-eyebrow">{complete ? 'Daily championship complete' : official ? 'Official race verified' : 'Practice complete'}</p><h2 id="rally-results-title">{complete ? `${run.reward?.place === 1 ? 'Sunscar is yours today.' : 'A place on the finish board.'}` : 'Across the line'}</h2>
            {complete && run.reward && <p className="rally-earned">{run.reward.ryo.toLocaleString()} Ryo <span>+ {run.reward.reputation} Rally reputation · Saved</span></p>}
        </div>
        <div className="rally-result-tables"><table><caption>This race</caption><thead><tr><th scope="col">Place</th><th scope="col">Handler</th><th scope="col">Time</th><th scope="col">Points</th></tr></thead><tbody>{results.placements.map((r, i) => <tr key={r.id} className={r.id === 'player' ? 'is-player' : ''}><td>{i + 1}</td><th scope="row">{label(r.id)}</th><td>{(r.tick / 60).toFixed(2)}s</td><td>{official ? r.points : '—'}</td></tr>)}</tbody></table>
            {official && <table><caption>Grand Prix standings · {run?.results.length}/3 races</caption><thead><tr><th scope="col">Place</th><th scope="col">Handler</th><th scope="col">Points</th></tr></thead><tbody>{standing.map((r, i) => <tr key={r.id} className={r.id === 'player' ? 'is-player' : ''}><td>{i + 1}</td><th scope="row">{label(r.id)}</th><td>{r.points}</td></tr>)}</tbody></table>}
        </div>
        <p>{state.racers[0].hits} obstacle contacts · {state.racers[0].shortcuts} shortcuts taken. {RALLY_RIVALS.find(r => r.id === results.placements[0].id)?.outro}</p>
        <div className="sunscar-button-row">{official && !complete && <button onClick={onContinue}>Next race · {rallyTrack(run?.tracks[run.results.length] ?? 'grand-circuit').name}</button>}<button className="sunscar-secondary" onClick={onDesk}>Return to the race desk</button></div>
    </section>;
}
export default function PetRally({ character, onVersionedCharacter, onBack }: { character: Character; onVersionedCharacter: VersionedCharacterCommit; onBack: () => void }) {
    const [response, setResponse] = useState<RallyResponse | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [petId, setPetId] = useState(character.pets[0]?.id ?? '');
    const [courseId, setCourseId] = useState('grand-circuit');
    const [race, setRace] = useState<{ state: RallyState; official: boolean; runId?: string; index: number; difficulty: number; key: string } | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const desk = useRef<HTMLDivElement>(null);
    const hadRace = useRef(false);
    useEffect(() => {
        if (!race && hadRace.current) {
            desk.current?.focus({ preventScroll: true });
            desk.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
        }
        hadRace.current = !!race;
    }, [race]);
    const [finished, setFinished] = useState<RallyState | null>(null);
    useEffect(() => {
        if (!finished) return;
        const result = document.querySelector<HTMLElement>('.rally-results');
        result?.focus({ preventScroll: true });
        result?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    }, [finished]);
    const responseRef = useRef(response);
    const commitCharacter = useRef(onVersionedCharacter);
    useLayoutEffect(() => { commitCharacter.current = onVersionedCharacter; }, [onVersionedCharacter]);
    const adopt = useCallback((data: RallyResponse) => {
        setResponse(data);
        responseRef.current = data;
        if (data.progress.current && ['racing', 'between'].includes(data.progress.current.status)) setPetId(data.progress.current.pet.id);
        if (data.character) commitCharacter.current(data.character, data._saveVersion);
        return data;
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        requestRally(character.name, undefined, controller.signal).then(adopt).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
        return () => controller.abort();
    }, [character.name, adopt]);
    const serverNow = response?.serverNow;
    useEffect(() => {
        if (serverNow === undefined) return;
        const controller = new AbortController();
        const nextDay = Date.parse(`${new Date(serverNow).toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000;
        const timer = window.setTimeout(() => {
            requestRally(character.name, undefined, controller.signal).then(adopt).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
        }, Math.max(1000, nextDay - serverNow + 1000));
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [serverNow, character.name, adopt]);
    async function refresh() { try { setBusy(true); setError(''); adopt(await requestRally(character.name)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The race desk is unavailable.'); } finally { setBusy(false); } }
    function openOfficial(data: RallyResponse) {
        const run = data.progress.current;
        if (!run || run.status === 'complete') return;
        const initial = run.status === 'racing' ? run.race : data.preview;
        if (!initial) { setError('The course could not be prepared. Refresh the race desk.'); return; }
        const index = run.status === 'racing' ? run.raceIndex : run.results.length;
        setFinished(null);
        setRace({ state: initial, official: true, runId: run.id, index, difficulty: run.difficulty, key: `${run.id}:${index}` });
    }
    async function enter(official: boolean) {
        try {
            setBusy(true); setError('');
            if (official) {
                const active = response?.progress.current;
                const data = active && ['racing', 'between'].includes(active.status) ? response! : adopt(await requestRally(character.name, { action: 'prepare', petId }));
                openOfficial(data);
            } else {
                const data = adopt(await requestRally(character.name, { action: 'practice', petId, trackId: courseId }));
                if (!data.practice) throw new Error('Practice could not be prepared.');
                setFinished(null);
                setRace({ state: data.practice, official: false, index: 0, difficulty: 0, key: `practice:${Date.now()}` });
            }
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'The course could not be opened.'); } finally { setBusy(false); }
    }
    async function checkpoint(fromTick: number, toTick: number, actions: RallyAction[]) {
        return adopt(await requestRally(character.name, { action: 'checkpoint', runId: race?.runId, raceIndex: race?.index, fromTick, toTick, actions }));
    }
    const pet = character.pets.find(p => p.id === petId);
    const profile = pet ? rallyProfile({ id: pet.templateId ?? pet.id, name: pet.name }) : null;
    const technique = RALLY_TECHNIQUES[(pet?.element ?? 'Fire') as RallyElement];
    const progress = response?.progress;
    const active = progress?.current && progress.current.status !== 'complete' && progress.current.status !== 'ready';
    const dailyComplete = progress?.lastEntryDay === response?.daily.day && !active;
    if (race) return <RallySession>
        <RallyRace key={race.key} initial={race.state} difficulty={race.difficulty} official={race.official} title={race.official ? `Sunscar Grand Prix · Race ${race.index + 1} of 3` : 'Open practice'}
            onBegin={race.official ? async () => { adopt(await requestRally(character.name, { action: 'begin', runId: race.runId })); } : undefined}
            onCheckpoint={race.official ? checkpoint : undefined}
            reputation={progress?.reputation} onFinished={setFinished} onExit={() => { setRace(null); setFinished(null); void refresh(); }} />
        {finished && <RaceResults state={finished} response={response} official={race.official} onContinue={() => { if (responseRef.current) openOfficial(responseRef.current); }} onDesk={() => { setRace(null); setFinished(null); void refresh(); }} />}
    </RallySession>;
    return <div className="sunscar-mode sunscar-rally" ref={desk} tabIndex={-1} aria-label="Pet Rally race desk">
        <header className="sunscar-mode-heading"><button className="sunscar-back" onClick={onBack}>← Festival</button><p className="sunscar-eyebrow">The sport of Sunscar</p><h1>Pet Rally</h1><p>Your companion. Four courses. One clean line through the dust.</p><div className="sunscar-status-pills"><span>{rallyRank(progress?.reputation ?? 0).name} · {progress?.reputation ?? 0} reputation</span><span>{dailyComplete ? 'Grand Prix complete today' : active ? 'Grand Prix in progress' : 'Daily Grand Prix available'}</span><span>Practice always open</span></div></header>
        {error && <div className="sunscar-error" role="alert"><p>{error}</p><button disabled={busy} onClick={() => void refresh()}>Retry connection</button></div>}
        {!response && !error && <div className="sunscar-loading" role="status">Opening the race desk…</div>}
        <SunscarPrestige mode="rally" reputation={progress?.reputation ?? 0}/>
        {progress?.current?.status === 'complete' && progress.current.reward && <section className="rally-championship-card"><div><p className="sunscar-eyebrow">Last Grand Prix · {progress.current.day}</p><h2>Finish board: place {progress.current.reward.place}</h2><p>{progress.current.reward.ryo.toLocaleString()} Ryo and {progress.current.reward.reputation} reputation received. Your result is saved.</p></div><button className="sunscar-secondary" onClick={() => setShowHistory(open => !open)}>{showHistory ? 'Close finish board' : 'View finish board'}</button></section>}
        {showHistory && progress?.current?.status === 'complete' && progress.current.race && <RaceResults state={progress.current.race} response={response} official onContinue={() => undefined} onDesk={() => setShowHistory(false)}/>}
        {character.pets.length === 0 ? <section className="sunscar-empty"><h2>A companion makes the team</h2><p>Meet your first pet in the Pet Yard, then bring them to the start line. All rarities compete on equal terms.</p><button onClick={onBack}>Back to Sunscar</button></section> : <>
            <section className="rally-selection" aria-labelledby="rally-pet-heading"><div><p className="sunscar-eyebrow">01 / Your racing partner</p><h2 id="rally-pet-heading">Choose a companion</h2><p>Species have different strengths. Rarity and combat training do not decide the race.</p><div className="rally-pet-list" role="group" aria-label="Owned pets">{character.pets.map(p => <button key={p.id} className={p.id === petId ? 'selected' : ''} aria-pressed={p.id === petId} disabled={!!active} onClick={() => setPetId(p.id)}><img src={petCardImage(p)} alt="" loading="lazy" /><span>{p.nickname || p.name}<small>{p.element}</small></span></button>)}</div></div>
                <aside className="rally-pet-dossier">{pet && <><img src={petCardImage(pet)} alt={pet.name} /><h3>{pet.nickname || pet.name}</h3><p>{technique?.name}</p><small>{technique?.description}</small>{profile && <dl>{(['speed', 'acceleration', 'agility', 'endurance', 'stability'] as const).map(key => <div key={key}><dt>{key}</dt><dd><meter aria-label={key} min={0} max={100} value={profile[key]} />{profile[key]}</dd></div>)}</dl>}</>}</aside>
            </section>
            <section className="rally-championship-card"><div><p className="sunscar-eyebrow">02 / The headline event</p><h2>Daily Sunscar Grand Prix</h2><p>Three courses, the same rivals, and a running points table. Your pet stays with you throughout the championship.</p><p className="sunscar-fine">One entry per UTC day · Rewards verified by the race desk · Ties break on combined race time</p><ol className="rally-daily-courses">{(active ? progress?.current?.tracks : response?.daily.tracks)?.map(id => <li key={id}>{rallyTrack(id).name}</li>)}</ol></div><button disabled={busy || !response || !!dailyComplete} onClick={() => void enter(true)}>{busy ? 'Preparing…' : dailyComplete ? 'Return tomorrow' : active ? 'Resume Grand Prix' : 'Prepare Grand Prix'}</button></section>
            <section aria-labelledby="rally-courses-heading"><div className="sunscar-section-heading"><div><p className="sunscar-eyebrow">Learn the road</p><h2 id="rally-courses-heading">Open practice</h2></div><button disabled={busy || !response} onClick={() => void enter(false)}>Practice selected course</button></div><div className="rally-course-grid">{RALLY_TRACKS.map(track => <button key={track.id} className={`rally-course-card ${courseId === track.id ? 'selected' : ''}`} onClick={() => setCourseId(track.id)} aria-pressed={courseId === track.id}><CoursePreview track={track} /><span className="sunscar-eyebrow">{track.subtitle}</span><strong>{track.name}</strong><span>{track.traits.join(' · ')}</span>{progress?.best[track.id] && <small>Official best {(progress.best[track.id] / 60).toFixed(2)}s</small>}</button>)}</div></section>
            <section aria-labelledby="rally-rivals-heading"><p className="sunscar-eyebrow">Familiar faces at the starting line</p><h2 id="rally-rivals-heading">{active ? 'Your Grand Prix rivals' : 'Today’s rivals'}</h2><div className="rally-rivals">{(active ? progress?.current?.rivals : response?.daily.rivals)?.map(id => { const rival = RALLY_RIVALS.find(r => r.id === id)!; return <article key={id} style={{ borderTopColor: rival.color }}><span className="rally-rival-number">{RALLY_RIVALS.indexOf(rival) + 1}</span><h3>{rival.name}</h3><p>{rival.petName} · {rival.style}</p><blockquote>“{rival.intro}”</blockquote></article>; })}</div></section>
        </>}
    </div>;
}
