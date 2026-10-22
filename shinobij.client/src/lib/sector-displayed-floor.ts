/** The decoded floor last fully drawn by a world renderer, including image
 * fallbacks. Cosmetic habitat cues follow visible terrain, not an API promise. */
const floors=new Map<number,{owner:object;source:string}>();
const listeners=new Map<number,Set<()=>void>>();
export const displayedSectorFloor=(sector:number)=>floors.get(sector)?.source;
export function recordDisplayedSectorFloor(owner:object,sector:number,source:string){
    const old=floors.get(sector);if(old?.owner===owner&&old.source===source)return;
    floors.set(sector,{owner,source});for(const notify of listeners.get(sector)??[])notify();
}
export function forgetDisplayedSectorFloor(owner:object,sector:number){
    if(floors.get(sector)?.owner!==owner)return;
    floors.delete(sector);for(const notify of listeners.get(sector)??[])notify();
}
export function forgetDisplayedFloors(owner:object){for(const [sector,floor] of floors)if(floor.owner===owner)forgetDisplayedSectorFloor(owner,sector);}
export function subscribeDisplayedSectorFloor(sector:number,notify:()=>void){
    let set=listeners.get(sector);if(!set){set=new Set();listeners.set(sector,set);}set.add(notify);
    return()=>{set.delete(notify);if(!set.size)listeners.delete(sector);};
}
