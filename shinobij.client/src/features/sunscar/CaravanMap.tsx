import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CaravanNode, CaravanNodeKind, CaravanRun } from '../../../../shared/sunscar/caravan-types';
import { GameIcon, type GameIconName } from '../../components/icons/GameIcon';

import { CARAVAN_NODE_LABELS } from './caravan-presentation';
const glyphs: Record<CaravanNodeKind, GameIconName> = { combat: 'sword', event: 'scroll', camp: 'rations', merchant: 'bag', ruins: 'gate', hazard: 'hazard', treasure: 'gift', pet: 'paw', traveler: 'person', elite: 'sword', boss: 'sigil', destination: 'tower' };
export const CaravanMap = memo(function CaravanMap({ run, selected, onSelect }: { run: CaravanRun; selected: string | null; onSelect: (node: CaravanNode) => void }) {
    const scroll = useRef<HTMLDivElement>(null);
    const [zoomStep, setZoomStep] = useState(0);
    const [width, setWidth] = useState(640);
    const zoom = 1 + zoomStep * .25;
    const height = run.contract.nodes * 135 + 65;
    const current = run.map.find(n => n.id === run.currentNodeId);
    function center() { scroll.current?.scrollTo({ top: Math.max(0, ((current?.y ?? 0) - 90) * zoom), left: Math.max(0, (current?.x ?? 50) / 100 * width * zoom - scroll.current.clientWidth / 2), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
    useEffect(() => {
        const el = scroll.current;
        if (!el) return;
        const observer = new ResizeObserver(() => { if (el.clientWidth > 0) setWidth(el.clientWidth); });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    useEffect(() => { const el = scroll.current; if (el) { el.scrollTop = Math.max(0, ((current?.y ?? 0) - 90) * zoom); el.scrollLeft = Math.max(0, (current?.x ?? 50) / 100 * width * zoom - el.clientWidth / 2); } }, [current?.y, current?.x, zoom, width]);
    const visited = useMemo(() => new Set(run.visited), [run.visited]);
    const available = useMemo(() => new Set(run.available), [run.available]);
    const roads = useMemo(() => {
        const nodes = new Map(run.map.map(node => [node.id, node]));
        return run.map.flatMap(node => node.next.map(id => {
            const end = nodes.get(id)!;
            const traveled = visited.has(node.id) && visited.has(id);
            return <path key={`${node.id}-${id}`} d={`M${node.x * 6.4} ${node.y} C${node.x * 6.4} ${node.y + 65},${end.x * 6.4} ${end.y - 65},${end.x * 6.4} ${end.y}`} fill="none" stroke={traveled ? '#9b4238' : '#535c59'} strokeWidth={traveled ? 5 : 2} strokeDasharray={traveled ? undefined : '5 7'} opacity={node.revealed && end.revealed ? .7 : .13} />;
        }));
    }, [run.map, visited]);
    return <section className="caravan-chart" aria-label="Expedition route map">
        <div className="caravan-map-tools"><span>Scout scroll · {Math.round(zoom * 100)}%</span><div><button onClick={() => setZoomStep(z => Math.max(0, z - 1))} aria-label="Zoom map out" disabled={zoomStep === 0}>−</button><button onClick={center}>Your caravan</button><button onClick={() => setZoomStep(z => Math.min(4, z + 1))} aria-label="Zoom map in" disabled={zoomStep === 4}>+</button></div></div>
        <div className="caravan-map-scroll" ref={scroll} tabIndex={0} aria-label="Scroll to explore the route. Select a visible stop to inspect it.">
            <div className="caravan-map-paper" style={{ width: width * zoom, height: height * zoom }}>
                <svg viewBox={`0 0 640 ${height}`} preserveAspectRatio="none" className="caravan-map-art" aria-hidden="true">
                    <defs><pattern id="sunscar-contours" width="160" height="120" patternUnits="userSpaceOnUse"><path d="M-40 80Q25 0 80 50T200 35M-40 90Q25 10 80 60T200 45M-40 100Q25 20 80 70T200 55" fill="none" stroke="#59605a" strokeWidth="1" opacity=".13" /></pattern><linearGradient id="sunscar-map-dusk" x2="0" y2="1"><stop stopColor="#dfd4b8"/><stop offset=".55" stopColor="#c2b49a"/><stop offset="1" stopColor="#aebbaa"/></linearGradient></defs>
                    <rect width="640" height={height} fill="url(#sunscar-map-dusk)"/><rect width="640" height={height} fill="url(#sunscar-contours)"/>
                    {[0, 1, 2, 3].map(region => <g key={region} opacity=".25" transform={`translate(0 ${region * 335 + 35})`}><text x="28" y="12" fontSize="12" letterSpacing="4" fill="#354642">{['SUNSCAR BORDERLANDS', 'SCORPION PASS', 'THE SEALED SHRINE', 'REEDWATCH OUTPOST'][region]}</text><path d="M8 180l35-72 30 55 28-83 42 90M488 140l32-90 22 35 38-45 40 95" fill="#667168"/><path d="M30 189q50-40 115 0m345 8q70-45 132 0" fill="none" stroke="#4d5a54"/><path d="M530 230q28 9 60 0m-57 14h54m-44-8v54m34-54v54" fill="none" stroke="#994c40" strokeWidth="5"/></g>)}
                    {roads}
                    {run.map.filter(n => !n.revealed).map(node => <g key={node.id} opacity=".5"><circle cx={node.x * 6.4} cy={node.y} r="23" fill="#b6a282"/><text x={node.x * 6.4} y={node.y + 6} textAnchor="middle" fontSize="18" fill="#51452f">?</text></g>)}
                </svg>
                {run.map.filter(n => n.revealed).map(node => <button key={node.id} type="button"
                    className={`caravan-map-node kind-${node.kind}${visited.has(node.id) ? ' is-visited' : ''}${available.has(node.id) ? ' is-available' : ''}${selected === node.id ? ' is-selected' : ''}${node.id === run.currentNodeId ? ' is-current' : ''}`}
                    style={{ left: `${node.x}%`, top: node.y * zoom }} aria-pressed={selected === node.id}
                    aria-label={`${CARAVAN_NODE_LABELS[node.kind]}, leg ${node.layer + 1}${node.id === run.currentNodeId ? ', your caravan' : visited.has(node.id) ? ', visited' : available.has(node.id) ? ', connected road' : ', ahead'}${node.objectiveOpportunity ? ', mission objective opportunity' : ''}`}
                    onClick={() => onSelect(node)}><GameIcon name={node.id === run.currentNodeId ? 'chakra' : glyphs[node.kind]} size={24}/>{node.objectiveOpportunity && <span className="caravan-map-objective" aria-hidden="true">✦</span>}<small>{CARAVAN_NODE_LABELS[node.kind]}</small></button>)}
            </div>
        </div>
        <p className="caravan-map-key"><span>● Connected road</span><span><GameIcon name="chakra" size={14}/> Your caravan</span><span>? Unscouted ground</span><span>✦ Objective opportunity</span></p>
    </section>;
});
