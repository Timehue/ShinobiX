import {walkPath,pathInMask,sectorWalkMask} from './sector-walk-mask.js';
import type {LifeActor,LifeEventState} from './sector-life.js';
import {lifeActivityAt,type LifeEventPhase} from './sector-life-motion.js';

export const DOCK_SHIPMENT_SECTOR=2;
export const DOCK_SHIPMENT_SCENARIO='dock-shipment-v1' as const;
export const DOCK_SHIPMENT_SITES=Object.freeze({merchant:67,guard:69,inspect:68,cargo:56,dock:100,worker:113,meet:101,guardExit:71,merchantExit:5,merchantEntry:71,guardEntry:5});
/** Reviewed paved resting places; the old shore-edge camp is not a standing spot. */
export const DOCK_TRAVELER_REST_TILES=[125,89,77,65,66,101] as const;
export const DOCK_SHIPMENT_PACK_MS=6000,DOCK_SHIPMENT_UNLOAD_MS=5000,DOCK_SHIPMENT_REST_MS=90_000,DOCK_SHIPMENT_STEP_MS=3000;
export const DOCK_SHIPMENT_PAINTINGS={spilled:'north-docks-shipment-spilled-v1',delivered:'north-docks-shipment-delivered-v1'} as const;
export type LifePaintingNext={at:number;key:string;until:number};
export const DOCK_SHIPMENT_LINES={
 title:'A shipment held up',
 intro:'Wrapped bundles have fallen beside the road. A merchant and a guard are waiting near them.',
 arrivingIntro:'Wrapped bundles have fallen beside the road. Mina and the crossing guard are coming back to them.',
 waitArrival:'Wait for Mina and the crossing guard to reach the fallen bundles.',
 inspected:'The wrappings are intact. Mina has a spare strap and needs help holding the bundles steady.',
 waiting:'Mina is taking the secured bundles to the dock loading point. Meet her there.',
 delivered:'The bundles are on the dock crates. Mina is checking them with the dockhand.',
 complete:'The recovered shipment is at the dock loading point.',
 departed:'The recovered shipment is at the loading point. Mina has continued along the road.',
 unattended:'Mina is collecting the bundles without help, then taking them to the docks.',
 unattendedCarrying:'Mina is taking the bundles to the docks without help.',
 unloadingReport:'Mina is unloading at the dock crates. Wait while she sets the bundles down.',
 unhelpedDelivery:'Mina brought the bundles to the loading point without help.',
 merchantWaiting:"The strap snapped at the turn. I need room to tie these bundles together.",
 merchantArriving:"I'm going back for the bundles that fell at the turn.",
 guardArriving:"I'm going down to the bundles beside the crossing.",
 guardWaiting:"Mina, keep them off the paving. People still need to get through.",
 merchantInspected:"I have a spare strap. Hold the bundles steady while I fasten it.",
 guardInspected:"That will hold them together. Take them to the loading point when you're ready.",
 merchantPacking:"I'm fastening the strap around the bundles before I move them.",
 merchantCarrying:"I'm taking the bundles to the dock loading point.",
 merchantUnloading:"I'm putting the bundles on the dock crates.",
 merchantDelivered:"The shipment is here. I'm checking the bundles before I go on.",
 merchantThanks:"Thanks for helping with the shipment. The bundles are here on the dock crates.",
 merchantAlone:"I brought the bundles back myself. I'll check them here before I go on.",
 merchantLeaving:"The bundles are at the loading point. I'm carrying on along the road.",
 guardLeaving:"The paving is clear. I'm going back to the crossing.",
 workerWaiting:"I'll leave this space clear while Mina brings the bundles down.",
 workerReceiving:"Mina's bundles are here. I'll keep them on the dock crates.",
 workerAfter:"The recovered shipment is on the dock crates.",
 workerReset:"I'm checking the dock stores.",
 news:'Mina brought a recovered shipment to the dock loading point.',
 ended:'That shipment round has ended.',
 pastDelivery:'Mina brought the recovered shipment to the dock loading point. That round has ended.',
 pastUnhelped:'Mina recovered the shipment without help. That round has ended.',
};

/** A content version prevents completed legacy route-check rows from inventing
 * a delivery. The first real action migrates the row under its existing CAS. */
