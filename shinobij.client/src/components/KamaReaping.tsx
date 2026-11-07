import { useEffect, useRef, useState } from 'react';
import type { ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { KAMA_FIELD_ASPECT, KAMA_LIMIT_MS, KAMA_READY_MS, KAMA_SETTLE_MS, KAMA_STROKE_GAP_MS, KAMA_STROKES, kamaDemoStrokes, kamaField, kamaGuideStroke, kamaGuideY,
    kamaGustStrength, kamaSeed, kamaStalkXAt, scoreKamaReaping, type KamaStroke } from '../../../shared/kama-reaping';
import { GATHER_NAMES } from '../../../shared/gathering-materials';
import { createKunaiElapsedClock } from '../lib/kunai-fishing-clock';
import { playGameSfx, primeGameAudio } from '../lib/game-audio';
import { drawKamaReaping, type KamaArt, type KamaTrail } from './kama-reaping-renderer';
import './kama-reaping.css';

/** gather-field-herb -> /assets/harvesting/plant-field-herb-v1.webp */
const plantArt = (id: string) => `/assets/harvesting/plant-${id.slice(7)}-v1.webp`;
/** A drag shorter than this (height units) is a tap that picks a stalk instead. */
const MIN_SWIPE = 6;
const clampField = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;

/** Kama Reaping (docs/harvesting-minigame-plan.md §3). Strokes are scored by the
 * shared module on both sides; the server re-scores them from the sealed seed. */
export default function KamaReaping({ attempt, busy, resolve }: {
    attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void;
}) {
    const seed = kamaSeed(attempt), relaxed = attempt.mode === 'relaxed';
    const family = attempt.harvest?.family ?? 'gather-field-herb', trace = attempt.harvest?.trace;
    const key = `outpost-kama:${attempt.id}`;
    const [field] = useState(() => kamaField(seed));
    const [demo] = useState(() => kamaDemoStrokes(field));
    const [readElapsed] = useState(() => createKunaiElapsedClock(attempt.startedAt));
    const [strokes, setStrokes] = useState<KamaStroke[]>(() => {
        try {
            const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
            return scoreKamaReaping(seed, saved, Number.POSITIVE_INFINITY, true) ? saved as KamaStroke[] : [];
        } catch { return []; }
    });
    const [elapsed, setElapsed] = useState(readElapsed);
    const [selected, setSelected] = useState(2);
    const canvas = useRef<HTMLCanvasElement>(null), drag = useRef<{ id: number; x: number; y: number } | null>(null);
    const trail = useRef<KamaTrail | null>(null), inputRef = useRef(strokes), selectedRef = useRef(selected);
    const resolveRef = useRef(resolve), submitted = useRef(false);
    useEffect(() => { resolveRef.current = resolve; }, [resolve]);
    useEffect(() => { inputRef.current = strokes; }, [strokes]);
    useEffect(() => { selectedRef.current = selected; }, [selected]);
    const release = () => { drag.current = null; trail.current = null; };

    const shown = relaxed ? demo.filter(stroke => stroke.at <= elapsed) : strokes;
    const live = scoreKamaReaping(seed, shown, elapsed, true)!;
    const timeUp = elapsed >= KAMA_READY_MS + KAMA_LIMIT_MS;
    const lastAt = strokes.at(-1)?.at ?? -Infinity;
    // `over` ends play; `done` submits. A finished row waits for the cut tops to
    // fall first, which also gives the server's clock time to pass the last
    // stroke (the client clock is only an estimate of server time).
    const over = relaxed ? elapsed >= 3000 : live.finished || timeUp;
    const done = relaxed ? over : timeUp || (live.finished && elapsed - lastAt >= KAMA_SETTLE_MS);
    const canStrike = !relaxed && !over && !busy && elapsed >= KAMA_READY_MS && strokes.length < KAMA_STROKES;
    // Keep the chosen stalk on one that still stands.
    const standing = live.stalks.map((stalk, index) => stalk.cut ? -1 : index).filter(index => index >= 0);
    const target = standing.includes(selected) ? selected : standing[0] ?? selected;

    useEffect(() => {
        if (done) return;
        const timer = window.setInterval(() => setElapsed(readElapsed()), 50);
        return () => clearInterval(timer);
    }, [readElapsed, done]);
    useEffect(() => {
        if (!done || submitted.current) return;
        submitted.current = true;
        resolveRef.current(relaxed ? {} : { events: inputRef.current });
    }, [done, relaxed]);
    useEffect(() => { if (!relaxed) canvas.current?.focus(); }, [relaxed]);

    useEffect(() => {
        const element = canvas.current, ctx = element?.getContext('2d');
        if (!element || !ctx) return;
        const load = (src: string) => { const image = new Image(); image.src = src; return image; };
        const art: KamaArt = { backdrop: load('/assets/harvesting/kama-meadow.webp'), plant: load(plantArt(family)),
            ...(trace ? { trace: load(plantArt(trace)) } : {}) };
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0, width = 0, height = 0;
        const observer = new ResizeObserver(() => {
            const box = element.getBoundingClientRect(); width = box.width; height = box.height;
            const dpr = Math.min(2, devicePixelRatio || 1);
            element.width = Math.round(width * dpr); element.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        });
        observer.observe(element);
        function paint() {
            const at = Math.min(readElapsed(), KAMA_READY_MS + KAMA_LIMIT_MS);
            const current = relaxed ? demo.filter(stroke => stroke.at <= at) : inputRef.current;
            const state = scoreKamaReaping(seed, current, at, true)!;
            const guide = relaxed || state.finished ? null : { y: kamaGuideY(at), stalk: selectedRef.current };
            if (width && height) drawKamaReaping(ctx!, width, height, art, {
                field, at, strokes: current, stalks: state.stalks, trail: trail.current, guide, reduced: motion.matches,
                // Above level 1 in a forest or shadow meadow, the middle stalk shows the rare plant.
                traceStalk: trace ? 2 : undefined,
            });
            if (!document.hidden) frame = requestAnimationFrame(paint);
        }
        function visible() { cancelAnimationFrame(frame); if (!document.hidden) paint(); release(); }
        document.addEventListener('visibilitychange', visible); window.addEventListener('blur', release); paint();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('blur', release); };
    }, [readElapsed, seed, field, demo, relaxed, family, trace]);

    function point(clientX: number, clientY: number) {
        const box = canvas.current!.getBoundingClientRect();
        return { x: clampField((clientX - box.left) / box.width * 100), y: clampField((clientY - box.top) / box.height * 100) };
    }
    function strike(stroke: Omit<KamaStroke, 'kind' | 'at'> | null) {
        const at = Math.floor(readElapsed()), current = inputRef.current;
        if (!canStrike || at < KAMA_READY_MS || at > KAMA_READY_MS + KAMA_LIMIT_MS || at - (current.at(-1)?.at ?? -Infinity) < KAMA_STROKE_GAP_MS) return;
        const next: KamaStroke = stroke ? { kind: 'stroke', at, ...stroke } : kamaGuideStroke(field, target, at);
        const updated = [...current, next];
        if (!scoreKamaReaping(seed, updated, Number.POSITIVE_INFINITY, true)) return;
        inputRef.current = updated; setElapsed(at); setStrokes(updated);
        try { sessionStorage.setItem(key, JSON.stringify(updated)); } catch { /* memory only */ }
        primeGameAudio(['evade', 'impact-light']); playGameSfx('evade', { gain: .7, playbackRate: 1.5, channel: 'harvesting' });
        const after = scoreKamaReaping(seed, updated, Number.POSITIVE_INFINITY, true)!;
        if (after.stalks.some((stalk, index) => stalk.cut && !live.stalks[index]?.cut)) playGameSfx('impact-light', { gain: .4, playbackRate: 1.4, channel: 'harvesting' });
    }
    /** The stalk nearest a tap, judged where it stands at the tap's height. */
    function nearestStalk(x: number, y: number) {
        const at = readElapsed();
        return standing.reduce((best, index) => Math.abs(kamaStalkXAt(field, index, at, y) - x) < Math.abs(kamaStalkXAt(field, best, at, y) - x) ? index : best, standing[0] ?? target);
    }
    function moveSelection(step: number) {
        if (!standing.length) return;
        const position = standing.indexOf(target);
        setSelected(standing[(position + step + standing.length) % standing.length]);
    }

    const gustSoon = kamaGustStrength(field, elapsed + 500) > .25 || kamaGustStrength(field, elapsed) > .25;
    const plantName = GATHER_NAMES[family] ?? 'meadow plants';
    const message = relaxed ? 'Watch the kama work the row at the calm between gusts.'
        : over ? live.failed ? live.tally.tear >= 2 ? 'Torn roots spoil the harvest. Your attempt is being recorded.' : 'Nothing was cut cleanly. Your attempt is being recorded.'
            : 'The row is reaped. Gathering your harvest…'
        : elapsed < KAMA_READY_MS ? 'Steady your grip…'
        : gustSoon ? 'A gust is coming. Wait for the calm before you cut.'
        : strokes.length ? 'Good. Cut again in the calm, at the gold band.' : `Swipe through the gold band to reap the ${plantName.toLowerCase()}. One stroke can take several stalks.`;
    return <div className="kama-game" data-done={done || undefined}>
        <div className="gather-game-heading"><div><p className="resource-kicker">Harvesting · Kama reaping</p>
            <h3>{relaxed ? 'Field technique' : over ? live.failed ? 'The harvest is spoiled' : 'Row reaped' : 'Read the wind'}</h3></div>
            <span className="gather-game-method">{relaxed ? 'Watch animation' : 'Wait · Aim · Reap'}</span></div>
        <div className="kama-field">
            <canvas ref={canvas} tabIndex={relaxed ? -1 : 0} role="application" aria-label={`Kama reaping field of ${plantName}`} aria-describedby="kama-help kama-stalks"
                onPointerDown={event => {
                    if (!canStrike || !event.isPrimary || event.button !== 0) return;
                    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
                    const start = point(event.clientX, event.clientY);
                    drag.current = { id: event.pointerId, ...start }; trail.current = { x1: start.x, y1: start.y, x2: start.x, y2: start.y };
                }}
                onPointerMove={event => {
                    if (drag.current?.id !== event.pointerId) return;
                    const end = point(event.clientX, event.clientY);
                    trail.current = { x1: drag.current.x, y1: drag.current.y, x2: end.x, y2: end.y };
                }}
                onPointerUp={event => {
                    const start = drag.current;
                    if (start?.id !== event.pointerId) return;
                    release();
                    const end = point(event.clientX, event.clientY);
                    if (Math.hypot((end.x - start.x) * KAMA_FIELD_ASPECT, end.y - start.y) >= MIN_SWIPE) strike({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
                    else setSelected(nearestStalk(end.x, end.y));
                }}
                onPointerCancel={release} onLostPointerCapture={release}
                onKeyDown={event => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveSelection(event.key === 'ArrowLeft' ? -1 : 1); }
                    else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); strike(null); }
                }} />
            {!relaxed && <div className="kama-strokes" aria-label={`${KAMA_STROKES - strokes.length} of ${KAMA_STROKES} kama strokes remaining`}>
                <span>Strokes</span>{Array.from({ length: KAMA_STROKES }, (_, n) => <i key={n} className={n < KAMA_STROKES - strokes.length ? 'ready' : ''} aria-hidden="true">◆</i>)}
                <time>{Math.max(0, Math.ceil((KAMA_READY_MS + KAMA_LIMIT_MS - elapsed) / 1000))}s</time></div>}
            {gustSoon && !over && <div className="kama-gust" aria-hidden="true">Gust</div>}
        </div>
        <p className="kama-status" role="status">{message}</p>
        <p className="kama-help" id="kama-help">{relaxed ? 'Animation mode uses your skill’s baseline success rate.'
            : 'Swipe across the stalks · or tap a stalk and press Reap when the dashed line crosses its band · Arrows + Space'}</p>
        <span className="kama-sr-only" id="kama-stalks">{`Stalk ${standing.indexOf(target) + 1} of ${standing.length} standing is selected.`}</span>
        {!relaxed && !over && <button type="button" className="resource-primary" disabled={!canStrike || elapsed - lastAt < KAMA_STROKE_GAP_MS} onClick={() => strike(null)}>Reap at the line</button>}
        {done && <button type="button" autoFocus className="resource-primary" disabled={busy} onClick={() => resolve(relaxed ? {} : { events: inputRef.current })}>{busy ? 'Recording result…' : 'Recover result'}</button>}
    </div>;
}
