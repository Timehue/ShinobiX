import {clanWarViewerCache as viewerCache} from './clan-war-cache-state';
import type {CwWar} from './clan-war-api';

// Coalesce simultaneous pollers only for the same captured viewer.
let inFlight:{viewer:number;promise:Promise<CwWar[]>}|null=null;
export async function listClanWars(viewer:number):Promise<CwWar[]> {
    if(inFlight?.viewer===viewer)return inFlight.promise;
    const promise=(async()=>{
        try {
            const response=await fetch('/api/clan/war/list');
            if(!response.ok)return [];
            const data=await response.json() as {wars?:CwWar[]};
            if(!viewerCache.current(viewer))return [];
            return (data.wars??[]).map(war=>viewerCache.accept(war,viewer)!);
        }catch{return [];}
    })();
    inFlight={viewer,promise};
    try{return await promise;}
    finally{if(inFlight?.promise===promise)inFlight=null;}
}
