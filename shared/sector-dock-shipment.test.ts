import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceLifeEvent,lifeSceneView,lifeEventView,parseLifeState,LIFE_WINDOW_MS,LIFE_ACTIVE_MS} from './sector-life';
import {DOCK_SHIPMENT_SCENARIO,DOCK_SHIPMENT_SITES as S,DOCK_SHIPMENT_MEET_MS,DOCK_SHIPMENT_LINES as L,DOCK_SHIPMENT_PAINTINGS as P,dockShipmentPlan,dockShipmentScene} from './sector-dock-shipment';
import {lifeActorPosition,lifeActivityAt,lifeEventPresentationAt} from './sector-life-motion';
import {isWalkableTile} from './sector-walk-mask';
const start=200*LIFE_WINDOW_MS,now=start+60_000;
function secured(){let state=advanceLifeEvent(2,null,200,0,'Test Ninja',now).state;return advanceLifeEvent(2,state,200,1,'Test Ninja',now+1000).state;}

test('legacy completed road checks cannot invent recovered goods or acknowledge a forged helper',()=>{
 const raw={window:200,step:3,updatedAt:now,contributors:['Old Helper']};
 const view=lifeSceneView(2,parseLifeState(raw,now),now,'clear');assert.equal(view.step,0);assert.equal(view.scenario,DOCK_SHIPMENT_SCENARIO);assert.equal(view.painting,P.spilled);assert.deepEqual(view.contributors,[]);
 const first=advanceLifeEvent(2,raw,200,0,'Test Ninja',now);assert.equal(first.changed,true);assert.equal(first.state.step,1);assert.deepEqual(first.state.contributors,['Test Ninja']);assert.equal(first.state.shipmentAt,undefined);
 for(const stamp of [start-1,start+1,now+1,Infinity]){
  const invalid=parseLifeState({...raw,scenario:DOCK_SHIPMENT_SCENARIO,shipmentAt:stamp},now);
  assert.equal(lifeEventView(2,invalid,now).step,0);
 }
});

test('help waits for the actual arrivals and completion waits for unloading, with stale requests unable to move the clock',()=>{
 const inspected=advanceLifeEvent(2,null,200,0,'Test Ninja',start+1000);
 assert.equal(inspected.changed,true);assert.equal(inspected.view.waiting,true);
 assert.equal(advanceLifeEvent(2,inspected.state,200,1,'Test Ninja',start+DOCK_SHIPMENT_MEET_MS-1).changed,false);
 const state=secured(),p=dockShipmentPlan(state,LIFE_WINDOW_MS,LIFE_ACTIVE_MS);assert.equal(state.step,2);assert.equal(state.shipmentAt,now+1000);
 assert.equal(lifeEventView(2,state,p.deliveredAt).tile,S.meet);
 assert.notEqual(S.meet as number,S.worker);assert.notEqual(S.meet as number,S.dock);
 assert.equal(lifeEventView(2,state,p.deliveredAt-1).waiting,true);
 assert.equal(advanceLifeEvent(2,state,200,2,'Test Ninja',p.deliveredAt-1).changed,false);
 assert.equal(advanceLifeEvent(2,state,200,1,'Other',p.deliveredAt).changed,false);
 assert.equal(advanceLifeEvent(2,state,199,2,'Other',p.deliveredAt).changed,false);
 const done=advanceLifeEvent(2,state,200,2,'Test Ninja',p.deliveredAt);
 assert.equal(done.changed,true);assert.equal(done.state.shipmentAt,state.shipmentAt);assert.equal(done.view.phase,'aftermath');
 assert.equal(advanceLifeEvent(2,done.state,200,2,'Other',p.deliveredAt+1).changed,false);
});

test('every arrival, delivery, guard return and onward departure follows adjacent real ground without stepping on the parcels',()=>{
 const state=secured(),scene=dockShipmentScene(state,now,LIFE_WINDOW_MS,LIFE_ACTIVE_MS);
 const actors=[...scene.actors,{...scene.actors[0],id:'worker',...scene.worker}];
 for(const actor of actors){
  const frames=actor.motion!.frames;for(const [i,[at,tile]] of frames.entries()){
   assert(isWalkableTile(2,tile),`${actor.id}: ${tile}`);assert.notEqual(tile,S.cargo);
   if(i){const prev=frames[i-1];assert.ok(at>=prev[0]);assert.ok(Math.abs(tile%12-prev[1]%12)+Math.abs(Math.floor(tile/12)-Math.floor(prev[1]/12))<=1,`${actor.id}: ${prev[1]} -> ${tile}`);}
  }
 }
 const merchant=scene.actors.find(a=>a.id==='shipment:merchant')!,guard=scene.actors.find(a=>a.id==='shipment:guard')!;
 assert.equal(merchant.motion!.frames[0][1],S.merchantEntry);assert.equal(merchant.motion!.frames.at(-1)![1],S.merchantExit);
 assert(guard.motion!.frames.every(([,tile])=>tile!==S.merchant));
 assert.equal(guard.motion!.frames[0][1],S.guardEntry);assert.equal(guard.motion!.frames.at(-1)![1],S.guardExit);
});

