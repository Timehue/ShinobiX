import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RALLY_HZ, type RallyAction, type RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyOrder, replayRallyCheckpoint, restoreRallyRace, stepRally } from '../../../../shared/sunscar/rally-simulation';
import { rallySection, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { RALLY_ATTACK_NAMES, RALLY_TECHNIQUES } from '../../../../shared/sunscar/rally-profiles';
import { playPetSfx, primePetSfx } from '../../lib/pet-sfx';
import type { RallyResponse } from '../../lib/sunscar-rally';
import { RallyControls } from './RallyControls';
import { PetModelBoundary } from '../../components/PetModelBoundary';
import { festivalPrestige } from '../../../../shared/sunscar/prestige';
import { startGameAmbience, stopGameAmbience } from '../../lib/game-audio';
import { rallyFeedback } from './rally-feedback';
import { RALLY_SHOT_PROFILES } from '../../../../shared/sunscar/rally-combat';

const RallyCanvas = lazy(() => import('./RallyCanvas'));
/** After the finish the canvas keeps drawing for this much presentation time:
 * the pets glide to their podium spaces, the camera pulls back, and the
 * winner plays its victory clip (the longest authored one runs 2.3 s). Then it
 * drops to on-demand rendering so an idle results screen draws nothing. The
 * time is counted the way RallyPetModel advances its clips, at most 0.05 s a
 * frame, so a device drawing under 20 fps still sees the whole clip. */
const FINISH_SETTLE_SECONDS = 2.5;
function raceHud(race: RallyState) {
    const player = race.racers[0], track = rallyTrack(race.trackId);
    const section = rallySection(track, Math.max(0, player.distance));
    return { ...rallyFeedback(race), tick: race.tick, raceTime: player.finishTick ?? race.tick, stamina: player.stamina, position: rallyOrder(race).findIndex(r => r.id === 'player') + 1,
        progress: Math.max(0, player.distance / track.length), used: player.techniqueUsed, techniqueActive: player.techniqueTicks > 0,
        section: player.finishTick !== null ? 'Finish' : section.name, terrain: section.terrain, finished: race.finished,
        playerFinished: player.finishTick !== null, speed: player.speed, charge: player.attackCharge ?? 0,
        attackBlocked: player.stagger > 0 || player.recoilTicks > 0,
        bursting: player.burst && player.stamina > 0 && !player.stagger,
        status: race.finished ? 'Race complete' : player.finishTick !== null ? 'Across the line · waiting for rivals' : player.stagger > 0 ? 'Obstacle hit · recovering'
            : player.slowTicks > 0 ? 'Elemental hit · slowed' : player.recoilTicks > 0 ? 'Shot fired · brief slowdown'
                : player.shortcutTicks > 0 ? 'Shortcut boost' : player.techniqueTicks > 0 ? RALLY_TECHNIQUES[player.pet.element].name
                    : player.burst && player.stamina > 0 ? 'Burst · +28% pace' : 'Release Burst to recover stamina' };
}
type Props = {
    initial: RallyState; difficulty: number; official: boolean; title: string;
    onBegin?: () => Promise<void>;
    onCheckpoint?: (fromTick: number, toTick: number, actions: RallyAction[]) => Promise<RallyResponse>;
    onExit: () => void; onFinished: (state: RallyState) => void;
    /** Called once the finish presentation has played (or cannot play). */
    onFinishPresented?: () => void;
    reputation?: number;
};
export function RallyRace({ initial, difficulty, official, title, onBegin, onCheckpoint, onExit, onFinished, onFinishPresented, reputation = 0 }: Props) {
    const [initialState] = useState(() => restoreRallyRace(initial));
    const state = useRef(initialState);
    const [hud, setHud] = useState(() => raceHud(initialState));
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
    const finishTime = useRef(0);
    const [finishSettled, setFinishSettled] = useState(false);
    const saveRef = useRef(onCheckpoint);
    const onFinishedRef = useRef(onFinished);
    const onPresentedRef = useRef(onFinishPresented);
    useLayoutEffect(() => { saveRef.current = onCheckpoint; onFinishedRef.current = onFinished; onPresentedRef.current = onFinishPresented; });
    const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const track = rallyTrack(initial.trackId);
    const prestige = festivalPrestige('rally', reputation);
    useLayoutEffect(() => { running.current = started && !paused && !error && !modelError && !state.current.finished && (!official || state.current.tick - acknowledged.current < 600); });
    const onReady = useCallback((id: string) => setReady(old => old.includes(id) ? old : [...old, id]), []);
    const onFail = useCallback(() => { setModelError(true); running.current = false; }, []);
    const input = useCallback((kind: RallyAction['kind']) => {
        // Releases must survive a pause or a checkpoint stall.
        if ((running.current || kind === 'burst-off') && !queued.current.includes(kind) && queued.current.length < 7) queued.current.push(kind);
    }, []);
    const advance = useCallback((delta: number) => {
        if (state.current.finished && finishTime.current < FINISH_SETTLE_SECONDS) {
            finishTime.current += Math.min(delta, .05);
            if (finishTime.current >= FINISH_SETTLE_SECONDS) setFinishSettled(true);
        }
        if (!running.current) { accumulator.current = 0; return; }
        accumulator.current += delta;
        while (accumulator.current >= 1 / RALLY_HZ && !state.current.finished) {
            const race = state.current;
            if (official && race.tick - acknowledged.current >= 600) { running.current = false; break; }
            const actions = queued.current.splice(0).map(kind => ({ tick: race.tick, kind }));
            if (official) inputs.current.push(...actions);
            const player = race.racers[0];
            const hit = player.hits, jump = player.jump, used = player.techniqueUsed, fired = player.shotsFired, landed = player.shotsHit, slowed = player.slowTicks;
            const finishedAt = player.finishTick, distance = player.distance, cleanJumps = player.cleanJumps, shortcuts = player.shortcuts;
            stepRally(race, actions, difficulty);
            if (player.hits > hit) playPetSfx('hit');
            if (player.jump > 0 && jump === 0) playPetSfx('move');
            if (player.techniqueUsed && !used) playPetSfx('finisher');
            if (player.shotsFired > fired) playPetSfx('command');
            if (player.shotsHit > landed || player.slowTicks > slowed) playPetSfx('hit');
            if (player.cleanJumps > cleanJumps || player.shortcuts > shortcuts) playPetSfx('command');
            if (distance < track.length - 140 && player.distance >= track.length - 140) playPetSfx('crowd');
            if (finishedAt === null && player.finishTick !== null) playPetSfx('crowd');
            accumulator.current -= 1 / RALLY_HZ;
            if (race.tick % 6 === 0 || race.finished || player.techniqueUsed !== used || player.finishTick !== finishedAt) {
                setHud(raceHud(race));
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
                : restoreRallyRace(saved);
            setHud(raceHud(state.current));
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
        if (!official || !started || error || saving || hud.finished && completed.current) return;
        const timer = window.setInterval(() => void checkpoint(paused), 300);
        return () => window.clearInterval(timer);
    }, [checkpoint, paused, error, official, started, hud.finished, saving]);
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
        if (finishSettled || hud.finished && modelError) onPresentedRef.current?.();
    }, [finishSettled, hud.finished, modelError]);
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
            <PetModelBoundary onFail={onFail}><Suspense fallback={<div className="sunscar-loading" role="status">Preparing the course…</div>}><RallyCanvas state={state} advance={advance} onReady={onReady} onFail={onFail} reducedMotion={reducedMotion}
                frameloop={paused || finishSettled || modelError || !!error || !started && countdown === null && ready.length >= 4 ? 'demand' : 'always'} /></Suspense></PetModelBoundary>
            <div className="rally-hud">
                {prestige && <span className="rally-prestige-pennant" title={prestige.cosmetic} style={{ color: prestige.color }}>✥</span>}
                <div className="rally-position"><strong>{hud.position}<small>/4</small></strong><span>{hud.section || title}</span></div>
                <div className={`rally-progress${hud.finalStretch ? ' is-final-stretch' : ''}`}><span>{hud.finalStretch ? 'Final stretch' : track.name} · {hud.remaining} m</span><progress aria-label="Race progress" value={hud.progress} max={1} /><small>{(hud.raceTime / RALLY_HZ).toFixed(1)}s {saving ? '· Saving' : official ? '· Official' : '· Practice'}{hud.terrain === 'deep-sand' && !hud.finished ? ' · Deep sand slows' : ''}</small></div>
                <button className="rally-pause" aria-label={paused ? 'Resume race' : 'Pause race'} onClick={() => { running.current = false; queued.current = ['burst-off']; setPaused(p => !p); }} disabled={!started || hud.finished}>{paused ? 'Resume' : 'Pause'}</button>
            </div>
            {started && !hud.playerFinished && <div className="rally-race-hints">
                {hud.roadHint && <span className="rally-road-hint">{hud.roadHint}</span>}
                {hud.charge >= 100 && !hud.attackBlocked && <span className={`rally-aim-hint${hud.targetId ? ' has-target' : ''}`}>Q · {hud.targetLabel}</span>}
                <span className={`rally-event rally-event-${hud.eventKind}`} role="status" aria-live="polite">{hud.message}</span>
            </div>}
            {started && hud.playerFinished && <div className="rally-finish-banner" role="status"><span>Across the line</span><strong>{['1st', '2nd', '3rd', '4th'][hud.position - 1]} · {(hud.raceTime / RALLY_HZ).toFixed(2)}s</strong><small>{hud.finished ? 'Finish board ready' : 'Rivals are finishing'}</small></div>}
            {!started && countdown === null && <div className="rally-intro-overlay"><p className="sunscar-eyebrow">{title}</p><h2>{track.name}</h2><p>{track.description}</p><p className="rally-learn">Amber arrows: jump low barriers (+4 Burst). Coral crosses: steer around tall loads. Green arrows: Burst + jump into a shortcut (+7 Burst). Hold Shift for +28% pace. E uses {RALLY_TECHNIQUES[initial.racers[0].pet.element].name} once per race.</p><p className="rally-learn">Q fires a shot every 8 seconds. {RALLY_SHOT_PROFILES[initial.racers[0].pet.element].description} Look for the aiming ring. Firing slows you 10% for 0.45 seconds. Jump or steer to dodge.</p>
                {modelError ? <p role="alert">A pet model could not load. Return to the race desk and retry; your entry is safe.</p> : <p role="status">{ready.length < 4 ? `Preparing companions · ${ready.length}/4` : 'All companions ready'}</p>}
                <div className="sunscar-button-row"><button onClick={() => void begin()} disabled={ready.length < 4 || modelError || saving}>{saving ? 'Starting…' : initial.tick > 0 ? 'Resume from checkpoint' : 'Ready to race'}</button><button className="sunscar-secondary" onClick={onExit}>Race desk</button></div>
            </div>}
            {countdown !== null && <div className="rally-countdown" role="status" aria-live="assertive">{countdown || 'GO'}</div>}
            {(paused || error || started && modelError) && <div className="rally-pause-overlay"><h2>{error ? 'Race held safely' : modelError ? 'Rendering interrupted' : 'Taking a breather'}</h2><p role={error ? 'alert' : undefined}>{error || 'Your race clock is paused. Continue when you are ready.'}</p><div className="sunscar-button-row">
                <button onClick={() => { if (error && started) void checkpoint(true); else if (error) { setError(''); void begin(); } else setPaused(false); }} disabled={saving || modelError}>{saving ? 'Saving…' : error ? 'Retry connection' : 'Continue race'}</button>
                <button className="sunscar-secondary" disabled={saving} onClick={() => void leave()}>Save & return</button>{error && <button className="sunscar-secondary" onClick={onExit}>Return to last saved checkpoint</button>}</div>{error && <small>Returning to the saved checkpoint discards only inputs the race desk has not confirmed.</small>}</div>}
            <div className="rally-telemetry"><span className="rally-speed">{hud.playerFinished ? 'Finished' : `${(hud.speed * 3.6).toFixed(0)} km/h`}</span><span>{hud.status}</span></div>
            <div className={`rally-stamina${hud.bursting ? ' is-active' : ''}`}><span>Burst</span><meter min={0} max={100} value={hud.stamina} aria-label="Burst stamina" /><span>{Math.ceil(hud.stamina)}%</span></div>
        </div>
        <RallyControls input={input} disabled={!started || paused || !!error || modelError || hud.playerFinished} technique={RALLY_TECHNIQUES[initial.racers[0].pet.element].name} techniqueUsed={hud.used} techniqueActive={hud.techniqueActive} stamina={hud.stamina}
            bursting={hud.bursting} attack={RALLY_ATTACK_NAMES[initial.racers[0].pet.element]} attackDescription={RALLY_SHOT_PROFILES[initial.racers[0].pet.element].description} charge={hud.charge} attackBlocked={hud.attackBlocked} />
        <p className="rally-save-note">{official ? 'Official checkpoints save during the race. Backgrounding pauses the clock.' : 'Practice is unlimited. No entry or reward is consumed.'}</p>
    </section>;
}