export function normalizeDockShipmentState(state:LifeEventState):LifeEventState{
 if(state.scenario!==DOCK_SHIPMENT_SCENARIO)return {...state,step:0,updatedAt:0,contributors:[],scenario:DOCK_SHIPMENT_SCENARIO,shipmentAt:undefined,hunt:undefined};
 if(state.step>=2&&state.shipmentAt===undefined)return {...state,step:0,updatedAt:0,contributors:[],shipmentAt:undefined,hunt:undefined};
 if(state.step<2&&state.shipmentAt!==undefined)return {...state,shipmentAt:undefined,hunt:undefined};
 return state.hunt?{...state,hunt:undefined}:state;
}
const outbound=walkPath(2,DOCK_SHIPMENT_SITES.merchant,DOCK_SHIPMENT_SITES.dock)!;
const onward=walkPath(2,DOCK_SHIPMENT_SITES.dock,DOCK_SHIPMENT_SITES.merchantExit)!;
const guardPath=walkPath(2,DOCK_SHIPMENT_SITES.guard,DOCK_SHIPMENT_SITES.guardExit)!;
const merchantEntry=walkPath(2,DOCK_SHIPMENT_SITES.merchantEntry,DOCK_SHIPMENT_SITES.merchant)!;
const guardClearance:readonly number[]=[DOCK_SHIPMENT_SITES.merchant,DOCK_SHIPMENT_SITES.cargo];
const guardMask=sectorWalkMask(2)!.map((row,y)=>[...row].map((cell,x)=>guardClearance.includes(y*12+x)?'#':cell).join(''));
const guardEntry=pathInMask(guardMask,DOCK_SHIPMENT_SITES.guardEntry,DOCK_SHIPMENT_SITES.guard)!;
const workerPath=walkPath(2,DOCK_SHIPMENT_SITES.dock,DOCK_SHIPMENT_SITES.worker)!;
export const DOCK_SHIPMENT_MEET_MS=Math.max(merchantEntry.length-1,guardEntry.length-1)*DOCK_SHIPMENT_STEP_MS;
export const DOCK_SHIPMENT_DELIVERY_MS=DOCK_SHIPMENT_PACK_MS+(outbound.length-1)*DOCK_SHIPMENT_STEP_MS+DOCK_SHIPMENT_UNLOAD_MS;
export function dockShipmentPlan(state:LifeEventState,windowMs:number,activeMs:number){
 const helped=state.shipmentAt!==undefined,start=state.shipmentAt??state.window*windowMs+activeMs;
 const walkingAt=start+DOCK_SHIPMENT_PACK_MS,arrivesAt=walkingAt+(outbound.length-1)*DOCK_SHIPMENT_STEP_MS;
 const deliveredAt=arrivesAt+DOCK_SHIPMENT_UNLOAD_MS,leavesAt=deliveredAt+DOCK_SHIPMENT_REST_MS;
 return {helped,start,walkingAt,arrivesAt,deliveredAt,leavesAt,enteredAt:state.window*windowMs,meetAt:state.window*windowMs+DOCK_SHIPMENT_MEET_MS,hideAt:leavesAt+(onward.length-1)*DOCK_SHIPMENT_STEP_MS+1500,
  guardLeavesAt:start+1500,guardHideAt:start+1500+(guardPath.length-1)*DOCK_SHIPMENT_STEP_MS+1500,end:(state.window+1)*windowMs};
}
export function dockShipmentEvent(state:LifeEventState,now:number,windowMs:number,activeMs:number){
 const p=dockShipmentPlan(state,windowMs,activeMs),unattended=!p.helped&&now>=p.start;
 const waiting=state.step===1&&now<p.meetAt||state.step===2&&now<p.deliveredAt;
 const delivered=now>=p.deliveredAt;
 const phase=state.step===3?'aftermath' as const:unattended?'unattended' as const:'active' as const;
 const description=delivered?p.helped?(now>=p.hideAt?DOCK_SHIPMENT_LINES.departed:state.step===3?DOCK_SHIPMENT_LINES.complete:DOCK_SHIPMENT_LINES.delivered):DOCK_SHIPMENT_LINES.unhelpedDelivery
  :unattended?now<p.walkingAt?DOCK_SHIPMENT_LINES.unattended:DOCK_SHIPMENT_LINES.unattendedCarrying:now<p.meetAt?state.step===1?DOCK_SHIPMENT_LINES.waitArrival:DOCK_SHIPMENT_LINES.arrivingIntro:state.step===0?DOCK_SHIPMENT_LINES.intro:state.step===1?DOCK_SHIPMENT_LINES.inspected:now>=p.arrivesAt?DOCK_SHIPMENT_LINES.unloadingReport:DOCK_SHIPMENT_LINES.waiting;
 return {title:DOCK_SHIPMENT_LINES.title,phase,waiting,
  tile:state.step<2&&!unattended?state.step===0?DOCK_SHIPMENT_SITES.inspect:DOCK_SHIPMENT_SITES.merchant:DOCK_SHIPMENT_SITES.meet,
  action:state.step===0?'Inspect the bundles':state.step===1?waiting?'Wait for Mina':'Secure the bundles':waiting?'Wait for the shipment':'Check the delivered bundles',
  task:phase!=='active'?'':state.step===0?'Examine the fallen bundles beside the east road':state.step===1?'Help Mina fasten the spare strap':state.step===2?now>=p.leavesAt?'Check the recovered bundles at the dock loading point':'Meet Mina at the dock loading point':'',description};
}

