import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { FRACTURE_TEMPLATES, solveFractureChain } from '../../../shared/fracture-chain';
import { scoreFishing, FISHING_REEL_MS, type FishingEvent } from '../../../shared/fishing-game';
import { serverNow } from '../lib/server-clock';
import { resourceNode } from '../../../shared/resource-nodes';
import water from '../assets/sectors/water.webp';
import stoneTexture from '../assets/warfront/cliff-rock.jpg';
import './resource-minigames.css';

export function ResourceMinigame({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    if (attempt.mode === 'relaxed') return <RelaxedGathering attempt={attempt} busy={busy} resolve={resolve} />;
    return attempt.activity === 'mining' ? <FractureChain attempt={attempt} busy={busy} resolve={resolve} /> : <CastAndReel attempt={attempt} busy={busy} resolve={resolve} />;
}
function RelaxedGathering({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    const [ready, setReady] = useState(false);
    useEffect(() => { const timer = window.setTimeout(() => setReady(true), Math.max(0, attempt.startedAt + 3000 - serverNow())); return () => clearTimeout(timer); }, [attempt.startedAt]);
    return <div className={`resource-relaxed resource-relaxed--${attempt.activity}`}>
        <div className="resource-relaxed-art" aria-hidden="true" style={{ backgroundImage: `url(${attempt.activity === 'mining' ? stoneTexture : water})` }}><img src={`/items/${attempt.activity === 'mining' ? 'tool-golden-pickaxe' : 'tool-golden-fishing-pole'}.svg`} alt="" /></div>
        <p>{attempt.activity === 'mining' ? 'Chakra follows the seam. The stone begins to separate.' : 'Your line settles into the current. A shadow approaches the float.'}</p>
        <p>Animation mode uses your skill’s baseline success rate.</p>
        <button type="button" disabled={busy || !ready} onClick={() => resolve({})}>{busy ? 'Recovering result…' : ready ? 'Collect result' : 'Gathering…'}</button>
    </div>;
}
function FractureChain({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    const formation = FRACTURE_TEMPLATES[attempt.template];
    const mineral = resourceNode(attempt.nodeId)?.trace;
    const stone = mineral === 'gather-rime-crystal' ? 'frozen' : mineral === 'gather-ember-ore' ? 'volcanic' : mineral === 'gather-stormglass-shard' ? 'crystal' : 'iron';
    const [placements, setPlacements] = useState<number[]>([]), [detonated, setDetonated] = useState(false), [wave, setWave] = useState(0);
    const timer = useRef<number[]>([]);
    useEffect(() => () => timer.current.forEach(clearTimeout), []);
    const solved = solveFractureChain(attempt.template, placements);
    const exposed = detonated ? new Set(solved?.waves.slice(0, wave).flat()) : new Set<number>();
    function detonate() {
        if (!solved || detonated || busy) return;
        setDetonated(true);
        placements.forEach((_, i) => timer.current.push(window.setTimeout(() => setWave(i + 1), (i + 1) * 650)));
        timer.current.push(window.setTimeout(() => resolve({ placements }), Math.max(2500, attempt.startedAt + 2800 - serverNow())));
    }
    return <div className="fracture-game">
        <div className="gather-game-heading"><div><p className="resource-kicker">Mining · {formation.name}</p><h3>Fracture Chain</h3></div><span className="gather-game-method">Chakra extraction</span></div>
        <div className="fracture-workspace">
        <div className={`fracture-board fracture-board--${stone}${detonated ? ' detonated' : ''}${detonated && solved?.destroyed && wave === formation.charges ? ' shattered' : ''}`}>
            <span className="fracture-surface-label" aria-hidden="true">Ore-bearing face</span>
            <svg viewBox="0 0 100 100" aria-hidden="true"><defs><clipPath id="ore-silhouette"><path d="M15 6 67 2 89 17 98 43 94 76 75 98 28 94 3 68 5 31Z"/></clipPath><radialGradient id="ore-light"><stop stopColor="#11121a" stopOpacity="0"/><stop offset="1" stopColor="#080b10" stopOpacity=".8"/></radialGradient><linearGradient id="ore-metal" x2=".7" y2="1"><stop stopColor="#f4deaf"/><stop offset=".35" stopColor="#b09261"/><stop offset=".7" stopColor="#4e4133"/><stop offset="1" stopColor="#b79b6b"/></linearGradient></defs>
                <g clipPath="url(#ore-silhouette)"><image className="fracture-texture" href={stoneTexture} width="100" height="100" preserveAspectRatio="xMidYMid slice"/><path d="M0 0H100V100H0Z" fill="url(#ore-light)"/><path className="fracture-mineral" d="M18 12 28 25 23 36 34 43 28 55 35 71 29 88 M73 10 65 23 77 33 72 42 81 58 70 74 78 87 M37 20 48 28 59 21 M37 83 49 76 58 85"/></g>
                {formation.faults.map((fault, face) => <path key={`shell-${face}`} className={`fracture-shell${exposed.has(face) ? ' loosened' : ''}`}
                    style={{ transformOrigin: `${fault.x}px ${fault.y}px`, '--shear-x': `${(fault.x - 50) * .5}px`, '--shear-y': `${(fault.y - 50) * .5}px` } as CSSProperties}
                    d={`M${fault.x} ${fault.y} l-8 -5 5 -7 10 3 3 10 -7 5Z`} />)}
                {formation.sites.map((site, index) => <path key={site.label} pathLength="1" d={[site, ...site.path.map(face => formation.faults[face])].map((point, i, points) => i ? `L${(points[i - 1].x + point.x) / 2 + (index % 2 ? 1.5 : -1.5)} ${(points[i - 1].y + point.y) / 2 - 2} ${point.x} ${point.y}` : `M${point.x} ${point.y}`).join(' ')}
                    className={`fault-line${placements.includes(index) ? ' fault-line--selected' : ''}${detonated && placements.slice(0, wave).includes(index) ? ' fault-line--fired' : ''}`} />)}
                {formation.faults.map((fault, face) => <g key={face} className={exposed.has(face) ? 'core-face exposed' : 'core-face'}><path d={`M${fault.x - 4} ${fault.y - 2} l3 -5 5 3 1 6 -5 3 -5 -3Z`} fill="url(#ore-metal)"/><path d={`M${fault.x - 1} ${fault.y - 7} l1 7 -5 2 M${fault.x} ${fault.y} l5 -4 M${fault.x} ${fault.y} l4 5`} fill="none"/><circle cx={fault.x} cy={fault.y} r="3.5"/><text x={fault.x} y={fault.y + 1.4} textAnchor="middle">{face + 1}</text></g>)}
            </svg>
            {formation.sites.map((site, index) => <button key={site.label} type="button" style={{ left: `${site.x}%`, top: `${site.y}%` }}
                className={`fracture-charge${placements.includes(index) ? ' placed' : ''}`} aria-pressed={placements.includes(index)}
                aria-label={`${site.label}, reaches faces ${site.path.map(face => face + 1).join(', ')}${placements.includes(index) ? `, charge ${placements.indexOf(index) + 1}` : ''}`}
                disabled={detonated || busy || (!placements.includes(index) && placements.length === formation.charges)}
                onClick={() => setPlacements(current => current.includes(index) ? current.filter(i => i !== index) : [...current, index])}>
                <svg viewBox="0 0 40 44" aria-hidden="true"><path className="seal-paper" d="M11 3 31 5 29 41 8 38Z"/><circle cx="20" cy="21" r="10"/><circle cx="20" cy="21" r="6"/><path d="M20 7V13M20 29V35M6 21H12M28 21H34M16 18L23 17 21 25 17 23 24 22"/></svg><span>{placements.includes(index) ? placements.indexOf(index) + 1 : '+'}</span>
            </button>)}
        </div>
        <aside className="fracture-guide"><p className="resource-kicker">Read the stone</p><h4>Expose each face once.</h4><p>Place {formation.charges} chakra seals along the faults. Trace each seam to the numbered ore faces.</p><div className="fracture-face-key" aria-hidden="true">{formation.faults.map((_, face) => <span key={face} className={exposed.has(face) ? 'exposed' : ''}>{face + 1}</span>)}</div><p className="fracture-caution">Overlapping fractures shatter the ore.</p><small>Select a placed seal to move it.</small></aside>
        </div>
        <p className="fracture-readout" role="status">{detonated ? `${wave} / ${formation.charges} charges fired${wave === formation.charges ? solved?.destroyed ? ' · Core shattered' : ` · ${solved?.exposed}/${formation.faces} core faces exposed` : ''}` : `${placements.length} / ${formation.charges} charges placed · Select a placed charge to reposition it`}</p>
        <button type="button" className="resource-primary" disabled={!solved || detonated || busy} onClick={detonate}>{detonated ? 'Cracks propagating…' : 'Detonate chain'}</button>
        {detonated && wave === formation.charges && !busy && <button type="button" onClick={() => resolve({ placements })}>Recover result</button>}
    </div>;
}
function CastAndReel({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    const key = `outpost-fishing:${attempt.id}`;
    const [events, setEvents] = useState<FishingEvent[]>(() => {
        try {
            const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
            if (!Array.isArray(saved) || saved.length > 48 || saved.some(event => !event || !['hook', 'reel', 'release'].includes(event.kind) || !Number.isFinite(event.at))) return [];
            // A reload releases the physical control, while retaining the admitted timeline.
            const restored = saved as FishingEvent[];
            if (restored.at(-1)?.kind === 'reel' && restored.length < 48) restored.push({ kind: 'release', at: Math.max(restored.at(-1)!.at, serverNow() - attempt.startedAt) });
            sessionStorage.setItem(key, JSON.stringify(restored));
            return restored;
        } catch { return []; }
    });
    const [elapsed, setElapsed] = useState(() => Math.max(0, serverNow() - attempt.startedAt));
    const held = useRef(false);
    useEffect(() => { const timer = window.setInterval(() => setElapsed(Math.max(0, serverNow() - attempt.startedAt)), 50); return () => clearInterval(timer); }, [attempt.startedAt]);
    function record(kind: FishingEvent['kind']) {
        const at = Math.max(0, serverNow() - attempt.startedAt);
        setEvents(current => { if (current.length >= 48) return current; const next = [...current, { kind, at }]; try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ } return next; });
    }
    function reel(value: boolean) { if (held.current === value || !events.length || done || (value && events.length >= 47)) return; held.current = value; record(value ? 'reel' : 'release'); }
    const hooked = events.length > 0, hookMissed = !hooked && elapsed > attempt.hookAt + 1200;
    const done = hookMissed || (hooked && elapsed >= events[0].at + FISHING_REEL_MS);
    const live = hooked ? scoreFishing(attempt.hookAt, events, elapsed, true) : null;
    const reeling = !done && events.at(-1)?.kind === 'reel';
    const tension = Math.round(live?.tension ?? 35);
    const phase = done ? '03' : hooked ? '02' : '01';
    return <div className="fishing-game">
        <div className="gather-game-heading"><div><p className="resource-kicker">Fishing · Cast · Hook · Reel</p><h3>{done ? hookMissed || live?.failed ? 'Lost to the current' : 'Within reach' : hooked ? 'Follow the pull' : 'Read the water'}</h3></div><span className="gather-game-method">{phase} / 03</span></div>
        <div className={`fishing-water${elapsed < 900 ? ' casting' : ''}${elapsed >= attempt.hookAt && !hooked && !hookMissed ? ' biting' : ''}${hooked ? ' hooked' : ''}${reeling ? ' reeling' : ''}${done && !hookMissed && !live?.failed ? ' landed' : ''}${done && (hookMissed || live?.failed) ? ' escaped' : ''}`} style={{ '--fishing-scene': `url(${water})` } as CSSProperties} aria-hidden="true">
            <div className="fishing-current"/><span className="fishing-scene-caption">{hooked ? reeling ? 'Drawing the line' : 'Ease the tension' : 'A quiet stretch of water'}</span>
            <svg className="fishing-tackle" viewBox="0 0 100 60" preserveAspectRatio="none">
                <defs><linearGradient id="fishing-bamboo"><stop stopColor="#47321f"/><stop offset=".5" stopColor="#d0b174"/><stop offset="1" stopColor="#725233"/></linearGradient></defs>
                <path className="fishing-rod" d={reeling ? 'M4 60 Q23 21 48 17 Q23 24 6 60Z' : 'M4 60 Q18 29 44 8 Q19 31 6 60Z'} />
                <path className="fishing-grip" d="M5 60 15 43" />
                <path className="fishing-binding" d="M6 56 9 57M8 53 11 54M10 50 13 51M12 47 15 48M22 30 24 31M34 17 36 18"/>
                <ellipse className="fishing-spool" cx="12" cy="53" rx="3" ry="4"/><path className="fishing-binding" d="M12 50V56M10 53H14"/>
                <path className="fishing-cord" d={reeling ? 'M48 17 Q49 32 49 47' : 'M44 8 Q47 30 49 47'} />
                {elapsed < 900 && <path className="fishing-cast-arc" pathLength="1" d="M44 8 Q72 -5 49 47" />}
            </svg>
            <span className="fishing-ripple"/><span className="fishing-float"/><svg className="fishing-shadow" viewBox="0 0 80 30"><g transform={done && (hookMissed || live?.failed) ? undefined : 'translate(80 0) scale(-1 1)'}><path d="M15 15C27 0 49 1 65 15 49 29 27 30 15 15L2 5 5 15 2 25Z"/><path d="M32 8 38 1 46 8M31 22 37 29 44 22"/></g></svg>
            {hooked && <span key={done && !live?.failed ? 'landed' : 'hooked'} className="fishing-splash"/>}
        </div>
        <p className="fishing-status" role="status">{done ? hookMissed ? 'The fish slipped away.' : live?.failed ? 'The line went slack or snapped.' : 'The catch is ready.' : hooked ? 'Hold to pull. Release to ease tension.' : elapsed < attempt.hookAt ? 'Line cast. Watch the float…' : 'The float dipped — hook now!'}</p>
        {!hooked && !hookMissed && <button type="button" className="resource-primary" onClick={() => record('hook')} disabled={elapsed < attempt.hookAt || busy}>Hook fish</button>}
        {hooked && <><div className="fishing-instruments"><label className="resource-meter"><span>Line tension <strong>{tension > 80 ? 'Ease off' : tension < 20 ? 'Pull now' : 'Steady'}</strong></span><span className={`fishing-tension${tension > 80 ? ' is-danger' : tension < 20 ? ' is-slack' : ''}`} role="meter" aria-label="Line tension" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tension} aria-valuetext={`${tension}% · ${tension > 80 ? 'High tension' : tension < 20 ? 'Slack line' : 'Safe tension'}`}><span className="fishing-tension-fill" style={{ width: `${tension}%` }}/></span><small>Slack <span>Keep within the marked zone</span> Strain</small></label>
            <label className="resource-meter"><span>Catch progress <strong>{Math.round(live?.progress ?? 0)}%</strong></span><progress max={100} value={live?.progress ?? 0}/><small>Bring the catch to shore</small></label></div>
            <button type="button" className={`resource-primary fishing-reel${reeling ? ' is-held' : ''}`} disabled={done || busy}
                onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); reel(true); }} onPointerUp={() => reel(false)} onPointerCancel={() => reel(false)} onBlur={() => reel(false)}
                onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); reel(true); } }}
                onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); reel(false); } }}>Hold to reel</button></>}
        {done && <button type="button" className="resource-primary fishing-collect" disabled={busy} onClick={() => resolve({ events: hookMissed ? [{ kind: 'hook', at: elapsed }, { kind: 'reel', at: elapsed }] : events.length === 1 ? [...events, { kind: 'reel', at: elapsed }] : events })}>{busy ? 'Recovering catch…' : 'Collect result'}</button>}
    </div>;
}
