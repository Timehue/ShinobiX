import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RALLY_HZ, type RallyAction, type RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyOrder, replayRallyCheckpoint, stepRally } from '../../../../shared/sunscar/rally-simulation';
import { rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { RALLY_TECHNIQUES } from '../../../../shared/sunscar/rally-profiles';
import { playPetSfx, primePetSfx } from '../../lib/pet-sfx';
import type { RallyResponse } from '../../lib/sunscar-rally';
import { RallyControls } from './RallyControls';
import { PetModelBoundary } from '../../components/PetModelBoundary';
import { festivalPrestige } from '../../../../shared/sunscar/prestige';
import { startGameAmbience, stopGameAmbience } from '../../lib/game-audio';

const RallyCanvas = lazy(() => import('./RallyCanvas'));
type Props = {
    initial: RallyState; difficulty: number; official: boolean; title: string;
    onBegin?: () => Promise<void>;
    onCheckpoint?: (fromTick: number, toTick: number, actions: RallyAction[]) => Promise<RallyResponse>;
    onExit: () => void; onFinished: (state: RallyState) => void;
    reputation?: number;
};
export function RallyRace({ initial, difficulty, official, title, onBegin, onCheckpoint, onExit, onFinished, reputation = 0 }: Props) {
    const state = useRef(structuredClone(initial));
    const [hud, setHud] = useState(() => ({ tick: initial.tick, stamina: initial.racers[0].stamina, position: 1, progress: 0, used: initial.racers[0].techniqueUsed, section: '', finished: initial.finished }));
    const [ready, setReady] = useState<string[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [started, setStarted] = useState(false);
    const [paused, setPaused] = useState(false);
    const [error, setError] = useState('');
    const [modelError, setModelError] = useState(false);
    const [saving, setSaving] = useState(false);
    const running = useRef(false);
    const accumulator = useRef(0);
    const inputs = useRef<RallyAction[]>([]);
    const queued = useRef<RallyAction['kind'][]>([]);
    const acknowledged = useRef(initial.tick);
    const saveBusy = useRef(false);
    const completed = useRef(false);
    const saveRef = useRef(onCheckpoint);
    const onFinishedRef = useRef(onFinished);
    useLayoutEffect(() => { saveRef.current = onCheckpoint; onFinishedRef.current = onFinished; });
    const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const track = rallyTrack(initial.trackId);
    const prestige = festivalPrestige('rally', reputation);
    useLayoutEffect(() => { running.current = started && !paused && !error && !modelError && !state.current.finished && (!official || state.current.tick - acknowledged.current < 600); });
    const onReady = useCallback((id: string) => setReady(old => old.includes(id) ? old : [...old, id]), []);
    const onFail = useCallback(() => { setModelError(true); running.current = false; }, []);
    const input = useCallback((kind: RallyAction['kind']) => { if (running.current && !queued.current.includes(kind) && queued.current.length < 6) queued.current.push(kind); }, []);
    const advance = useCallback((delta: number) => {
        if (!running.current) { accumulator.current = 0; return; }
        accumulator.current += delta;
        while (accumulator.current >= 1 / RALLY_HZ && !state.current.finished) {
            const race = state.current;
            if (official && race.tick - acknowledged.current >= 600) { running.current = false; break; }
            const actions = queued.current.splice(0).map(kind => ({ tick: race.tick, kind }));
            inputs.current.push(...actions);
            const player = race.racers[0];
            const hit = player.hits, jump = player.jump, used = player.techniqueUsed;
            stepRally(race, actions, difficulty);
            if (player.hits > hit) playPetSfx('hit');
            if (player.jump > 0 && jump === 0) playPetSfx('move');
            if (player.techniqueUsed && !used) playPetSfx('finisher');
            accumulator.current -= 1 / RALLY_HZ;
            if (race.tick % 6 === 0 || race.finished) {
                setHud({ tick: race.tick, stamina: player.stamina, position: rallyOrder(race).findIndex(r => r.id === 'player') + 1,
                    progress: Math.max(0, player.distance / track.length), used: player.techniqueUsed,
                    section: track.sections.find(s => player.distance >= s.from && player.distance < s.to)?.name ?? 'Finish', finished: race.finished });
            }
        }
    }, [difficulty, official, track]);
    const checkpoint = useCallback(async (force = false) => {
        const race = state.current;
        if (saveBusy.current || !official || !saveRef.current || race.tick <= acknowledged.current) return;
        if (!force && !race.finished && race.tick - acknowledged.current < 300) return;
        saveBusy.current = true;
        setSaving(true);
        const from = acknowledged.current, to = Math.min(race.tick, from + 300);
        try {
            const response = await saveRef.current(from, to, inputs.current.filter(a => a.tick >= from && a.tick < to));
            const saved = response.progress.current?.race;
            if (!saved || saved.tick < to && !saved.finished) throw new Error('The race desk has not confirmed this checkpoint. Retry to continue.');
            acknowledged.current = saved.tick;
            inputs.current = inputs.current.filter(a => a.tick >= saved.tick);
            // Rebase unacknowledged inputs onto the authoritative state. This
            // also recovers when another device saved different steering first.
            state.current = saved.tick < race.tick && !saved.finished
                ? replayRallyCheckpoint(saved, race.tick, inputs.current, difficulty)
                : structuredClone(saved);
            setError('');
            if (saved.finished && !completed.current) { completed.current = true; playPetSfx('victory'); onFinishedRef.current(saved); }
            return true;
        } catch (cause) {
            running.current = false;
            setError(cause instanceof Error ? cause.message : 'Connection lost. Retry your saved inputs.');
            return false;
        } finally { saveBusy.current = false; setSaving(false); }
    }, [official, difficulty]);
    useEffect(() => {
        if (error) return;
        const timer = window.setInterval(() => void checkpoint(paused), 300);
        return () => window.clearInterval(timer);
    }, [checkpoint, paused, error]);
    useEffect(() => {
        if (started && !paused && !error && !hud.finished) startGameAmbience('ambience-road', { gain: .018 });
        else stopGameAmbience(250);
        return () => stopGameAmbience(250);
    }, [started, paused, error, hud.finished]);
    useEffect(() => {
        const pause = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !started || state.current.finished) return;
            event.preventDefault(); running.current = false; queued.current = ['burst-off']; setPaused(true);
        };
        window.addEventListener('keydown', pause);
        return () => window.removeEventListener('keydown', pause);
    }, [started]);
    useEffect(() => {
        const hide = () => { if (document.hidden) { running.current = false; queued.current = ['burst-off']; setPaused(true); void checkpoint(true); } };
        document.addEventListener('visibilitychange', hide);
        return () => document.removeEventListener('visibilitychange', hide);
    }, [checkpoint]);
    useEffect(() => {
        if (hud.finished && !official && !completed.current) { completed.current = true; playPetSfx('victory'); onFinishedRef.current(state.current); }
    }, [hud.finished, official]);
    useEffect(() => {
        if (countdown === null) return;
        playPetSfx('command');
        const timer = window.setTimeout(() => {
            if (countdown <= 1) { setStarted(true); setCountdown(null); playPetSfx('crowd'); }
            else setCountdown(countdown - 1);
        }, 850);
        return () => window.clearTimeout(timer);
    }, [countdown]);
    async function begin() {
        try { primePetSfx(); setSaving(true); if (onBegin) await onBegin(); setCountdown(3); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The race could not start. Please retry.'); }
        finally { setSaving(false); }
    }
    async function leave() {
        running.current = false; setPaused(true);
        if (saveBusy.current) return;
        while (official && state.current.tick > acknowledged.current) if (!await checkpoint(true)) return;
        onExit();
    }
    return <section className="rally-race" aria-label={`${track.name} race`}>
        <div className="rally-stage" aria-label="3D race course">
            <PetModelBoundary onFail={onFail}><Suspense fallback={<div className="sunscar-loading" role="status">Preparing the course…</div>}><RallyCanvas state={state} advance={advance} onReady={onReady} onFail={onFail} reducedMotion={reducedMotion} /></Suspense></PetModelBoundary>
            <div className="rally-hud">
                {prestige && <span className="rally-prestige-pennant" title={prestige.cosmetic} style={{ color: prestige.color }}>✥</span>}
                <div className="rally-position"><strong>{hud.position}<small>/4</small></strong><span>{hud.section || title}</span></div>
                <div className="rally-progress"><span>{track.name}</span><progress aria-label="Race progress" value={hud.progress} max={1} /><small>{(hud.tick / RALLY_HZ).toFixed(1)}s {saving ? '· Saving' : official ? '· Official' : '· Practice'}</small></div>
                <button className="rally-pause" aria-label={paused ? 'Resume race' : 'Pause race'} onClick={() => { queued.current = []; input('burst-off'); setPaused(p => !p); }} disabled={!started || hud.finished}>{paused ? 'Resume' : 'Pause'}</button>
            </div>
            {!started && countdown === null && <div className="rally-intro-overlay"><p className="sunscar-eyebrow">{title}</p><h2>{track.name}</h2><p>{track.description}</p><p className="rally-learn">Steer around tall loads. Jump low barriers. Hold Burst on clear ground. Follow green rings for shortcuts.</p>
                {modelError ? <p role="alert">A pet model could not load. Return to the race desk and retry; your entry is safe.</p> : <p role="status">{ready.length < 4 ? `Preparing companions · ${ready.length}/4` : 'All companions ready'}</p>}
                <div className="sunscar-button-row"><button onClick={() => void begin()} disabled={ready.length < 4 || modelError || saving}>{saving ? 'Starting…' : initial.tick > 0 ? 'Resume from checkpoint' : 'Ready to race'}</button><button className="sunscar-secondary" onClick={onExit}>Race desk</button></div>
            </div>}
            {countdown !== null && <div className="rally-countdown" role="status" aria-live="assertive">{countdown || 'GO'}</div>}
            {(paused || error || started && modelError) && <div className="rally-pause-overlay"><h2>{error ? 'Race held safely' : modelError ? 'Rendering interrupted' : 'Taking a breather'}</h2><p role={error ? 'alert' : undefined}>{error || 'Your race clock is paused. Continue when you are ready.'}</p><div className="sunscar-button-row">
                <button onClick={() => { if (error && started) void checkpoint(true); else if (error) { setError(''); void begin(); } else setPaused(false); }} disabled={saving || modelError}>{saving ? 'Saving…' : error ? 'Retry connection' : 'Continue race'}</button>
                <button className="sunscar-secondary" onClick={() => void leave()}>Save & return</button>{error && <button className="sunscar-secondary" onClick={onExit}>Return to last saved checkpoint</button>}</div>{error && <small>Returning to the saved checkpoint discards only inputs the race desk has not confirmed.</small>}</div>}
            <div className="rally-stamina"><span>Burst</span><meter min={0} max={100} value={hud.stamina} aria-label="Burst stamina" /></div>
        </div>
        <RallyControls input={input} disabled={!started || paused || !!error || modelError || hud.finished} technique={RALLY_TECHNIQUES[initial.racers[0].pet.element].name} techniqueUsed={hud.used} stamina={hud.stamina} />
        <p className="rally-save-note">{official ? 'Official checkpoints save during the race. Backgrounding pauses the clock.' : 'Practice is unlimited. No entry or reward is consumed.'}</p>
    </section>;
}
