import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FRACTURE_TEMPLATES, solveFractureChain, type FractureTemplate } from '../../../shared/fracture-chain';
import type { ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { resourceNode } from '../../../shared/resource-nodes';
import { serverNow } from '../lib/server-clock';
import { playGameSfx, primeGameAudio } from '../lib/game-audio';
import { Button } from './ui/Button';
import stoneTexture from '../assets/warfront/cliff-rock.jpg';
import './veinbreaking.css';

type Props = { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void };
type MiningInput = { placements: number[]; detonatedAt?: number };
const DEPOSITS = {
    iron: { name: 'Iron Sand', caption: 'Iron-bearing stone', detail: 'Metallic grains lie beneath the weathered shell.' },
    frozen: { name: 'Rime-bearing stone', caption: 'Glacial deposit', detail: 'Brittle ice branches through the mineral seam.' },
    volcanic: { name: 'Ember-bearing stone', caption: 'Volcanic deposit', detail: 'Warm fissures run beneath a dense basalt shell.' },
    crystal: { name: 'Stormglass-bearing stone', caption: 'Stormglass deposit', detail: 'Glasslike facets catch a trace of restless chakra.' },
};
function depositFor(attempt: ResourcePublicAttempt) {
    const node = resourceNode(attempt.nodeId), mineral = node?.trace ?? node?.family;
    return node?.worldBossCrystal || mineral === 'gather-stormglass-shard' ? 'crystal'
        : mineral === 'gather-rime-crystal' ? 'frozen' : mineral === 'gather-ember-ore' ? 'volcanic' : 'iron';
}
function depositDetails(attempt: ResourcePublicAttempt) {
    return resourceNode(attempt.nodeId)?.worldBossCrystal
        ? { name: 'Hollow Shard', caption: 'Hollow Shard vein', detail: 'A sealed crystal vein holds a fragment of the world threat.' }
        : DEPOSITS[depositFor(attempt)];
}
function persist(key: string, input: MiningInput) {
    try { sessionStorage.setItem(key, JSON.stringify(input)); } catch { /* Keep the in-memory commitment. */ }
}
function restore(key: string, attempt: ResourcePublicAttempt): MiningInput {
    try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}');
        const input = Array.isArray(saved) ? { placements: saved } : saved;
        const formation = FRACTURE_TEMPLATES[attempt.template], placements = input?.placements;
        if (!Array.isArray(placements) || placements.length > formation.charges || new Set(placements).size !== placements.length
            || placements.some(index => !Number.isInteger(index) || !formation.sites[index])) return { placements: [] };
        const at = input.detonatedAt;
        if (at !== undefined && (typeof at !== 'number' || !Number.isFinite(at) || at < attempt.startedAt || at > attempt.expiresAt
            || !solveFractureChain(attempt.template, placements))) return { placements: [] };
        return { placements, ...(at === undefined ? {} : { detonatedAt: at }) };
    } catch { return { placements: [] }; }
}

