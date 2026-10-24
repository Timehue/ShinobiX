import { useEffect, useRef, useState } from 'react';
import type { BuildingAction, BuildingReceipt } from '../../../shared/sector-building-types';
import { isPlayableWildSector } from '../../../shared/sector-geo';
import type { VersionedCharacterCommit } from '../types/character';
import { requestBuildings } from './sector-building-api';
import { isCoveredByCombat, subscribeCombatCover } from './combat-cover';
import { mergeBuildingView, type BuildingCache } from './sector-building-cache';

export function useSectorBuildings(player:string,sector:number,commit:VersionedCharacterCommit){
    const[entry,setEntry]=useState<BuildingCache>({player,details:{},version:-1});
    const[error,setError]=useState(''),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState<BuildingReceipt>(),[retryable,setRetryable]=useState(false);
    const pending=useRef<{player:string;action:BuildingAction}|null>(null),live=useRef({player,sector,commit}),mounted=useRef(true),inFlight=useRef(false);
    useEffect(()=>{live.current={player,sector,commit};},[player,sector,commit]);
    useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
    const accept=(view:NonNullable<Awaited<ReturnType<typeof requestBuildings>>['view']>,name:string)=>setEntry(old=>mergeBuildingView(old,view,name));
    useEffect(()=>{
        if(!isPlayableWildSector(sector)&&sector!==99)return;
        let alive=true,timer=0,revision=0,pendingRead:AbortController|undefined;
        const stop=()=>{revision++;clearTimeout(timer);pendingRead?.abort();};
        const load=async()=>{
            if(!alive||document.hidden||isCoveredByCombat())return;
            const request=++revision;pendingRead=new AbortController();
            try{const result=await requestBuildings(player,sector,pendingRead.signal);if(alive&&request===revision&&result.ok&&result.view)accept(result.view,player);}catch{/* Scene removal cancels quietly. */}
            if(alive&&request===revision&&!document.hidden&&!isCoveredByCombat())timer=window.setTimeout(load,20_000);
        };
        const visibility=()=>{stop();if(!document.hidden&&!isCoveredByCombat())void load();};
        document.addEventListener('visibilitychange',visibility);const unsubscribe=subscribeCombatCover(visibility);void load();
        return()=>{alive=false;stop();unsubscribe();document.removeEventListener('visibilitychange',visibility);};
    },[player,sector]);
    async function send(action:BuildingAction){
        if(inFlight.current)return false;inFlight.current=true;setBusy(true);setError('');pending.current={player:live.current.player,action};setRetryable(true);
        const owner=live.current;
        try{
            const result=await requestBuildings(owner.player,owner.sector,undefined,action);
            if(!mounted.current||live.current.player!==owner.player)return false;
            if(!result.ok){setError(result.error??'The counter book could not be updated.');if(!result.retryable){pending.current=null;setRetryable(false);}return false;}
            if(result.character)owner.commit(result.character,result._saveVersion);
            if(result.view)accept(result.view,owner.player);
            if(result.receipt)setReceipt(result.receipt);pending.current=null;setRetryable(false);return true;
        }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
    }
    return{details:entry.player===player?entry.details:{},progress:entry.player===player?entry.progress:undefined,work:entry.player===player?entry.work:undefined,activeBuilding:entry.player===player?entry.activeBuilding:undefined,error,busy,receipt,
        retryable,
        act:(action:Omit<BuildingAction,'requestId'>)=>send({...action,requestId:crypto.randomUUID()}),
        retry:()=>pending.current?.player===live.current.player?send(pending.current.action):Promise.resolve(false),
        async inspect(targetSector:number){
            const result=await requestBuildings(player,targetSector);if(mounted.current&&live.current.player===player){if(result.ok&&result.view){accept(result.view,player);setError('');}else setError(result.error??'The counter book is unavailable.');}
        },
    };
}
