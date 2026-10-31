import { useContext, useState, useEffect, useRef } from 'react';
import type { Biome } from '../types/core';
import type { LifeActor } from '../../../shared/sector-life';
import type { SectorTracesView } from '../lib/sector-traces';
import { useSectorLife } from '../lib/use-sector-life';
import { setSectorLifePainting,setSectorGroundMarks } from '../lib/sector-life-art';
import {setSectorServiceRoutine} from '../lib/sector-service-routine';
import { serverNow } from '../lib/server-clock';
import { WorldPlayerPosition } from '../lib/world-player-position';
import { SectorWanderer } from './SectorWanderer';
import { Modal } from './ui/Modal';
import { SceneCritters } from './SceneCritters';
import { SectorTracesCard } from './SectorTraces';
import { lifeActivityAt,lifeActorPosition } from '../../../shared/sector-life-motion';
import {lifeWorkMarker} from '../lib/life-work-marker';
import {useLifeEventPresentation} from '../lib/use-life-event-presentation';
import type { VersionedCharacterCommit } from '../types/character';
import { gameToast } from './GameToast';
import { lifeActorOffersWork, lifeRewardHint } from '../../../shared/sector-life-rewards';
import './sector-life.css';

function readMeetings(player: string): string[] { try { const value = JSON.parse(localStorage.getItem(`sector-life-met:${player.toLowerCase()}`) ?? '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0,4) : []; } catch { return []; } }

/** Established road figures carry the new life; fixed scenery belongs in the sector painting. */
export function SectorLife({ sector, player, tile, biome, traces, openReports,onTrack, walk, commit }: {
    sector: number; player: string; tile: number; biome: Biome; traces?: SectorTracesView | null;
    openReports?: (view:'signs'|'shrine')=>void; walk: (sector: number, tile: number) => void;
    onTrack?:(wanderer:import('../../../shared/wanderer-roster').Wanderer)=>void;
    commit?: VersionedCharacterCommit;
}) {
    const worldPosition = useContext(WorldPlayerPosition);
    const life = useSectorLife(player, sector);
    const [met, setMet] = useState(() => readMeetings(player));
    const [panel, setPanel] = useState<'event' | 'memory' | LifeActor | null>(null);
    const [busy, setBusy] = useState(false);
    const [destination, setDestination] = useState<number | null>(null);
    const walkRef=useRef(walk); useEffect(()=>{walkRef.current=walk;},[walk]);
    useEffect(()=>{
        if(destination===null||panel!==null)return;
        let frame=0,tries=0;
        const approach=()=>{
            if(document.querySelector('[aria-modal=true],dialog[open]')) { if(++tries<120)frame=requestAnimationFrame(approach); return; }
            walkRef.current(sector,destination);setDestination(null);
        };
        frame=requestAnimationFrame(approach);return()=>cancelAnimationFrame(frame);
    },[destination,panel,sector]);
    const view = life.view;
    const event=useLifeEventPresentation(view);
    useEffect(()=>{if(view){setSectorLifePainting(sector,view.painting,view.awayTracker,view.paintingUntil,view.paintingNext);setSectorServiceRoutine(sector,view.service);}},[sector,view]);
    useEffect(()=>{if(view?.groundScars||view?.groundTrail||traces?.sector===sector)setSectorGroundMarks(sector,view?.groundScars??traces?.scars??[],serverNow(),view?.groundTrail);},[sector,traces,view]);
    const actors = (view?.actors ?? []).map(actor => met.includes(actor.traveler ?? '') ? {...actor,...(actor.returnGreeting?{line:actor.returnGreeting}:{}),phases:actor.phases?.map(phase=>phase.returnGreeting?{...phase,line:phase.returnGreeting}:phase)} : actor);
    const meet = (actor: LifeActor,presentation?:Pick<LifeActor,'activity'|'line'>) => {
        setPanel({...actor,...(presentation??lifeActivityAt(actor,serverNow()))});
        if (!actor.traveler || met.includes(actor.traveler)) return;
        const next = [...met, actor.traveler].slice(-4); setMet(next);
        try { localStorage.setItem(`sector-life-met:${player.toLowerCase()}`, JSON.stringify(next)); } catch { /* Cosmetic recognition remains available this session. */ }
    };
    const actual = worldPosition?.current;
    const point = actual?.sector === sector ? actual : { col: tile % 12, row: Math.floor(tile/12) };
    const near = event && Math.hypot(point.col - event.tile % 12, point.row - Math.floor(event.tile / 12)) <= 1.9;
    const marker=lifeWorkMarker(event?.tile??tile,point,actors.map(actor=>lifeActorPosition(sector,actor,serverNow())));
    const currentPanel = typeof panel === 'object' ? panel : null;
    const showEvent = panel === 'event' || (event && lifeActorOffersWork(currentPanel?.id,event));
    return <>
        <SceneCritters biome={biome} density={.5} sector={sector} discovery={view?.wildlife} className="sector-life-wildlife" />
        {sector===31&&<span data-painted-name-clearance aria-hidden="true" style={{position:'absolute',left:`${434/1024*100}%`,top:`${718/1024*100}%`,width:`${148/1024*100}%`,height:`${122/1024*100}%`,pointerEvents:'none'}}/>}
        {actors.map(actor => <SectorWanderer key={actor.traveler||actor.id.startsWith('pilgrim:')?`${actor.id}:${actor.motion?.start??0}`:actor.id.startsWith('courier:')?`${actor.id}:${view?.window}`:actor.id} wanderer={actor.wanderer} routine={actor} sector={sector} playerIndex={tile} biome={biome} onEngage={(_wanderer,presentation) => meet(actor,presentation)} />)}
        {event&&marker.tether&&<svg data-work-marker-tether aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:7}}><line x1={`${marker.tether.x1}%`} y1={`${marker.tether.y1}%`} x2={`${marker.tether.x2}%`} y2={`${marker.tether.y2}%`} stroke="#eee0b1" strokeWidth="1" opacity=".65"/></svg>}
        {event && <button type="button" className={`sector-life-point life-${event.phase}`} style={marker.style}
            onClick={() => setPanel('event')} aria-label={event.label} title={event.title}>
            <span aria-hidden="true" style={{display:'inline-block',transform:`rotate(${marker.offscreen?marker.angle:0}rad)`}}>{marker.offscreen?'➤':'◇'}</span>
        </button>}
        <Modal open={panel !== null} onClose={() => setPanel(null)} size="sm" title={panel === 'event' ? event?.title : panel === 'memory' ? 'Local reports' : currentPanel?.name}>
            <div className="sector-life-dialog">
                {currentPanel && <><p className="sector-life-task">{currentPanel.activity}</p><p>“{currentPanel.line}”</p></>}
                {showEvent && event && <>
                    <p>{event.description}</p>
                    {event.phase === 'active' && <><p className="sector-life-task">{event.task}</p>
                        <p className="sector-life-help">{lifeRewardHint(event)}</p>
                        <button type="button" disabled={busy||near&&event.waiting} onClick={async () => {
                            if (!near) { setDestination(event.tile); setPanel(null); return; }
                            if(event.kind==='tracks'&&event.step===1&&event.tracker){setPanel(null);onTrack?.(event.tracker);return;}
                            setBusy(true); try {
                                const result=await life.act(event);
                                if(result.ok&&result.character&&commit?.(result.character,result._saveVersion)&&result.reward?.ryo)gameToast(`${event.title}: +${result.reward.ryo} Ryō`);
                            } finally { setBusy(false); }
                        }}>{busy ? 'Working…' : near ? event.action : 'Walk to the work point'}</button></>}
                    {event.contributors.length > 0 && <p className="sector-life-help">Helped by {event.contributors.join(', ')}.</p>}
                    {traces && <button type="button" onClick={() => setPanel('memory')}>Read local reports</button>}
                    {life.error && <p role="status">{life.error}</p>}
                </>}
                {panel === 'memory' && <SectorTracesCard traces={traces&&view?.groundScars?{...traces,scars:[...view.groundScars]}:traces??null} onOpenSigns={()=>{setPanel(null);openReports?.('signs');}} onOpenShrine={()=>{setPanel(null);openReports?.('shrine');}} />}
            </div>
        </Modal>
    </>;
}