export function Veinbreaking({ attempt, busy, resolve }: Props) {
    const formation = FRACTURE_TEMPLATES[attempt.template], skin = depositFor(attempt), deposit = depositDetails(attempt);
    const key = `outpost-mining:${attempt.id}`;
    const [input, setInput] = useState(() => restore(key, attempt));
    const [scan, setScan] = useState(0), [focused, setFocused] = useState<number | null>(null);
    const placements = input.placements, detonated = input.detonatedAt !== undefined;
    const [wave, setWave] = useState(() => detonated ? Math.min(formation.charges, Math.max(0, Math.floor((serverNow() - input.detonatedAt!) / 650))) : 0);
    const resolveRef = useRef(resolve), heardWave = useRef(wave);
    useEffect(() => { resolveRef.current = resolve; }, [resolve]);
    useEffect(() => {
        if (input.detonatedAt === undefined) return;
        const at = input.detonatedAt, pending: number[] = [];
        pending.push(window.setTimeout(() => setWave(Math.min(formation.charges, Math.max(0, Math.floor((serverNow() - at) / 650)))), 0));
        for (let i = 0; i < formation.charges; i++) {
            const fireAt = at + (i + 1) * 650;
            if (fireAt > serverNow()) pending.push(window.setTimeout(() => setWave(i + 1), fireAt - serverNow()));
        }
        pending.push(window.setTimeout(() => resolveRef.current({ placements }), Math.max(0, Math.max(at + 2500, attempt.startedAt + 2800) - serverNow())));
        return () => pending.forEach(clearTimeout);
    }, [input.detonatedAt, placements, attempt.startedAt, formation.charges]);
    useEffect(() => {
        if (wave > heardWave.current && !document.hidden) playGameSfx(skin === 'crystal' ? 'guard' : 'impact-light', { gain: .45, playbackRate: skin === 'frozen' ? 1.3 : .8 });
        heardWave.current = wave;
    }, [wave, skin]);
    const hits = formation.faults.map((_, face) => placements.filter(site => formation.sites[site].path.includes(face)).length);
    const overlaps = hits.filter(n => n > 1).length, covered = hits.filter(n => n === 1).length;
    const solved = solveFractureChain(attempt.template, placements);
    function release() {
        if (!solved || detonated || busy) return;
        primeGameAudio(['impact-light', 'guard', 'paper']);
        playGameSfx('chakra-positive', { gain: .55 });
        const next = { placements, detonatedAt: serverNow() };
        persist(key, next); setInput(next); setFocused(null);
    }
    return <div className="veinbreaking">
        <div className="gather-game-heading"><div><p className="resource-kicker">Mining · {deposit.name}</p><h3>Veinbreaking</h3></div><span className="gather-game-method">{detonated ? 'Release' : 'Read · Seal · Release'}</span></div>
        <div className="vein-workspace">
            <VeinScene attempt={attempt} formation={formation} placements={placements} wave={wave} detonated={detonated} releaseAt={input.detonatedAt} scan={scan} focused={focused}
                disabled={busy} onFocus={setFocused} onToggle={index => {
                    primeGameAudio(['paper', 'impact-light', 'guard']); playGameSfx('paper', { gain: .55 });
                    setInput(current => {
                        if (current.detonatedAt !== undefined) return current;
                        const next = { placements: current.placements.includes(index) ? current.placements.filter(i => i !== index) : [...current.placements, index] };
                        persist(key, next); return next;
                    });
                }} />
            <aside className="vein-guide" aria-label="Veinbreaking field notes">
                <p className="resource-kicker">{formation.name}</p><h4>Free the seam.</h4>
                <p>Place {formation.charges} seals. Reach every pocket once. Crossing fractures crush the ore.</p>
                <Button variant="ghost" className="vein-read" disabled={detonated || busy} onClick={() => { setScan(n => n + 1); playGameSfx('chakra-positive', { gain: .45 }); }}>Read seam</Button>
                <p className="vein-route" aria-live="polite">{focused === null ? deposit.detail : `${formation.sites[focused].label} · reaches pockets ${formation.sites[focused].path.map(i => i + 1).join(', ')}`}</p>
                <p className={`vein-assessment${overlaps ? ' is-warning' : ''}`} role="status">{detonated
                    ? wave < formation.charges ? `${wave} / ${formation.charges} seals released` : solved?.destroyed ? 'Fractures crossed · core crushed' : 'Fracture complete · checking extraction…'
                    : overlaps ? `${overlaps} ${overlaps === 1 ? 'pocket' : 'pockets'} under crossing fractures` : `${covered} / ${formation.faces} pockets reached`}</p>
                <small>Select a placed seal to lift it. Reading and repositioning cost no extra actions.</small>
            </aside>
        </div>
        <p className="vein-readout">{placements.length} / {formation.charges} seals placed · {detonated ? 'Formation committed' : 'Extraction chance still depends on Mining skill'}</p>
        <Button variant="primary" className="resource-primary" disabled={!solved || detonated || busy} onClick={release}>{detonated ? 'Fracture releasing…' : 'Release fracture'}</Button>
        {detonated && wave === formation.charges && !busy && <Button className="resource-recover" onClick={() => resolve({ placements })}>Recover result</Button>}
    </div>;
}