/** All figures use the established native NPC process and connected road legs.
 * Cached phases and a scheduled floor change remain truthful during an outage. */
export function dockShipmentScene(state:LifeEventState,now:number,windowMs:number,activeMs:number,player?:string){
 const p=dockShipmentPlan(state,windowMs,activeMs),s=DOCK_SHIPMENT_SITES;
 const frames:(readonly[number,number])[]=[...merchantEntry.map((tile,i)=>[i*DOCK_SHIPMENT_STEP_MS,tile] as const),[p.start-p.enteredAt,s.merchant],...outbound.map((tile,i)=>[p.walkingAt-p.enteredAt+i*DOCK_SHIPMENT_STEP_MS,tile] as const),
  [p.deliveredAt-p.enteredAt,s.dock],...onward.map((tile,i)=>[p.leavesAt-p.enteredAt+i*DOCK_SHIPMENT_STEP_MS,tile] as const)];
 const identity=(name:string)=>name.toLowerCase().replace(/[^a-z0-9\-_]/g,'').slice(0,32);
 const thanked=p.helped&&!!player&&state.contributors.some(name=>identity(name)===identity(player));
 const received=p.helped?thanked?DOCK_SHIPMENT_LINES.merchantThanks:DOCK_SHIPMENT_LINES.merchantDelivered:DOCK_SHIPMENT_LINES.merchantAlone;
 const merchant:LifeActor={id:'shipment:merchant',name:'Merchant Mina',art:'cook',tile:s.dock,workTile:s.dock,restTile:s.dock,hideTile:s.merchantExit,hideAt:p.hideAt,
  activity:'Walking back to the fallen bundles',line:DOCK_SHIPMENT_LINES.merchantArriving,
  motion:{start:p.enteredAt,frames},phases:[
   {at:p.enteredAt+(merchantEntry.length-1)*DOCK_SHIPMENT_STEP_MS,activity:state.step===1?'Waiting for help with the strap':'Waiting beside the shipment',line:state.step===1?DOCK_SHIPMENT_LINES.merchantInspected:DOCK_SHIPMENT_LINES.merchantWaiting},
   {at:p.start,activity:'Securing the bundles',line:DOCK_SHIPMENT_LINES.merchantPacking},
   {at:p.walkingAt,activity:'Taking the shipment to the docks',line:DOCK_SHIPMENT_LINES.merchantCarrying},
   {at:p.arrivesAt,activity:'Unloading at the dock crates',line:DOCK_SHIPMENT_LINES.merchantUnloading},
   {at:p.deliveredAt,activity:'Checking the delivered bundles',line:received},
   {at:p.leavesAt,activity:'Continuing along the road',line:DOCK_SHIPMENT_LINES.merchantLeaving},
  ]};
 const guard:LifeActor={id:'shipment:guard',name:'Crossing Guard Iori',art:'guard',tile:s.guard,workTile:s.guard,restTile:s.guard,hideTile:s.guardExit,hideAt:p.guardHideAt,clearance:guardClearance,
  activity:'Walking to the held shipment',line:DOCK_SHIPMENT_LINES.guardArriving,
  motion:{start:p.enteredAt,frames:[...guardEntry.map((tile,i)=>[i*DOCK_SHIPMENT_STEP_MS,tile] as const),...guardPath.map((tile,i)=>[p.guardLeavesAt-p.enteredAt+i*DOCK_SHIPMENT_STEP_MS,tile] as const)]},phases:[{at:p.enteredAt+(guardEntry.length-1)*DOCK_SHIPMENT_STEP_MS,activity:'Keeping the crossing clear',line:state.step===1?DOCK_SHIPMENT_LINES.guardInspected:DOCK_SHIPMENT_LINES.guardWaiting},{at:p.guardLeavesAt,activity:'Returning to the crossing',line:DOCK_SHIPMENT_LINES.guardLeaving}]};
 const delivered=now>=p.deliveredAt;
 const eventPhases:LifeEventPhase[]=p.helped?[
  ...(state.step===2?[{at:p.arrivesAt,description:DOCK_SHIPMENT_LINES.unloadingReport,waiting:true},{at:p.deliveredAt,description:DOCK_SHIPMENT_LINES.delivered,waiting:false,action:'Check the delivered bundles'}]:[]),
  {at:p.leavesAt,description:DOCK_SHIPMENT_LINES.complete,...(state.step===2?{task:'Check the recovered bundles at the dock loading point'}:{})},
  {at:p.hideAt,description:DOCK_SHIPMENT_LINES.departed},
  {at:p.end,description:state.step===3?DOCK_SHIPMENT_LINES.pastDelivery:DOCK_SHIPMENT_LINES.ended,phase:state.step===3?'aftermath':'unattended',waiting:false,task:''},
 ]:[
  {at:p.meetAt,description:state.step===1?DOCK_SHIPMENT_LINES.inspected:DOCK_SHIPMENT_LINES.intro,waiting:false,...(state.step===1?{action:'Secure the bundles'}:{})},
  {at:p.start,description:DOCK_SHIPMENT_LINES.unattended,phase:'unattended',task:'',tile:s.meet},
  {at:p.walkingAt,description:DOCK_SHIPMENT_LINES.unattendedCarrying},
  {at:p.deliveredAt,description:DOCK_SHIPMENT_LINES.unhelpedDelivery},
  {at:p.end,description:DOCK_SHIPMENT_LINES.pastUnhelped},
 ];
 return {plan:p,actors:[merchant,guard].filter(actor=>now<actor.hideAt!).map(actor=>{const phase=lifeActivityAt(actor,now);return {...actor,activity:phase.activity,line:phase.line};}),
  eventPhases,
  worker:{workTile:s.dock,restTile:s.worker,tile:s.worker,atRest:true,
   activity:delivered?'Watching the delivered shipment':'Leaving the loading point clear',line:delivered?now>=p.hideAt?DOCK_SHIPMENT_LINES.workerAfter:DOCK_SHIPMENT_LINES.workerReceiving:DOCK_SHIPMENT_LINES.workerWaiting,
   motion:{start:p.start,frames:[...workerPath.map((tile,i)=>[i*DOCK_SHIPMENT_STEP_MS,tile] as const),...[...workerPath].reverse().map((tile,i)=>[p.end-p.start-(workerPath.length-1)*DOCK_SHIPMENT_STEP_MS+i*DOCK_SHIPMENT_STEP_MS,tile] as const)]},
   phases:[{at:p.start,activity:'Leaving the loading point clear',line:DOCK_SHIPMENT_LINES.workerWaiting},{at:p.deliveredAt,activity:'Watching the delivered shipment',line:DOCK_SHIPMENT_LINES.workerReceiving},{at:p.hideAt,activity:'Watching the delivered shipment',line:DOCK_SHIPMENT_LINES.workerAfter},{at:p.end,activity:'Checking the dock stores',line:DOCK_SHIPMENT_LINES.workerReset}]},
  moveWorker:now>=p.start,
  painting:now<p.walkingAt?DOCK_SHIPMENT_PAINTINGS.spilled:delivered?DOCK_SHIPMENT_PAINTINGS.delivered:undefined,
  paintingUntil:now<p.walkingAt?p.walkingAt:delivered?p.end:undefined,
  paintingNext:delivered?undefined:{at:p.deliveredAt,key:DOCK_SHIPMENT_PAINTINGS.delivered,until:p.end} as LifePaintingNext,
 };
}
