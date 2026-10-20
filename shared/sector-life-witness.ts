import type { LifeActor } from './sector-life.js';
import { lifeActorPosition } from './sector-life-motion.js';
import { isWalkableTile } from './sector-walk-mask.js';
import { SCAR_TTL_MS,type SectorScar,type DuelWitness } from './sector-scars.js';

const persistent=(id:string,sector:number)=>/^(resident:\d+|crew:\d+:[01]|keeper:\d+|tetsu|nao|gen|sumi)$/.test(id)&&(!id.includes(':')||Number(id.split(':')[1])===sector);
/** Conservative sightline: nearby open cells only. Trees, walls and roofs block
 * it; a short path around a corner does not prove someone saw the fight. */
export function clearDuelView(sector:number,fight:number,observer:number) {
    if(!isWalkableTile(sector,fight)||!isWalkableTile(sector,observer))return false;
    const x=fight%12,y=Math.floor(fight/12),dx=observer%12-x,dy=Math.floor(observer/12)-y;
    if(Math.hypot(dx,dy)>2.5)return false;
    let px=x,py=y;
    for(let i=0;i<=20;i++){
        const nx=Math.round(x+dx*i/20),ny=Math.round(y+dy*i/20);
        if(!isWalkableTile(sector,ny*12+nx)||nx!==px&&ny!==py&&(!isWalkableTile(sector,py*12+nx)||!isWalkableTile(sector,ny*12+px)))return false;
        px=nx;py=ny;
    }
    return true;
}
export function sealLifeWitnesses(sector:number,tile:number,actors:readonly LifeActor[],at:number):DuelWitness[] {
    return actors.filter(actor=>persistent(actor.id,sector)).flatMap(actor=>{
        const point=lifeActorPosition(sector,actor,at),observer=Math.round(point.row)*12+Math.round(point.col);
        const distance=Math.hypot(point.col-tile%12,point.row-Math.floor(tile/12));
        return distance<=2.25&&clearDuelView(sector,tile,observer)?[{id:actor.id,name:actor.name,tile:observer,at,distance}]:[];
    }).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id)).slice(0,2).map(({distance:_,...witness})=>witness);
}
export function parseDuelWitnesses(raw:unknown,sector:number,tile:number|undefined,settledAt:number,now:number):DuelWitness[] {
    if(!Array.isArray(raw)||tile===undefined)return [];
    const seen=new Set<string>();
    return raw.filter((v):v is DuelWitness=>!!v&&typeof v.id==='string'&&persistent(v.id,sector)&&typeof v.name==='string'&&!!v.name.trim()
        &&Number.isSafeInteger(v.at)&&v.at>0&&v.at<=settledAt&&v.at<=now&&now-v.at<SCAR_TTL_MS
        &&Number.isInteger(v.tile)&&clearDuelView(sector,tile,v.tile)&&!seen.has(v.id)&&!!seen.add(v.id)).slice(0,2)
        .map(v=>({id:v.id,name:v.name.trim().slice(0,40),tile:v.tile,at:v.at}));
}
export const LIFE_WITNESS_BARK='I saw a fight near here.';
export const lifeWitnessLine=(scar:SectorScar)=>scar.fallen?`I saw ${scar.victor} and ${scar.fallen} fighting near here.`:`I saw ${scar.victor} fighting near here.`;
/** Memories belong to people who were actually present, not newly spawned
 * visitors sharing a generic role. Leaving does not transfer the memory. */
export function rememberLifeWitness(actor:LifeActor,scars:readonly SectorScar[],now:number):LifeActor {
    const scar=scars.filter(s=>s.at<=now&&now-s.at<SCAR_TTL_MS&&s.witnesses?.some(w=>w.id===actor.id&&w.name===actor.name&&w.at<=s.at&&w.at<=now&&now-w.at<SCAR_TTL_MS)).sort((a,b)=>b.at-a.at)[0];
    if(!scar)return actor;
    const line=lifeWitnessLine(scar);
    const append=(text:string)=>text.endsWith(line)?text:`${text} ${line}`;
    const memory=(phase:NonNullable<LifeActor['phases']>[number])=>({...phase,line:append(phase.line),...(phase.returnGreeting?{returnGreeting:append(phase.returnGreeting)}:{}),...(phase.approach?{approach:{...phase.approach,line:append(phase.approach.line)}}:{})});
    return {...actor,bark:LIFE_WITNESS_BARK,line:append(actor.line),...(actor.surfaceWork?{surfaceWork:{...actor.surfaceWork,fallback:{...actor.surfaceWork.fallback,line:append(actor.surfaceWork.fallback.line)}}}:{}),...(actor.returnGreeting?{returnGreeting:append(actor.returnGreeting)}:{}),...(actor.phases?{phases:actor.phases.map(memory)}:{}),...(actor.cyclePhases?{cyclePhases:actor.cyclePhases.map(memory)}:{})};
}
