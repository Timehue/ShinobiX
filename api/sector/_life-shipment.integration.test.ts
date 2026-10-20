import {before,beforeEach,after,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {worldPositionModel} from '../../shared/continuous-world-layout.js';
import {lifeStorageKey,LIFE_WINDOW_MS,lifeWindowAt,type LifeSceneView,type LifeEventState} from '../../shared/sector-life.js';
import {DOCK_SHIPMENT_SITES as S,DOCK_SHIPMENT_PAINTINGS as P,DOCK_SHIPMENT_LINES as L,DOCK_SHIPMENT_DELIVERY_MS,DOCK_SHIPMENT_SCENARIO} from '../../shared/sector-dock-shipment.js';
let clock=300*LIFE_WINDOW_MS+60_000,serial=0;
let kv:typeof import('../_storage.js').kv,store:typeof import('../_realtime/online-store.js').onlineStore,handler:typeof import('./life.js').default,tokenFor:typeof import('../_auth.js').issuePlayerToken;
const model=worldPositionModel(),key=lifeStorageKey(2);
before(async()=>{process.env.NODE_ENV='test';process.env.SHINOBIX_QA_MEMORY_KV='1';process.env.SESSION_SECRET='shipment-tests-only';mock.method(Date,'now',()=>clock);
 ({kv}=await import('../_storage.js'));({onlineStore:store}=await import('../_realtime/online-store.js'));handler=(await import('./life.js')).default as unknown as typeof handler;({issuePlayerToken:tokenFor}=await import('../_auth.js'));
});
beforeEach(async()=>{clock=300*LIFE_WINDOW_MS+60_000;await kv.del(key,'world:territory:2','lock:'+key);});after(()=>mock.restoreAll());
function actor(tile:number=S.inspect){const name=`shipment${++serial}`;touch(name,tile);return name;}
function touch(name:string,tile:number){store.upsert({name,sector:2,tile,character:null,restoredWorldPosition:model.fallback(2,tile)!});assert(store.commitWorldPosition(name,model.fallback(2,tile)!,store.get(name)!.movementSeq??0));}
type Body={view?:LifeSceneView;error?:string;changed?:boolean};
async function request(name:string,body:Record<string,unknown>={},method='POST',authenticated=true){
 const result:{status:number;body:Body}={status:200,body:{}};
 const res={setHeader(){},status(code:number){result.status=code;return res;},json(value:Body){result.body=value;return res;},end(){return res;}};
 const input={sector:2,playerName:name,window:lifeWindowAt(clock),step:0,...body};
 await handler({method,body:input,query:input,headers:authenticated?{'x-player-name':name,'x-player-token':tokenFor(name),'x-forwarded-for':`10.99.4.${serial}`}:{},socket:{remoteAddress:`10.99.4.${serial}`}} as never,res as never);return result;
}

test('real shipment aid uses server presence and clock, ignores forged completion fields, and leaves the save unchanged',async()=>{
 const name=actor(),save={_saveVersion:17,character:{ryo:321,starterCardsClaimed:false,items:[{id:'rope',qty:1}]}};await kv.set(`save:${name}`,save);
 const initial=await request(name,{shipmentAt:clock-999999,painting:P.delivered},'GET');assert.equal(initial.status,200);assert.equal(initial.body.view!.step,0);assert.equal(initial.body.view!.painting,P.spilled);
 assert.equal((await request(name,{},'POST',false)).status,401);assert.equal(await kv.get(key),null);
 assert.equal((await request(name)).body.view!.step,1);clock++;touch(name,S.merchant);
 const secured=await request(name,{step:1,shipmentAt:clock-999999,waiting:false,contributors:['Forged']});assert.equal(secured.status,200);assert.equal(secured.body.view!.waiting,true);
 const stored=await kv.get<LifeEventState>(key);assert.equal(stored!.shipmentAt,clock);assert.equal(stored!.scenario,DOCK_SHIPMENT_SCENARIO);assert(!stored!.contributors.includes('Forged'));
 touch(name,S.worker);const early=await request(name,{step:2,shipmentAt:0,waiting:false});assert.equal(early.status,409);assert.match(early.body.error!,/taking|unloading/);assert.deepEqual(await kv.get(key),stored);
 clock+=DOCK_SHIPMENT_DELIVERY_MS;touch(name,S.worker);const done=await request(name,{step:2});assert.equal(done.status,200);assert.equal(done.body.changed,true);assert.equal(done.body.view!.painting,P.delivered);assert.equal(done.body.view!.phase,'aftermath');
 assert.equal(done.body.view!.actors.find(a=>a.id==='shipment:merchant')!.line,L.merchantThanks);
 const bystander=actor(S.worker),other=await request(bystander,{},'GET');assert.equal(other.body.view!.actors.find(a=>a.id==='shipment:merchant')!.line,L.merchantDelivered);
 const completed=await kv.get(key);assert.equal((await request(name,{step:2})).body.changed,false);assert.deepEqual(await kv.get(key),completed);assert.deepEqual(await kv.get(`save:${name}`),save);
});

test('two players cannot start two deliveries, and a failed CAS publishes no recovered shipment',async t=>{
 const first=actor(),second=actor();await request(first);clock++;touch(first,S.merchant);touch(second,S.merchant);
 const responses=await Promise.all([request(first,{step:1}),request(second,{step:1})]);assert.equal(responses.filter(r=>r.status===200&&r.body.changed).length,1);
 const state=await kv.get<LifeEventState>(key);assert.equal(state!.step,2);assert.equal(state!.shipmentAt,clock);
 await kv.del(key);await request(first);const before=await kv.get(key),original=kv.compareSet.bind(kv);
 t.mock.method(kv,'compareSet',async(...args:Parameters<typeof kv.compareSet>)=>args[0]===key?false:original(...args));
 const failed=await request(first,{step:1});assert.equal(failed.status,409);assert.deepEqual(await kv.get(key),before);
 const observed=await request(second,{},'GET');assert.equal(observed.body.view!.step,1);assert.equal(observed.body.view!.painting,P.spilled);assert.equal(observed.body.view!.shipmentAt,undefined);
});

test('legacy route completion is only migrated by a real action; presence, battle and travel still gate aid',async()=>{
 const name=actor(),legacy={window:lifeWindowAt(clock),step:3,updatedAt:clock,contributors:['Old Helper']};await kv.set(key,legacy);
 const view=await request(name,{},'GET');assert.equal(view.body.view!.step,0);assert.deepEqual(view.body.view!.contributors,[]);assert.deepEqual(await kv.get(key),legacy);
 touch(name,5);assert.equal((await request(name)).status,409);assert.deepEqual(await kv.get(key),legacy);
 touch(name,S.inspect);store.get(name)!.inBattle=true;assert.equal((await request(name)).status,409);store.get(name)!.inBattle=false;
 store.get(name)!.travelingUntil=clock+1000;assert.equal((await request(name)).status,409);store.get(name)!.travelingUntil=0;
 const helped=await request(name);assert.equal(helped.status,200);assert.equal(helped.body.view!.step,1);assert.equal((await kv.get<LifeEventState>(key))!.scenario,DOCK_SHIPMENT_SCENARIO);
});
