import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { FRACTURE_TEMPLATES, solveFractureChain } from '../../../shared/fracture-chain';
import { scoreFishing, FISHING_REEL_MS, type FishingEvent } from '../../../shared/fishing-game';
import { serverNow } from '../lib/server-clock';
import { resourceNode } from '../../../shared/resource-nodes';
import { FishingScene } from './FishingScene';
import stoneTexture from '../assets/warfront/cliff-rock.jpg';
import './resource-minigames.css';

const KunaiFishing = lazy(() => import('./KunaiFishing'));
export function ResourceMinigame({ attempt, busy, resolve, fishingGold = false }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void; fishingGold?: boolean }) {
    if (attempt.activity === 'fishing' && attempt.fishingStyle === 'kunai') return <Suspense fallback={<p role="status">Preparing your fishing kunai…</p>}><KunaiFishing attempt={attempt} busy={busy} resolve={resolve} golden={fishingGold} /></Suspense>;
    if (attempt.mode === 'relaxed') return <RelaxedGathering attempt={attempt} busy={busy} resolve={resolve} />;
    return attempt.activity === 'mining' ? <FractureChain attempt={attempt} busy={busy} resolve={resolve} /> : <CastAndReel attempt={attempt} busy={busy} resolve={resolve} />;
}
function RelaxedGathering({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    const [elapsed, setElapsed] = useState(() => Math.max(0, serverNow() - attempt.startedAt));
    const ready = elapsed >= 3000;
    useEffect(() => {
        if (ready) return;
        const timer = window.setInterval(() => setElapsed(Math.max(0, serverNow() - attempt.startedAt)), 50);
        return () => clearInterval(timer);
    }, [attempt.startedAt, ready]);
    return <div className={`resource-relaxed resource-relaxed--${attempt.activity}`}>
        <div className="resource-relaxed-art" aria-hidden="true" style={attempt.activity === 'mining' ? { backgroundImage: `url(${stoneTexture})` } : undefined}>{attempt.activity === 'mining' ? <img src="/items/tool-golden-pickaxe.svg" alt="" /> : <FishingScene elapsed={elapsed} hookAt={1800} relaxed />}</div>
        <p>{attempt.activity === 'mining' ? 'Chakra follows the seam. The stone begins to separate.' : 'Your line settles into the current. A shadow approaches the float.'}</p>
        <p>Animation mode uses your skill’s baseline success rate.</p>
        <button type="button" disabled={busy || !ready} onClick={() => resolve({})}>{busy ? 'Recovering result…' : ready ? 'Collect result' : 'Gathering…'}</button>
    </div>;
}
function FractureChain({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    const formation = FRACTURE_TEMPLATES[attempt.template];
    const mineral = resourceNode(attempt.nodeId)?.trace;
    const stone = mineral === 'gather-rime-crystal' ? 'frozen' : mineral === 'gather-ember-ore' ? 'volcanic' : mineral === 'gather-stormglass-shard' ? 'crystal' : 'iron';
    const key = `outpost-mining:${attempt.id}`;
    const [input, setInput] = useState(() => readMiningInput(key, attempt));
    const placements = input.placements, detonated = input.detonatedAt !== undefined;
    const [wave, setWave] = useState(() => input.detonatedAt === undefined ? 0
        : Math.max(0, Math.min(formation.charges, Math.floor((serverNow() - input.detonatedAt) / 650))));
    const resolveRef = useRef(resolve);
    useEffect(() => { resolveRef.current = resolve; }, [resolve]);
    useEffect(() => {
        if (input.detonatedAt === undefined) return;
        const phaseAt = input.detonatedAt, pending: number[] = [];
        pending.push(window.setTimeout(() => setWave(Math.max(0, Math.min(placements.length, Math.floor((serverNow() - phaseAt) / 650)))), 0));
        for (let index = 0; index < placements.length; index++) {
            const fireAt = phaseAt + (index + 1) * 650;
            if (fireAt > serverNow()) pending.push(window.setTimeout(() => setWave(index + 1), fireAt - serverNow()));
        }
        const resolveAt = Math.max(phaseAt + 2500, attempt.startedAt + 2800);
        pending.push(window.setTimeout(() => resolveRef.current({ placements }), Math.max(0, resolveAt - serverNow())));
        return () => pending.forEach(clearTimeout);
    }, [input.detonatedAt, placements, attempt.startedAt]);
    const solved = solveFractureChain(attempt.template, placements);
    const exposed = detonated ? new Set(solved?.waves.slice(0, wave).flat()) : new Set<number>();
    function detonate() {
        if (!solved || detonated || busy) return;
        const committed = { placements, detonatedAt: serverNow() };
        // Persist the commitment in the click itself, before a document can
        // leave. A reload resumes its timer and frozen payload, never its edit phase.
        persistMiningInput(key, committed); setInput(committed);
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
                onClick={() => setInput(current => {
                    if (current.detonatedAt !== undefined) return current;
                    const next = { placements: current.placements.includes(index) ? current.placements.filter(i => i !== index) : [...current.placements, index] };
                    persistMiningInput(key, next); return next;
                })}>
                <svg viewBox="0 0 40 44" aria-hidden="true"><path className="seal-paper" d="M11 3 31 5 29 41 8 38Z"/><circle cx="20" cy="21" r="10"/><circle cx="20" cy="21" r="6"/><path d="M20 7V13M20 29V35M6 21H12M28 21H34M16 18L23 17 21 25 17 23 24 22"/></svg><span>{placements.includes(index) ? placements.indexOf(index) + 1 : '+'}</span>
            </button>)}
        </div>
        <aside className="fracture-guide"><p className="resource-kicker">Read the stone</p><h4>Expose each face once.</h4><p>Place {formation.charges} chakra seals along the faults. Trace each seam to the numbered ore faces.</p><div className="fracture-face-key" aria-hidden="true">{formation.faults.map((_, face) => <span key={face} className={exposed.has(face) ? 'exposed' : ''}>{face + 1}</span>)}</div><p className="fracture-caution">Overlapping fractures shatter the ore.</p><small>Select a placed seal to move it.</small></aside>
        </div>
        <p className="fracture-readout" role="status">{detonated ? `${wave} / ${formation.charges} charges fired${wave === formation.charges ? solved?.destroyed ? ' · Core shattered' : ` · ${solved?.exposed}/${formation.faces} core faces exposed` : ''}` : `${placements.length} / ${formation.charges} charges placed · Select a placed charge to reposition it`}</p>
        <button type="button" className="resource-primary" disabled={!solved || detonated || busy} onClick={detonate}>{detonated ? 'Cracks propagating…' : 'Detonate chain'}</button>
        {detonated && wave === formation.charges && !busy && <button type="button" className="resource-recover" onClick={() => resolve({ placements })}>Recover result</button>}
    </div>;
}
type MiningInput = { placements: number[]; detonatedAt?: number };
function persistMiningInput(key: string, input: MiningInput) {
    try { sessionStorage.setItem(key, JSON.stringify(input)); } catch { /* memory only */ }
}
function readMiningInput(key: string, attempt: ResourcePublicAttempt): MiningInput {
    try {
        const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}');
        const input: Partial<MiningInput> | null = Array.isArray(saved) ? { placements: saved } : saved as Partial<MiningInput> | null;
        const formation = FRACTURE_TEMPLATES[attempt.template], placements = input?.placements;
        if (!Array.isArray(placements) || placements.length > formation.charges || new Set(placements).size !== placements.length
            || placements.some(index => !Number.isInteger(index) || !formation.sites[index])) return { placements: [] };
        const phaseAt = input?.detonatedAt;
        if (phaseAt !== undefined && (typeof phaseAt !== 'number' || !Number.isFinite(phaseAt)
            || phaseAt < attempt.startedAt || phaseAt > attempt.expiresAt || !solveFractureChain(attempt.template, placements))) return { placements: [] };
        return { placements, ...(phaseAt !== undefined ? { detonatedAt: phaseAt } : {}) };
    } catch { return { placements: [] }; }
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
    useEffect(() => {
        function releaseControl() {
            held.current = false;
            setEvents(current => {
                if (current.at(-1)?.kind !== 'reel' || current.length >= 48) return current;
                const next: FishingEvent[] = [...current, { kind: 'release', at: Math.max(current.at(-1)!.at, serverNow() - attempt.startedAt) }];
                try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ }
                return next;
            });
        }
        function visibilityChanged() { if (document.hidden) releaseControl(); }
        window.addEventListener('blur', releaseControl);
        document.addEventListener('visibilitychange', visibilityChanged);
        return () => {
            window.removeEventListener('blur', releaseControl);
            document.removeEventListener('visibilitychange', visibilityChanged);
        };
    }, [attempt.startedAt, key]);
    function record(kind: FishingEvent['kind']) {
        const at = Math.max(0, serverNow() - attempt.startedAt);
        setEvents(current => { if (current.length >= 48) return current; const next = [...current, { kind, at }]; try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ } return next; });
    }
    function reel(value: boolean) { if (held.current === value || !events.length || done || (value && events.length >= 47)) return; held.current = value; record(value ? 'reel' : 'release'); }
    const hooked = events.length > 0, hookMissed = !hooked && elapsed > attempt.hookAt + 1200;
    const done = hookMissed || (hooked && elapsed >= events[0].at + FISHING_REEL_MS);
    const live = hooked ? scoreFishing(attempt.hookAt, events, elapsed, true) : null;
    const tension = Math.round(live?.tension ?? 35);
    const broken = live?.tension === 100;
    const reeling = !done && !broken && events.at(-1)?.kind === 'reel';
    const phase = done || broken ? '03' : hooked ? '02' : '01';
    useEffect(() => {
        if (done) return;
        const timer = window.setInterval(() => setElapsed(Math.max(0, serverNow() - attempt.startedAt)), 50);
        return () => clearInterval(timer);
    }, [attempt.startedAt, done]);
    const status = broken ? 'The line snapped. Release sooner next time.'
        : done ? hookMissed ? 'The fish slipped away.' : live?.failed ? 'The fish got away. Reel within the marked zone.' : 'The catch is ready.'
        : !hooked ? elapsed < attempt.hookAt ? 'Line cast. Watch the float…' : 'The float dipped — hook now!'
        : tension > 80 ? 'Release now — the line is close to snapping!' : tension < 20 ? 'Hold to reel — take up the slack.'
        : reeling ? 'Keep pulling. Release before the line strains.' : 'Hold to pull. Release to ease tension.';
    return <div className="fishing-game">
        <div className="gather-game-heading"><div><p className="resource-kicker">Fishing · Cast · Hook · Reel</p><h3>{broken ? 'The line snapped' : done ? hookMissed || live?.failed ? 'Lost to the current' : 'Within reach' : hooked ? 'Follow the pull' : 'Read the water'}</h3></div><span className="gather-game-method">{phase} / 03</span></div>
        <FishingScene elapsed={elapsed} hookAt={attempt.hookAt} hooked={hooked} reeling={reeling} tension={tension}
            progress={live?.progress ?? 0} outcome={broken ? 'escaped' : done ? hookMissed || live?.failed ? 'escaped' : 'landed' : undefined} />
        <p className="fishing-status" role="status">{status}</p>
        {!hooked && !hookMissed && <button type="button" autoFocus className="resource-primary" onClick={() => { if (elapsed >= attempt.hookAt && !busy) record('hook'); }} aria-disabled={elapsed < attempt.hookAt || busy}>Hook fish</button>}
        {hooked && <><div className="fishing-instruments"><label className="resource-meter"><span>Line tension <strong>{tension > 80 ? 'Ease off' : tension < 20 ? 'Pull now' : 'Steady'}</strong></span><span className={`fishing-tension${tension > 80 ? ' is-danger' : tension < 20 ? ' is-slack' : ''}`} role="meter" aria-label="Line tension" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tension} aria-valuetext={`${tension}% · ${tension > 80 ? 'High tension' : tension < 20 ? 'Slack line' : 'Safe tension'}`}><span className="fishing-tension-fill" style={{ width: `${tension}%` }}/></span><small>Slack <span>Keep within the marked zone</span> Strain</small></label>
            <label className="resource-meter"><span>Catch progress <strong>{Math.round(live?.progress ?? 0)}%</strong></span><progress aria-label="Catch progress" max={100} value={live?.progress ?? 0}/><small>Bring the catch to shore</small></label></div>
            <button type="button" autoFocus aria-pressed={reeling} className={`resource-primary fishing-reel${reeling ? ' is-held' : ''}`} disabled={done || broken || busy}
                onPointerDown={event => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); reel(true); }} onPointerUp={event => { if (event.isPrimary) reel(false); }} onPointerCancel={event => { if (event.isPrimary) reel(false); }} onLostPointerCapture={() => reel(false)} onBlur={() => reel(false)}
                onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); reel(true); } }}
                onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); reel(false); } }}>Hold to reel</button></>}
        {done && <button type="button" autoFocus className="resource-primary fishing-collect" disabled={busy} onClick={() => resolve({ events: hookMissed ? [{ kind: 'hook', at: elapsed }, { kind: 'reel', at: elapsed }] : events.length === 1 ? [...events, { kind: 'reel', at: elapsed }] : events })}>{busy ? 'Recovering catch…' : 'Collect result'}</button>}
    </div>;
}
