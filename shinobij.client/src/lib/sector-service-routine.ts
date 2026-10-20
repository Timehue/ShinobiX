import {useSyncExternalStore} from 'react';
import type {AnglerRoutine} from '../../../shared/sector-angler-work';
import {currentWandererDayBucket} from './wanderers';
const states=new Map<number,readonly[number,AnglerRoutine|null]>(),listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const idle=()=>()=>{};
/** Snapshot object identity stays stable between actual routine changes. */
export function setSectorServiceRoutine(sector:number,routine?:AnglerRoutine) {
    const next=[currentWandererDayBucket(),routine??null] as const;if(JSON.stringify(states.get(sector))===JSON.stringify(next))return;
    states.set(sector,next);for(const notify of listeners)notify();
}
export function useSectorServiceRoutine(sector:number,id:string,enabled:boolean) {
    const cached=useSyncExternalStore(enabled?subscribe:idle,()=>enabled?states.get(sector):null,()=>null);
    const current=cached?.[0]===currentWandererDayBucket()?cached[1]:undefined;
    return current===undefined?undefined:current?.id===id?current:null;
}
