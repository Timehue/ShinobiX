import {memo,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import type {Character} from '../types/character';
import type {Pet} from '../types/pet';
import {petPortraitImage} from '../lib/pet-battle-anim';
import {SectorPortrait} from './SectorPortrait';
import {serverNow} from '../lib/server-clock';
import {isCoveredByCombat} from '../lib/combat-cover';
import {sectorGroundMarks} from '../lib/sector-life-art';
import {layoutWandererLabels} from '../lib/wanderer-label-layout';
import {sectorMarkerBox} from '../lib/sector-marker';
import {figureGroundPosition,observeFigureGroundPositions} from '../lib/figure-ground-position';
import {WorldCompanionMotion,worldCompanionPet,type WorldCompanionChannel,type WorldCompanionFrame} from '../lib/world-pet-companion';
import './world-pet-companion.css';

/** One actual owned companion, using existing static pet art and native figures.
 * Rendering rides the world's existing frame; no pet simulation runs offscreen. */
export function WorldPetCompanion({character,sharedImages,channelRef,suspended}:{character?:Character;sharedImages:Record<string,string>;channelRef:WorldCompanionChannel;suspended?:boolean}){
    const pet=worldCompanionPet(character,serverNow());
    return pet?<FollowingPet key={pet.id} pet={pet} src={petPortraitImage(pet,sharedImages)} channelRef={channelRef} suspended={suspended}/>:null;
}
const FollowingPet=memo(function FollowingPet({pet,src,channelRef,suspended}:{pet:Pet;src:string;channelRef:WorldCompanionChannel;suspended?:boolean}){
    const figure=useRef<HTMLDivElement>(null),sprite=useRef<HTMLSpanElement>(null),latest=useRef({pet,suspended});
    const [noticing,setNoticing]=useState(false);
    useLayoutEffect(()=>{latest.current={pet,suspended};},[pet,suspended]);
    useLayoutEffect(()=>{
        const motion=new WorldCompanionMotion();let previous=false,lastStyle='',lastSize=0,labelAt=0;
        const stopReading=observeFigureGroundPositions();
        let figures:HTMLElement[]=[],scanAt=0;
        const media=matchMedia('(prefers-reduced-motion: reduce)');let reduced=media.matches;
        const preference=()=>{reduced=media.matches;labelAt=0;};media.addEventListener('change',preference);
        const step=(frame:WorldCompanionFrame)=>{
            const node=figure.current;if(!node)return;
            if(frame.paused||document.hidden||latest.current.suspended||isCoveredByCombat()){node.style.visibility='hidden';return;}
            if(frame.now>=scanAt){figures=[...node.parentElement!.querySelectorAll<HTMLElement>('.sector-wanderer-figure:not(.world-pet-companion)')];scanAt=frame.now+250;}
            const occupied=figures.filter(figure=>figure.isConnected&&figure.style.visibility!=='hidden').flatMap(figure=>{
                const p=figureGroundPosition(figure);return p?[{x:frame.chunk.x+p.col+.5,y:frame.chunk.y+p.row+.5}]:[];
            });
            const pose=motion.step({...frame,occupied},sectorGroundMarks(frame.sector),serverNow());
            node.style.visibility=pose.visible?'visible':'hidden';if(!pose.point)return;
            const x=(pose.point.x-frame.chunk.x)*frame.tilePx,y=(pose.point.y-frame.chunk.y)*frame.tilePx;
            const transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;
            if(transform!==lastStyle){node.style.transform=transform;lastStyle=transform;node.dataset.worldX=String(pose.point.x);node.dataset.worldY=String(pose.point.y);}
            if(frame.tilePx!==lastSize){const size=sectorMarkerBox(frame.tilePx);node.style.width=`${size.w}px`;node.style.height=`${size.h}px`;lastSize=frame.tilePx;}
            node.classList.toggle('is-walking',pose.moving&&!reduced);
            sprite.current?.style.setProperty('--face',String(pose.facing));
            if(previous!==pose.noticing){previous=pose.noticing;setNoticing(pose.noticing);}
            if(frame.now>=labelAt){layoutWandererLabels(node);labelAt=frame.now+(reduced?200:32);}
        };
        channelRef.current=step;return()=>{stopReading();media.removeEventListener('change',preference);if(channelRef.current===step)channelRef.current=null;};
    },[channelRef]);
    useLayoutEffect(()=>{if(figure.current)layoutWandererLabels(figure.current);},[noticing]);
    return <div ref={figure} className="sector-avatar-figure sector-wanderer-figure world-pet-companion" role="img"
        aria-label={`${pet.name}, your companion${noticing?', noticing nearby tracks':''}`} data-companion-id={pet.id} data-companion-state={noticing?'noticing':'following'}
        style={{'--marker-ring':'#aad5ba',visibility:'hidden'} as CSSProperties}>
        <span className="sector-avatar-shadow"/><span ref={sprite} className="sector-avatar-sprite"><span className="sector-avatar-body">
            <SectorPortrait key={src} src={src} name={pet.name} hideInitialsOnLoad/><span className="sector-avatar-pin"/>
        </span></span><span className="sector-wanderer-label">{pet.name}{noticing?' · Tracks':''}</span>
    </div>;
});
