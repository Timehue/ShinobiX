import { useEffect, useRef, useState } from 'react';
import type { CaravanNode, CaravanNodeKind, CaravanRun } from '../../../../shared/sunscar/caravan-types';

import { CARAVAN_NODE_LABELS } from './caravan-presentation';
const glyphs: Record<CaravanNodeKind, string> = { combat: '⚔', event: '?', camp: '♨', merchant: '◈', ruins: '▥', hazard: '!', treasure: '◆', pet: '♧', traveler: '♟', elite: '⚔', boss: '✥', destination: '⚑' };
export function CaravanMap({ run, selected, onSelect }: { run: CaravanRun; selected: string | null; onSelect: (node: CaravanNode) => void }) {
    const scroll = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const height = run.contract.nodes * 135 + 65;
    const current = run.map.find(n => n.id === run.currentNodeId);
    function center() { scroll.current?.scrollTo({ top: Math.max(0, ((current?.y ?? 0) - 130) * zoom), left: Math.max(0, (current?.x ?? 50) * 6.4 * zoom - scroll.current.clientWidth / 2), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
    useEffect(() => { const el = scroll.current; if (el) { el.scrollTop = Math.max(0, ((current?.y ?? 0) - 130) * zoom); el.scrollLeft = Math.max(0, (current?.x ?? 50) * 6.4 * zoom - el.clientWidth / 2); } }, [current?.y, current?.x, zoom]);
    const visited = new Set(run.visited);
    return <section className="caravan-chart" aria-label="Expedition route map">
        <div className="caravan-map-tools"><span>Chart of the Sunscar roads</span><div><button onClick={() => setZoom(z => Math.max(.8, z - .2))} aria-label="Zoom map out" disabled={zoom <= .8}>−</button><button onClick={center}>Your caravan</button><button onClick={() => setZoom(z => Math.min(1.6, z + .2))} aria-label="Zoom map in" disabled={zoom >= 1.6}>+</button></div></div>
        <div className="caravan-map-scroll" ref={scroll} tabIndex={0} aria-label="Scroll to explore the route. Select a visible stop to inspect it.">
            <div className="caravan-map-paper" style={{ width: 640 * zoom, height: height * zoom }}>
                <svg viewBox={`0 0 640 ${height}`} className="caravan-map-art" aria-hidden="true">
                    <defs><pattern id="sunscar-contours" width="160" height="120" patternUnits="userSpaceOnUse"><path d="M-40 80Q25 0 80 50T200 35M-40 90Q25 10 80 60T200 45M-40 100Q25 20 80 70T200 55" fill="none" stroke="#806438" strokeWidth="1" opacity=".13" /></pattern><linearGradient id="sunscar-map-dusk" x2="0" y2="1"><stop stopColor="#ddc394"/><stop offset=".55" stopColor="#b9986f"/><stop offset="1" stopColor="#b1b795"/></linearGradient></defs>
                    <rect width="640" height={height} fill="url(#sunscar-map-dusk)"/><rect width="640" height={height} fill="url(#sunscar-contours)"/>
                    {[0, 1, 2, 3].map(region => <g key={region} opacity=".25" transform={`translate(0 ${region * 335 + 35})`}><text x="28" y="12" fontSize="12" letterSpacing="5" fill="#463822">{['THE GOLDEN DUNES', 'SCORPION’S SPINE', 'THE OLD KINGDOM', 'THE GREEN ROAD'][region]}</text><path d="M8 180l35-72 30 55 28-83 42 90M488 140l32-90 22 35 38-45 40 95" fill="#7c6344"/><path d="M30 189q50-40 115 0m345 8q70-45 132 0" fill="none" stroke="#60482b"/></g>)}
                    {run.map.flatMap(node => node.next.map(id => {
                        const end = run.map.find(n => n.id === id)!;
                        const traveled = visited.has(node.id) && visited.has(id);
                        return <path key={`${node.id}-${id}`} d={`M${node.x * 6.4} ${node.y} C${node.x * 6.4} ${node.y + 65},${end.x * 6.4} ${end.y - 65},${end.x * 6.4} ${end.y}`} fill="none" stroke={traveled ? '#305a45' : '#6f5738'} strokeWidth={traveled ? 5 : 2} strokeDasharray={traveled ? undefined : '5 7'} opacity={node.revealed && end.revealed ? .7 : .13} />;
                    }))}
                    {run.map.filter(n => !n.revealed).map(node => <g key={node.id} opacity=".5"><circle cx={node.x * 6.4} cy={node.y} r="23" fill="#b6a282"/><text x={node.x * 6.4} y={node.y + 6} textAnchor="middle" fontSize="18" fill="#51452f">?</text></g>)}
                </svg>
                {run.map.filter(n => n.revealed).map(node => <button key={node.id} type="button"
                    className={`caravan-map-node kind-${node.kind}${visited.has(node.id) ? ' is-visited' : ''}${run.available.includes(node.id) ? ' is-available' : ''}${selected === node.id ? ' is-selected' : ''}${node.id === run.currentNodeId ? ' is-current' : ''}`}
                    style={{ left: `${node.x}%`, top: node.y * zoom }} aria-pressed={selected === node.id}
                    aria-label={`${CARAVAN_NODE_LABELS[node.kind]}, leg ${node.layer + 1}${node.id === run.currentNodeId ? ', your caravan' : visited.has(node.id) ? ', visited' : run.available.includes(node.id) ? ', connected road' : ', ahead'}`}
                    onClick={() => onSelect(node)}><span aria-hidden="true">{node.id === run.currentNodeId ? '⚑' : glyphs[node.kind]}</span><small>{CARAVAN_NODE_LABELS[node.kind]}</small></button>)}
            </div>
        </div>
        <p className="caravan-map-key"><span>● Connected road</span><span>⚑ Your caravan</span><span>? Unscouted ground</span></p>
    </section>;
}