test('painted parcels leave the road before travel and appear at the dock only when unloading finishes',()=>{
 const state=secured(),p=dockShipmentPlan(state,LIFE_WINDOW_MS,LIFE_ACTIVE_MS);
 const packing=dockShipmentScene(state,p.walkingAt-1,LIFE_WINDOW_MS,LIFE_ACTIVE_MS);assert.equal(packing.painting,P.spilled);assert.equal(packing.paintingUntil,p.walkingAt);
 const carrying=dockShipmentScene(state,p.walkingAt,LIFE_WINDOW_MS,LIFE_ACTIVE_MS);assert.equal(carrying.painting,undefined);assert.deepEqual(carrying.paintingNext,{at:p.deliveredAt,key:P.delivered,until:p.end});
 assert.equal(dockShipmentScene(state,p.deliveredAt-1,LIFE_WINDOW_MS,LIFE_ACTIVE_MS).painting,undefined);
 const arrived=dockShipmentScene(state,p.deliveredAt,LIFE_WINDOW_MS,LIFE_ACTIVE_MS);assert.equal(arrived.painting,P.delivered);assert.equal(arrived.paintingUntil,p.end);assert.equal(arrived.paintingNext,undefined);
 assert.match(lifeEventView(2,state,p.arrivesAt).description,/unloading/);
});

test('only actual contributors receive thanks; late observers see real goods and departures without an invented helper',()=>{
 const state=secured(),p=dockShipmentPlan(state,LIFE_WINDOW_MS,LIFE_ACTIVE_MS);
 const actor=(player:string)=>lifeSceneView(2,state,p.deliveredAt,'clear',undefined,undefined,undefined,undefined,player).actors.find(a=>a.id==='shipment:merchant')!;
 assert.equal(actor('testninja').line,L.merchantThanks);assert.equal(actor('Bystander').line,L.merchantDelivered);
 const later=lifeSceneView(2,state,p.hideAt+1,'clear');assert(!later.actors.some(a=>a.id.startsWith('shipment:')));assert.equal(later.actors[0].line,L.workerAfter);
 const unattended={...parseLifeState(null,now),scenario:DOCK_SHIPMENT_SCENARIO};
 const alone=dockShipmentPlan(unattended,LIFE_WINDOW_MS,LIFE_ACTIVE_MS),view=lifeSceneView(2,unattended,alone.deliveredAt,'clear',undefined,undefined,undefined,undefined,'Bystander');
 assert.equal(view.phase,'unattended');assert.equal(view.tile,S.meet);assert.equal(view.painting,P.delivered);assert.deepEqual(view.contributors,[]);assert.equal(view.actors.find(a=>a.id==='shipment:merchant')!.line,L.merchantAlone);
 const cached=dockShipmentScene(state,now,LIFE_WINDOW_MS,LIFE_ACTIVE_MS).worker;
 assert.equal(lifeActivityAt(cached,p.end+1).line,L.workerReset);assert.deepEqual(lifeActorPosition(2,cached,p.end+1),{col:S.dock%12,row:Math.floor(S.dock/12),walking:false});
});

test('the native cast is capped and the local guard keeps village tone through cached phases',()=>{
 for(let minute=0;minute<45;minute++)for(const weather of ['clear','rain']){
  const at=start+minute*60_000,state=parseLifeState(null,at),view=lifeSceneView(2,state,at,weather,'Ashen Leaf Village');
  assert.ok(view.actors.length<=5);assert(view.actors.some(a=>a.id==='resident:2'));
  const guard=view.actors.find(a=>a.id==='shipment:guard');if(guard){assert.match(guard.line,/Stormveil road/);for(const phase of guard.phases??[])assert.match(phase.line,/Stormveil road/);}
  const merchant=view.actors.find(a=>a.id==='shipment:merchant');if(merchant)assert.doesNotMatch(merchant.line,/Stormveil road/);
 }
});
test('cached event text and button state follow unloading and the round end without a successful poll',()=>{
 const state=secured(),p=dockShipmentPlan(state,LIFE_WINDOW_MS,LIFE_ACTIVE_MS),cached=lifeSceneView(2,state,state.shipmentAt!,'clear');
 const unloading=lifeEventPresentationAt(cached,p.arrivesAt);assert.equal(unloading.description,L.unloadingReport);assert.equal(unloading.waiting,true);
 const delivered=lifeEventPresentationAt(cached,p.deliveredAt);assert.equal(delivered.description,L.delivered);assert.equal(delivered.waiting,false);assert.equal(delivered.action,'Check the delivered bundles');
 const gone=lifeEventPresentationAt(cached,p.hideAt+1);assert.equal(gone.description,L.departed);assert.match(gone.task,/Check the recovered/);
 const expired=lifeEventPresentationAt(cached,p.end);assert.equal(expired.phase,'unattended');assert.equal(expired.task,'');assert.equal(expired.description,L.ended);
 const completed=advanceLifeEvent(2,state,state.window,2,'Test Ninja',p.deliveredAt).state;
 assert.equal(lifeEventPresentationAt(lifeSceneView(2,completed,p.deliveredAt,'clear'),p.end).description,L.pastDelivery);
 const alone=lifeSceneView(2,parseLifeState(null,now),now,'clear');
 assert.equal(lifeEventPresentationAt(alone,p.end).description,L.pastUnhelped);
 assert.equal(lifeEventPresentationAt(alone,p.end).tile,S.meet);
});