function PaperTalisman({ primed, igniting, ignitionAt }: { primed: boolean; igniting: boolean; ignitionAt?: number }) {
    const id = useId().replace(/:/g, '');
    // The parent remounts a paper once when it fires. On reload, start at the
    // admitted chain's elapsed phase instead of replaying an already-spent seal.
    const [delay] = useState(() => ignitionAt === undefined ? 0 : -Math.max(0, serverNow() - ignitionAt));
    return (
        <svg className={`vein-talisman${primed ? ' is-primed' : ''}${igniting ? ' is-igniting' : ''}`} style={{ '--ignition-delay': `${delay}ms` } as CSSProperties} viewBox="8 4 48 96" aria-hidden="true">
            <defs><linearGradient id={`${id}-paper`} x2="1" y2=".4"><stop stopColor="#ad9871"/><stop offset=".4" stopColor="#ead9b4"/><stop offset="1" stopColor="#c2ad86"/></linearGradient></defs>
            <g transform="rotate(8 32 52)" strokeLinejoin="round">
                <path className="vein-talisman-glow" d="M13 8 51 10 50 91 43 96 36 92 28 96 12 92Z"/>
                <g className="vein-talisman-paper">
                    <path d="M13 8 51 10 50 91 43 96 36 92 28 96 12 92Z" fill={`url(#${id}-paper)`} stroke="#756349" strokeWidth="1.4"/>
                    <path className="vein-talisman-rule" d="m18 15 27 1-1 69-27-1Zm2 9h23M20 76h22M15 47l34 2"/>
                    <text className="vein-talisman-ink" x="32" y="56" textAnchor="middle">封</text>
                    <path className="vein-talisman-ink" d="m25 20 7-3 7 3m-14 43 14 1m-13 5 12 1"/>
                    <path className="vein-talisman-char" d="m12 78 7-5 5 6 7-5 7 5 6-5 7 4-1 13-7 5-7-4-8 4-16-4Z"/>
                </g>
                <path className="vein-talisman-burn" d="m12 78 7-5 5 6 7-5 7 5 6-5 7 4"/>
                <path className="vein-talisman-flame" d="M20 80Q15 71 23 62L26 71Q34 59 31 51Q47 65 43 74L47 68Q50 80 40 85Z"/>
                <g className="vein-talisman-embers"><circle cx="17" cy="76" r="1.2"/><circle cx="33" cy="69" r="1.5"/><circle cx="47" cy="78" r="1"/></g>
            </g>
        </svg>
    );
}

