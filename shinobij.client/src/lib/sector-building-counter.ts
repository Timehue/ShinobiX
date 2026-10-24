export type BuildingCounterRequest={buildingId:string;interior?:()=>void;interiorLabel?:string;restriction?:string;entrance?:{sector:number;tile:number}};
const EVENT='sector-building-counter';
export function openBuildingCounter(request:BuildingCounterRequest){window.dispatchEvent(new CustomEvent<BuildingCounterRequest>(EVENT,{detail:request}));}
export function subscribeBuildingCounter(listener:(request:BuildingCounterRequest)=>void){
    const receive=(event:Event)=>listener((event as CustomEvent<BuildingCounterRequest>).detail);
    window.addEventListener(EVENT,receive);return()=>window.removeEventListener(EVENT,receive);
}
