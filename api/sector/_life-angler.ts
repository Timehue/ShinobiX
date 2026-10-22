import {kv} from '../_storage.js';
import {withKvLock} from '../_lock.js';
import {currentWorkingAngler,nextAnglerState,anglerWorkRoutine} from '../../shared/sector-angler-work.js';

export const anglerWorkKey=(sector:number)=>`world:angler-work:${sector}`;
/** A bounded cosmetic actor record, independent of event progress and economy.
 * A late observation cannot undo a newer weather transition. Stable polls do
 * not restart walks or renew the clock. */
export async function refreshAnglerWork(sector:number,now:number,weather:string) {
    const work=currentWorkingAngler(sector,now);if(!work)return;
    const key=anglerWorkKey(sector);
    return withKvLock(key,async()=>{
        const raw=await kv.get(key),next=nextAnglerState(sector,raw,now,weather,work);
        if(JSON.stringify(next)!==JSON.stringify(raw)&&!await kv.compareSet(key,raw,next,{ex:86_400}))throw new Error('The fishing routine changed. Check the sector again.');
        return anglerWorkRoutine(sector,next,now,work);
    },{failClosed:true});
}