function VeinScene({ attempt, formation, placements, wave, detonated, releaseAt, scan, focused = null, disabled = false, onToggle, onFocus }: {
    attempt: ResourcePublicAttempt; formation: FractureTemplate; placements: number[]; wave: number; detonated: boolean; scan: number;
    releaseAt?: number; focused?: number | null; disabled?: boolean; onToggle?: (index: number) => void; onFocus?: (index: number | null) => void;
}) {
    const id = useId().replace(/:/g, ''), skin = depositFor(attempt);
    const fired = placements.slice(0, wave), exposed = new Set(fired.flatMap(site => formation.sites[site].path));
    const hits = formation.faults.map((_, face) => placements.filter(site => formation.sites[site].path.includes(face)).length);
    const crushed = detonated && wave === formation.charges && hits.some(n => n > 1);
    return <div className={`vein-scene vein-scene--${skin}${detonated ? ' is-releasing' : ''}${crushed ? ' is-crushed' : ''}`} data-deposit={skin}>
        <span className="vein-scene-caption">{depositDetails(attempt).caption}</span>
        <svg className="vein-rock" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
                <clipPath id={`${id}-rock`}><path d="M16 7 40 3 65 6 83 15 96 37 93 62 83 88 58 97 28 91 8 74 3 47 8 24Z" /></clipPath>
                <radialGradient id={`${id}-shade`} cx="35%" cy="25%" r="80%"><stop stopColor="#080b0f" stopOpacity="0"/><stop offset="1" stopColor="#080b0f" stopOpacity=".85"/></radialGradient>
                <linearGradient id={`${id}-mineral`} x2="1" y2="1"><stop stopColor="var(--vein-glint)"/><stop offset=".45" stopColor="var(--vein-mineral)"/><stop offset="1" stopColor="var(--vein-shadow)"/></linearGradient>
                <pattern id={`${id}-shell`} width="100" height="100" patternUnits="userSpaceOnUse"><image className="vein-texture" href={stoneTexture} width="100" height="100" preserveAspectRatio="xMidYMid slice"/><path d="M0 0H100V100H0Z" fill={`url(#${id}-shade)`}/></pattern>
            </defs>
            <g clipPath={`url(#${id}-rock)`}>
                <image className="vein-texture" href={stoneTexture} width="100" height="100" preserveAspectRatio="xMidYMid slice"/>
                <path d="M0 0H100V100H0Z" fill={`url(#${id}-shade)`}/>
                <path className="vein-strata" d="m5 30 26-12 28 9 29-10M3 55l24-9 37 8 31-18M10 78l26-10 33 12 24-18"/>
                <path className="vein-thread" d="m25 9 7 18-8 15 13 14-6 18 10 18m26-82-5 21 12 17-10 16 5 25m-30-54 13 7 15-4"/>
                {skin === 'frozen' && <path className="vein-frost" d="m15 19 13 8-2 11m2-11 10-8m-10 8-11 5m55 35 8-10 10 1m-10-1-2-12m2 12 8 8M18 72l11-4 7 8m-7-8 2-11"/>}
                {skin === 'volcanic' && <path className="vein-heat" d="m16 82 15-13-2-15 11-12-4-18m4 18 17 5 7-12 12-3m-19 15 6 19 17 12"/>}
                {skin === 'crystal' && <><path className="vein-glass" d="m15 45 6-12 5 13-7 8Zm61-25 8 8-6 11-5-9Zm-9 57 7 12-13-4Z"/><path className="vein-arc" d="m20 48 13-5-3 8 16-3-2 6 15-8-1 7 20-8"/></>}
                {formation.faults.map((point, face) => <g key={`ore-${face}`} className={`vein-pocket${exposed.has(face) ? ' is-exposed' : ''}${hits[face] > 1 && !detonated ? ' is-stressed' : ''}`}>
                    <path fill={`url(#${id}-mineral)`} d={skin === 'iron' ? `M${point.x - 7} ${point.y} l4 -6 8 2 3 7 -7 4 -7 -2Z` : `M${point.x - 5} ${point.y + 5} l-2 -8 5 -6 7 5 1 9 -6 4Z`}/>
                    <path className="vein-facet" d={`M${point.x - 2} ${point.y - 7} l2 9 6 -6 M${point.x} ${point.y + 2} l-5 3`}/>
                    {skin === 'iron' && <path className="vein-grains" d={`M${point.x - 4} ${point.y - 1}h1m3 -2h1m2 4h1m-6 2h1m4 1h1`}/>}
                </g>)}
                {formation.faults.map((point, face) => <g key={`shell-${face}`} className={`vein-shell${exposed.has(face) ? ' is-loose' : ''}`}
                    style={{ '--chip-x': `${(point.x - 50) * .6}px`, '--chip-y': `${12 + face * 2}px`, '--chip-turn': `${face % 2 ? -24 : 32}deg` } as CSSProperties}>
                    <path style={{ fill: `url(#${id}-shell)` }} d={`M${point.x - 9} ${point.y - 5} l6 -7 11 4 3 12 -10 6 -11 -5Z`}/>
                    <path className="vein-shell-edge" d={`M${point.x - 9} ${point.y - 5} l7 5 13 -8 M${point.x - 2} ${point.y} l-3 10`}/>
                </g>)}
            </g>
            {formation.sites.map((site, index) => {
                const points = [site, ...site.path.map(face => formation.faults[face])];
                const d = points.map((p, i) => i === 0 ? `M${p.x} ${p.y}` : `L${(points[i - 1].x + p.x) / 2 + (index % 2 ? 2 : -2)} ${(points[i - 1].y + p.y) / 2 - 2} ${p.x} ${p.y}`).join(' ');
                return <path key={index} d={d} pathLength="1" className={`vein-fault${placements.includes(index) ? ' is-selected' : ''}${focused === index ? ' is-preview' : ''}${fired.includes(index) ? ' is-fired' : ''}`}/>;
            })}
            {!detonated && formation.faults.map((point, face) => <g className={`vein-pocket-marker${hits[face] > 1 ? ' is-stressed' : hits[face] === 1 ? ' is-covered' : ''}`} key={`mark-${face}`}>
                <circle cx={point.x} cy={point.y} r="3.4"/><text x={point.x} y={point.y + 1.5} textAnchor="middle">{hits[face] > 1 ? '!' : face + 1}</text>
            </g>)}
            {scan > 0 && !detonated && <circle key={scan} className="vein-scan" cx="50" cy="50" r="44"/>}
            {formation.faults.map((point, face) => exposed.has(face) && <g className="vein-debris" key={`debris-${face}`} style={{ '--dust-x': `${(point.x - 50) * .5}px` } as CSSProperties}>
                <circle cx={point.x - 5} cy={point.y + 5} r="1.5"/><circle cx={point.x + 3} cy={point.y + 1} r=".8"/><circle cx={point.x} cy={point.y + 7} r="1"/>
                <path d={`M${point.x + 5} ${point.y + 3} l2 1 -1 3 -2 -1Z`}/>
            </g>)}
        </svg>
        {formation.sites.map((site, index) => <button type="button" key={site.label} className={`vein-seal${placements.includes(index) ? ' is-placed' : ''}${fired.includes(index) ? ' is-fired' : ''}`}
            style={{ left: `clamp(24px, ${site.x}%, calc(100% - 24px))`, top: `clamp(25px, ${site.y}%, calc(100% - 25px))` }} aria-pressed={placements.includes(index)}
            aria-label={`${site.label}, reaches pockets ${site.path.map(face => face + 1).join(', ')}${placements.includes(index) ? `, seal ${placements.indexOf(index) + 1}` : ''}`}
            disabled={!onToggle || detonated || disabled || (!placements.includes(index) && placements.length === formation.charges)}
            onFocus={() => onFocus?.(index)} onBlur={() => onFocus?.(null)} onPointerEnter={() => onFocus?.(index)} onPointerLeave={() => onFocus?.(null)} onClick={() => onToggle?.(index)}>
            <PaperTalisman key={fired.includes(index) ? 'spent' : 'ready'} primed={placements.includes(index)} igniting={fired.includes(index)}
                ignitionAt={fired.includes(index) && releaseAt !== undefined ? releaseAt + (placements.indexOf(index) + 1) * 650 : undefined} /><span className="vein-seal-number" aria-hidden="true">{placements.includes(index) ? placements.indexOf(index) + 1 : String.fromCharCode(65 + index)}</span>
        </button>)}
    </div>;
}

