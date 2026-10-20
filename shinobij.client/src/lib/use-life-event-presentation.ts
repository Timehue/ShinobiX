import {useEffect,useState} from 'react';
import type {LifeSceneView} from '../../../shared/sector-life';
import {lifeEventPresentationAt} from '../../../shared/sector-life-motion';
import {serverNow} from './server-clock';
import {isCoveredByCombat,subscribeCombatCover} from './combat-cover';

/** At most one scheduled boundary, only for a loaded timed story. No polling or
 * frame loop. Hidden/combat scenes wait and catch up once on visibility return. */
export function useLifeEventPresentation(view:LifeSceneView|undefined){
 const [revision,refresh]=useState(0);
 useEffect(()=>{
  if(!view?.eventPhases?.length)return;
  let timer=0;
  const schedule=()=>{
   window.clearTimeout(timer);
   if(document.hidden||isCoveredByCombat())return;
   const now=serverNow(),next=view.eventPhases?.find(phase=>phase.at>now);
   if(next)timer=window.setTimeout(()=>refresh(v=>v+1),Math.max(1,next.at-now+5));
  };
  const visibility=()=>{window.clearTimeout(timer);if(!document.hidden&&!isCoveredByCombat())refresh(v=>v+1);};
  schedule();document.addEventListener('visibilitychange',visibility);const stop=subscribeCombatCover(visibility);
  return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);stop();};
 },[view,revision]);
 if(!view)return;
 const current=lifeEventPresentationAt(view,serverNow());
 return {...current,label:`${current.title}: ${current.phase==='active'?current.task:current.description}`};
}
