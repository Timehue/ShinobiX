import { useEffect, useRef, useState } from 'react';
import type { ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { KUNAI_READY_MS, KUNAI_LIMIT_MS, kunaiFish, kunaiFlightMs, kunaiSeed, kunaiShoal, scoreKunaiFishing, type KunaiThrow } from '../../../shared/kunai-fishing';
import { createKunaiElapsedClock } from '../lib/kunai-fishing-clock';
import { playGameSfx, primeGameAudio } from '../lib/game-audio';
import { drawKunaiFishing, type FishArt, type GearArt } from './kunai-fishing-renderer';
import './kunai-fishing.css';

export default function KunaiFishing({ attempt, busy, resolve, golden = false }: {
    attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void; golden?: boolean;
}) {
    const seed = kunaiSeed(attempt), relaxed = attempt.mode === 'relaxed';
    const skillLevel = attempt.fishingShoal === 'ranked' ? attempt.skillLevel : undefined;
    const shoal = skillLevel != null ? kunaiShoal(skillLevel) : undefined;
    const key = `outpost-kunai:${attempt.id}`;
    const [readElapsed] = useState(() => createKunaiElapsedClock(attempt.startedAt));
    const [shots, setShots] = useState<KunaiThrow[]>(() => {
        try { const input = JSON.parse(sessionStorage.getItem(key) ?? '[]'); return scoreKunaiFishing(seed, input, readElapsed(), true, skillLevel) ? input : []; }
        catch { return []; }
    });
    const [elapsed, setElapsed] = useState(readElapsed);
    const [aim, setAim] = useState({ x: 50, y: 45 });
    const canvas = useRef<HTMLCanvasElement>(null), pointer = useRef<number | null>(null), submitted = useRef(false);
    useEffect(() => { if (!relaxed) canvas.current?.focus(); }, [relaxed]);
    const resolveRef = useRef(resolve), inputRef = useRef(shots), view = useRef({ aim, shots });
    useEffect(() => { resolveRef.current = resolve; }, [resolve]);
    useEffect(() => { view.current = { aim, shots }; inputRef.current = shots; }, [aim, shots]);
    // Animation mode uses the same real throw/haul choreography, with no timing input.
    const [demo] = useState<KunaiThrow[]>(() => {
        const shot: KunaiThrow = { kind: 'throw', at: 850, x: 50, y: 45 };
        for (let n = 0; n < 8; n++) Object.assign(shot, kunaiFish(seed, 0, shot.at + kunaiFlightMs(shot)));
        return [{ kind: 'throw', at: shot.at, x: shot.x, y: shot.y }];
    });
    const visualShots = relaxed && elapsed >= 850 ? demo : shots;
    const state = scoreKunaiFishing(seed, visualShots, elapsed, true, skillLevel)!;
    const done = relaxed ? elapsed >= 3000 : state.done;
    const ready = !relaxed && !done && !busy && state.phase === 'aiming' && elapsed >= KUNAI_READY_MS && elapsed <= KUNAI_LIMIT_MS - 1000;
    useEffect(() => {
        if (done) return;
        const timer = window.setInterval(() => setElapsed(readElapsed()), 40);
        return () => clearInterval(timer);
    }, [readElapsed, done]);
    useEffect(() => {
        if (!done || submitted.current) return;
        submitted.current = true;
        resolveRef.current(relaxed ? {} : { events: inputRef.current });
    }, [done, relaxed]);
    useEffect(() => {
        const element = canvas.current, ctx = element?.getContext('2d');
        if (!element || !ctx) return;
        const image = new Image(); image.src = '/assets/fishing/kunai-river-pool.webp';
        const fishArt: FishArt[] = ['silver-v2', 'bronze-v2', 'trout-v2', 'sturgeon-v3'].map(name => {
            const sprite = new Image(), item: FishArt = { image: sprite };
            sprite.onload = () => {
                const shadow = document.createElement('canvas'); shadow.width = sprite.naturalWidth; shadow.height = sprite.naturalHeight;
                const context = shadow.getContext('2d');
                if (context) { context.filter = 'blur(9px)'; context.drawImage(sprite, 0, 0); context.filter = 'none'; context.globalCompositeOperation = 'source-in'; context.fillStyle = '#06333c'; context.fillRect(0, 0, shadow.width, shadow.height); item.shadow = shadow; }
            };
            sprite.src = `/assets/fishing/river-fish-${name}.webp`;
            return item;
        });
        const load = (name: string) => { const sprite = new Image(); sprite.src = `/assets/fishing/${name}-v3.webp`; return sprite; };
        const gear: GearArt = { hands: ['hand-left', 'hand-grip', 'hand-release'].map(load), kunai: ['kunai-steel', 'kunai-gold'].map(load) };
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0, width = 0, height = 0;
        const observer = new ResizeObserver(() => { const box = element.getBoundingClientRect(); width = box.width; height = box.height; const dpr = Math.min(2, devicePixelRatio || 1); element.width = Math.round(width * dpr); element.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); });
        observer.observe(element);
        function paint() {
            const at = readElapsed();
            const currentShots = relaxed && at >= 850 ? demo : view.current.shots;
            if (width && height) drawKunaiFishing(ctx!, width, height, image, seed, Math.min(at, relaxed ? 3000 : scoreKunaiFishing(seed, currentShots, at, true, skillLevel)!.endAt), currentShots, view.current.aim, golden, motion.matches, fishArt, skillLevel, gear);
            if (!document.hidden) frame = requestAnimationFrame(paint);
        }
        function visible() { cancelAnimationFrame(frame); if (!document.hidden) paint(); pointer.current = null; }
        const cancelAim = () => { pointer.current = null; };
        document.addEventListener('visibilitychange', visible); window.addEventListener('blur', cancelAim); paint();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); for (const item of fishArt) item.image.onload = null; document.removeEventListener('visibilitychange', visible); window.removeEventListener('blur', cancelAim); };
    }, [readElapsed, seed, golden, relaxed, demo, skillLevel]);
    const lastPhase = useRef('aiming');
    useEffect(() => {
        if (lastPhase.current !== state.phase) {
            if (state.phase === 'hauling' || state.phase === 'returning' || state.phase === 'resisting') playGameSfx('impact-light', { gain: .45, playbackRate: .8, channel: 'fishing' });
            if (state.phase === 'landed') playGameSfx('victory-seal', { gain: .55, channel: 'fishing' });
            if (state.phase === 'outmatched') playGameSfx('chakra-negative', { gain: .5, channel: 'fishing' });
            lastPhase.current = state.phase;
        }
    }, [state.phase]);
    function target(x: number, y: number) {
        const box = canvas.current!.getBoundingClientRect();
        return { x: Math.max(6, Math.min(94, (x - box.left) / box.width * 100)), y: Math.max(12, Math.min(78, (y - box.top) / box.height * 100)) };
    }
    function fire(point = aim) {
        if (relaxed || busy) return;
        const at = Math.floor(readElapsed()), current = inputRef.current;
        const live = scoreKunaiFishing(seed, current, at, true, skillLevel);
        if (!live || live.done || live.phase !== 'aiming' || at < live.availableAt || at > KUNAI_LIMIT_MS - 1000) return;
        const next = [...current, { kind: 'throw' as const, at, x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }];
        inputRef.current = next; view.current.shots = next; setElapsed(at); setShots(next);
        try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ }
        primeGameAudio(['evade', 'impact-light', 'victory-seal']); playGameSfx('evade', { gain: .8, playbackRate: 1.3, channel: 'fishing' });
    }
    const message = relaxed ? 'Watch the blade fly, the tether catch, and the fish come ashore.'
        : state.phase === 'flight' ? 'Kunai away — lead the fish, not its shadow.'
        : state.phase === 'resisting' || state.phase === 'outmatched' ? `${state.catchInfo!.name} needs Fishing Lv.${state.catchInfo!.requiredLevel}. You are Lv.${skillLevel} — it is breaking free!`
        : state.phase === 'hauling' || state.phase === 'landed' ? 'Clean strike. Drawing the catch ashore…'
        : state.phase === 'returning' ? 'Missed. The shoal scattered — watch where it settles.'
        : state.phase === 'escaped' ? 'The shoal slipped away. Your attempt is being recorded.'
        : shoal?.some(fish => fish.level > skillLevel!) ? 'Higher-level fish end your attempt. Aim for an unlocked fish.'
        : shots.length ? 'Another opening. Aim ahead of a swimming fish.' : 'Aim ahead of a fish. Release to throw your tethered kunai.';
    return <div className="kunai-game" data-phase={state.phase}>
        <div className="gather-game-heading"><div><p className="resource-kicker">Fishing · Kunai & tether</p><h3>{relaxed ? 'River technique' : state.blocked && state.phase !== 'flight' ? 'Too strong' : state.hit !== -1 && state.phase !== 'flight' ? 'On the line' : 'Read the shoal'}</h3></div><span className="gather-game-method">{relaxed ? 'Watch animation' : skillLevel != null ? `Fishing Lv.${skillLevel}` : 'Lead · Throw · Retrieve'}</span></div>
        <div className="kunai-pond">
            <canvas ref={canvas} tabIndex={relaxed ? -1 : 0} role="application" aria-label="Kunai fishing pool" aria-describedby="kunai-help kunai-species" autoFocus={!relaxed}
                onPointerDown={event => { if (!ready || !event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId; setAim(target(event.clientX, event.clientY)); }}
                onPointerMove={event => { if (ready && (event.pointerType === 'mouse' || pointer.current === event.pointerId)) setAim(target(event.clientX, event.clientY)); }}
                onPointerUp={event => { if (pointer.current !== event.pointerId) return; pointer.current = null; const point = target(event.clientX, event.clientY); setAim(point); fire(point); }}
                onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }} onBlur={() => { pointer.current = null; }}
                onKeyDown={event => { const delta = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[event.key]; if (delta) { event.preventDefault(); setAim(p => ({ x: Math.max(6, Math.min(94, p.x + delta[0])), y: Math.max(12, Math.min(78, p.y + delta[1])) })); } else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); fire(); } }} />
            <div className="kunai-water-label" aria-hidden="true"><span>Dockside technique</span><strong>静 · Still hand. Swift blade.</strong></div>
            {!relaxed && <div className="kunai-shots" aria-label={`${state.remaining} of 3 kunai throws remaining`}><span>Throws</span>{[0, 1, 2].map(n => <i key={n} className={n < state.remaining ? 'ready' : ''} aria-hidden="true">◆</i>)}<time>{Math.max(0, Math.ceil((KUNAI_LIMIT_MS - elapsed) / 1000))}s</time></div>}
        </div>
        <p className="kunai-status" role="status">{message}</p>
        <p className="kunai-help" id="kunai-help">{relaxed ? 'Animation mode uses your skill’s baseline success rate.' : <>{skillLevel != null && <>You: Fishing Lv.{skillLevel} · Locked fish fail the attempt<br /></>}Drag to aim · Release · Arrows + Space</>}</p>
        <span className="kunai-sr-only" id="kunai-species">{shoal?.map(fish => `${fish.name}, requires Fishing level ${fish.level}, ${fish.level > skillLevel! ? 'too strong' : 'catchable'}.`).join(' ')}</span>
        {!relaxed && !done && <button type="button" className="resource-primary" disabled={!ready} onClick={() => fire()}>{state.phase === 'flight' ? 'Blade in flight…' : state.phase === 'hauling' ? 'Retrieving catch…' : state.phase === 'resisting' ? 'Fish breaking free…' : state.phase === 'returning' ? 'Retrieving kunai…' : 'Throw kunai'}</button>}
        {done && <button type="button" autoFocus className="resource-primary" disabled={busy} onClick={() => resolve(relaxed ? {} : { events: inputRef.current })}>{busy ? 'Recording result…' : 'Recover result'}</button>}
    </div>;
}