function cleanPlacements(index: number): number[] {
    const formation = FRACTURE_TEMPLATES[index];
    function find(selected: number[], start: number): number[] | undefined {
        if (selected.length === formation.charges) {
            const result = solveFractureChain(index, selected)!;
            return !result.destroyed && result.exposed === formation.faces ? selected : undefined;
        }
        for (let site = start; site < formation.sites.length; site++) {
            const result = find([...selected, site], site + 1); if (result) return result;
        }
    }
    return find([], 0) ?? [];
}
export function RelaxedMining({ attempt, busy, resolve }: Props) {
    const [elapsed, setElapsed] = useState(() => Math.max(0, serverNow() - attempt.startedAt));
    const ready = elapsed >= 3000;
    useEffect(() => {
        if (ready) return;
        const tick = () => setElapsed(Math.max(0, serverNow() - attempt.startedAt));
        const timer = window.setInterval(tick, 100); return () => clearInterval(timer);
    }, [attempt.startedAt, ready]);
    const formation = FRACTURE_TEMPLATES[attempt.template];
    const placements = useMemo(() => cleanPlacements(attempt.template), [attempt.template]);
    return <div className="veinbreaking veinbreaking--relaxed">
        <div className="gather-game-heading"><div><p className="resource-kicker">Mining · {depositDetails(attempt).name}</p><h3>Veinbreaking</h3></div><span className="gather-game-method">Animation mode</span></div>
        <VeinScene attempt={attempt} formation={formation} placements={elapsed >= 450 ? placements : []} wave={Math.max(0, Math.min(formation.charges, Math.floor((elapsed - 600) / 650)))} detonated={elapsed >= 600} releaseAt={attempt.startedAt + 600} scan={1}/>
        <p className="vein-readout" role="status"><span>{ready ? 'The seam is open. Check the extraction.' : 'Chakra follows the seals. Stone falls away.'}</span> <span>Animation mode uses your skill’s baseline success rate.</span></p>
        <Button variant="primary" className="resource-primary" disabled={busy || !ready} onClick={() => resolve({})}>{busy ? 'Recovering result…' : ready ? 'Collect result' : 'Gathering…'}</Button>
    </div>;
}
