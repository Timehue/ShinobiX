/** Full painted floors. Never render the rejected prop/character atlases over terrain. */
import type { SectorScar } from '../../../shared/sector-scars';
import type { GroundTrail } from '../../../shared/sector-life-courier';
import { serverNow } from './server-clock';
import type {LifePaintingNext} from '../../../shared/sector-dock-shipment';
const paintings:Record<number,string>={2:'north-docks-work-stop-v1',4:'tide-dormant-shrine-v1',15:'heartwood-dormant-shrine-v1',23:'moonwell-dormant-shrine-v1',31:'frostveil-dormant-shrine-supply-v2',42:'midlands-herb-tea-stop-v2',52:'festival-tea-counter-packed-v1',55:'hollow-road-gear-v1',60:'lavafront-road-gear-v1',44:'ancients-dormant-shrine-v1',56:'hollowgate-dormant-shrine-v1'};
const states=new Map<number,{key?:string;away?:string;until?:number;next?:LifePaintingNext}>();let revision=0,paintingExpiry=Infinity;
export const sectorTrackerAway=(sector:number,id:string)=>states.get(sector)?.away===id;
const marks=new Map<number,{tile:number;fade:number;seed:number;direction?:number;until:number;worked?:boolean}[]>();let groundRevision=0,nextExpiry=Infinity;
export function sectorGroundRevision(now=serverNow()) {
    if(now>=nextExpiry){groundRevision++;nextExpiry=Infinity;for(const [sector,old] of marks){const next=old.filter(mark=>mark.until>now);marks.set(sector,next);for(const mark of next)nextExpiry=Math.min(nextExpiry,mark.until);}}
    return groundRevision;
}
export const sectorGroundMarks=(sector:number)=>marks.get(sector)??[];
export function setSectorGroundMarks(sector:number,scars:readonly SectorScar[],now:number,trail:GroundTrail=[]) {
    const next=[...scars.filter(s=>Number.isInteger(s.tile)&&s.tile!>=0&&s.tile!<144&&s.at<=now&&now-s.at<86_400_000).slice(0,6)
        .map(s=>({tile:s.tile!,seed:s.at,fade:1-Math.floor((now-s.at)/21_600_000)/4,until:s.at+86_400_000})),...trail.slice(0,12).filter(([tile,,until])=>Number.isInteger(tile)&&tile>=0&&tile<144&&(until===undefined||Number.isSafeInteger(until)&&until>now)).map(([tile,direction,until])=>({tile,direction,seed:until??0,fade:.85,worked:until!==undefined,until:until??now+60_000}))];
    if(JSON.stringify(next)===JSON.stringify(marks.get(sector)??[]))return;
    marks.set(sector,next);for(const mark of next)nextExpiry=Math.min(nextExpiry,mark.until);groundRevision++;
}
export const sectorLifePaintingRevision=()=>{
    const now=serverNow();if(now>=paintingExpiry){paintingExpiry=Infinity;for(const state of states.values()){
        if(state.next&&state.next.at<=now){state.key=state.next.key;state.until=state.next.until;state.next=undefined;revision++;}
        if(state.until!==undefined){if(state.until<=now){state.key=undefined;state.until=undefined;revision++;}else paintingExpiry=Math.min(paintingExpiry,state.until);}
        if(state.next)paintingExpiry=Math.min(paintingExpiry,state.next.at);
    }}
    return revision;
};
export function setSectorLifePainting(sector:number,key?:string,away?:string,until?:number,next?:LifePaintingNext) {
    // A fresh authoritative poll also permits a failed image to retry once.
    revision++;
    states.set(sector,{key:until!==undefined&&until<=serverNow()?undefined:key,away,until,next});
    if(until!==undefined)paintingExpiry=Math.min(paintingExpiry,until);
    if(next)paintingExpiry=Math.min(paintingExpiry,next.at);
}
export function sectorLifePainting(sector: number,base=false): string | undefined {
    sectorLifePaintingRevision();
    const key=base&&[52,55,60].includes(sector)?undefined:base&&sector===42?(states.get(sector)?.key==='midlands-herb-chronicle-table-v2'?'midlands-chronicle-table-v1':'midlands-tea-stop-v1'):(!base&&states.get(sector)?.key)||paintings[sector];
    return key ? `/sector-life/${key}.webp` : undefined;
}
