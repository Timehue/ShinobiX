import { sectorRegionKey } from './sector-geo.js';
import type { LifeActor } from './sector-life.js';

/** Residents keep their regional identity when a road changes hands. Patrols
 * separately answer to its current holder in village-patrol.ts. */
export const LIFE_LOCAL_VILLAGES: Readonly<Record<string,string>> = {
    stormveil:'Stormveil Village',ashenleaf:'Ashen Leaf Village',moonshadow:'Moonshadow Village',frostfang:'Frostfang Village',
};
export const LIFE_LOCAL_REACTIONS = {
    home:'Good to see one of ours.',
    stormveilGuard:'Keep the crossing clear. This is a Stormveil road.',
    stormveil:"Keep your hands off the cargo. I've got my eye on you.",
    ashenleaf:"Stay on the path. I don't want you trampling the plants.",
    moonshadow:"Keep your distance. I don't know you.",
    frostfang:"Don't touch our supplies. Ask first.",
} as const;

/** Only local staff recognize a saved village. Visitors and unknown identities
 * retain their own dialogue; no service, price or combat rule is changed. */
export function localVillageReaction(sector:number,actor:LifeActor,playerVillage:unknown):LifeActor {
    const region=sectorRegionKey(sector)??'',home=LIFE_LOCAL_VILLAGES[region];
    const mine=typeof playerVillage==='string'?playerVillage.trim().toLowerCase():'';
    const shipmentGuard=sector===2&&actor.id==='shipment:guard';
    if(!home||!shipmentGuard&&!['resident:','crew:','keeper:'].some(prefix=>actor.id.startsWith(prefix))||!Object.values(LIFE_LOCAL_VILLAGES).some(v=>v.toLowerCase()===mine))return actor;
    const outsider=home.toLowerCase()!==mine;
    // Cargo/supplies warnings belong only to the painted dock and winter stores.
    const warning=shipmentGuard?LIFE_LOCAL_REACTIONS.stormveilGuard:actor.id.startsWith('keeper:')?'Mind your hands around the shrine.':region==='stormveil'&&sector!==2||region==='frostfang'&&sector!==31
        ? 'Keep your distance. I don\'t know you.' : LIFE_LOCAL_REACTIONS[region as keyof typeof LIFE_LOCAL_REACTIONS];
    const bark=outsider?warning:LIFE_LOCAL_REACTIONS.home;
    const react=(phase:NonNullable<LifeActor['phases']>[number])=>({...phase,line:`${bark} ${phase.line}`,...(phase.approach?{approach:{...phase.approach,line:`${bark} ${phase.approach.line}`}}:{}),...(phase.returnGreeting?{returnGreeting:`${bark} ${phase.returnGreeting}`}:{})});
    return {...actor,bark,line:`${bark} ${actor.line}`,...(actor.surfaceWork?{surfaceWork:{...actor.surfaceWork,fallback:{...actor.surfaceWork.fallback,line:`${bark} ${actor.surfaceWork.fallback.line}`}}}:{}),...(actor.phases?{phases:actor.phases.map(react)}:{}),...(actor.cyclePhases?{cyclePhases:actor.cyclePhases.map(react)}:{})};
}
