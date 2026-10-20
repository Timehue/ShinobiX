import { before, beforeEach, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import { lifeAnchors, lifeWindowAt, LIFE_WINDOW_MS, travelerRoute,lifeEventView,parseLifeState,lifeStorageKey,lifeCourierRoute } from '../../shared/sector-life.js';
import { WORLD_DAY_MS, WORLD_HOUR_MS } from '../../shared/world-clock.js';
import { SHRINE_DEFS } from '../../shared/shrines.js';
import {wildlifeDiscovery,WILDLIFE_DISCOVERY_WINDOW} from '../../shared/sector-life-discovery.js';
import {harvestGroundTile} from '../../shared/sector-harvest.js';
import {isWorldNight} from '../../shared/world-phase.js';
import {walkPath} from '../../shared/sector-walk-mask.js';
import {currentWorkingAngler} from '../../shared/sector-angler-work.js';
import {WANDERER_BUCKET_MS} from '../../shared/wanderer-roster.js';

let clock = 120 * LIFE_WINDOW_MS + 60_000, serial = 0;
let kv: typeof import('../_storage.js').kv;
let store: typeof import('../_realtime/online-store.js').onlineStore;
let handler: typeof import('./life.js').default;
let tokenFor: typeof import('../_auth.js').issuePlayerToken;
const sector = 15, model = worldPositionModel();
before(async () => {
    process.env.NODE_ENV='test'; process.env.SHINOBIX_QA_MEMORY_KV='1'; process.env.SESSION_SECRET='sector-life-test-secret-only';
    mock.method(Date,'now',()=>clock);
    ({kv}=await import('../_storage.js')); ({onlineStore:store}=await import('../_realtime/online-store.js'));
    handler=(await import('./life.js')).default as unknown as typeof handler;
    ({issuePlayerToken:tokenFor}=await import('../_auth.js'));
});
beforeEach(async()=>{ clock=120*LIFE_WINDOW_MS+60_000; await kv.del(lifeStorageKey(sector),'world:shrine:heartwood');await kv.del(`world:territory:${sector}`); });
after(()=>mock.restoreAll());
function anglerFixture(where:number){for(let bucket=80;bucket<300;bucket++){const now=bucket*WANDERER_BUCKET_MS+10*WORLD_HOUR_MS,work=currentWorkingAngler(where,now);if(work)return {now,work};}throw Error('No natural angler');}

test('the real endpoint shares an actual Chronicle match, ignores forged turns, and leaves saves and errands untouched',async()=>{
    const {chronicleStopKey}=await import('./_life-chronicle.js'),{stopChronicleGame}=await import('./_life-chronicle-game.js');
    const {chronicleStopPlan}=await import('../../shared/sector-chronicle-stop.js');
    const where=42,start=20*WORLD_HOUR_MS,window=20,game=stopChronicleGame(window),plan=chronicleStopPlan({window},game);
    clock=plan.matchAt+1000;await kv.del(chronicleStopKey);
    await kv.set('world:territory:42',{ownerClan:'TestClan',weather:'clear',hp:100});
    const a=actor(65,where),b=actor(65,where),saved={_saveVersion:14,character:{ryo:77,starterCardsClaimed:false}};
    await kv.set(`save:${a}`,saved);const before=await kv.get(lifeStorageKey(where));
    const first=await request(a,{sector:where,match:{winner:'Forged Winner',turn:999},weather:'rain'},true,'GET');
    assert.equal(first.status,200);assert.equal(first.body.view.painting,'midlands-herb-chronicle-table-v2');
    assert.equal(first.body.view.paintingUntil,plan.cardsUntil);
    const pair=first.body.view.actors.filter((actor:any)=>actor.id.startsWith('chronicle:'));assert.equal(pair.length,2);
    assert(pair.every((actor:any)=>actor.activity===`Chronicle turn 1: ${game.turns[0].player}`));
    const stored=await kv.get(chronicleStopKey),second=await request(b,{sector:where},true,'GET');
    assert.deepEqual(second.body.view.actors.filter((actor:any)=>actor.id.startsWith('chronicle:')),pair);
    assert.deepEqual(await kv.get(chronicleStopKey),stored);
    assert.deepEqual(await kv.get(`save:${a}`),saved);assert.deepEqual(await kv.get(lifeStorageKey(where)),before);
    assert(!JSON.stringify(first.body.view).includes('Forged Winner'));
    clock=plan.packAt+1;const result=await request(a,{sector:where},true,'GET');
    assert(result.body.view.actors.filter((actor:any)=>actor.id.startsWith('chronicle:')).every((actor:any)=>game.winner?actor.line.includes(`${game.winner} won`):actor.line.includes('draw')));
    await kv.del(chronicleStopKey,'world:territory:42');
});
test('concurrent weather observations close one shared match and failed CAS cannot publish a different scene',async t=>{
    const {chronicleStopKey}=await import('./_life-chronicle.js'),{stopChronicleGame}=await import('./_life-chronicle-game.js');
    const {chronicleStopPlan}=await import('../../shared/sector-chronicle-stop.js');
    clock=chronicleStopPlan({window:20},stopChronicleGame(20)).matchAt+1000;await kv.del(chronicleStopKey);
    await kv.set('world:territory:42',{ownerClan:'TestClan',weather:'clear',hp:100});
    const a=actor(65,42),b=actor(65,42);await request(a,{sector:42},true,'GET');
    const original=kv.compareSet.bind(kv);let writes=0;
    t.mock.method(kv,'compareSet',async(...args:Parameters<typeof kv.compareSet>)=>{if(args[0]===chronicleStopKey)writes++;return original(...args);});
    await kv.set('world:territory:42',{ownerClan:'TestClan',weather:'rain',hp:100});clock+=1000;
    const replies=await Promise.all([request(a,{sector:42,weather:'clear'},true,'GET'),request(b,{sector:42},true,'GET')]);
    assert(replies.every(r=>r.status===200));assert.equal(writes,1);
    const stored=await kv.get(chronicleStopKey);
    assert.deepEqual(replies[0].body.view.actors.filter((actor:any)=>actor.id.startsWith('chronicle:')),replies[1].body.view.actors.filter((actor:any)=>actor.id.startsWith('chronicle:')));
    await kv.set('world:territory:42',{ownerClan:'TestClan',weather:'clear',hp:100});clock+=20_000;
    assert.equal((await request(a,{sector:42},true,'GET')).body.view.painting,undefined);assert.deepEqual(await kv.get(chronicleStopKey),stored);
    await kv.del(chronicleStopKey);await kv.set('world:territory:42',{ownerClan:'TestClan',weather:'clear',hp:100});
    t.mock.method(kv,'compareSet',async(...args:Parameters<typeof kv.compareSet>)=>args[0]===chronicleStopKey?false:original(...args));
    assert.equal((await request(a,{sector:42},true,'GET')).status,503);assert.equal(await kv.get(chronicleStopKey),null);
    await kv.del(chronicleStopKey,'world:territory:42');
});
test('the real life response gives the existing angler a shared shoreline routine without adding an actor or changing a save',async()=>{
    const {anglerWorkKey}=await import('./_life-angler.js');
    for(const where of [6,18]){
        const fixture=anglerFixture(where);clock=fixture.now;const key=anglerWorkKey(where);await kv.del(key);
        await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});
        const name=actor(fixture.work.site.bank,where),saved={_saveVersion:14,character:{ryo:77}};await kv.set(`save:${name}`,saved);
        const before=await kv.get(lifeStorageKey(where));
        const response=await request(name,{sector:where,service:{id:'forged',fishing:{water:99}}},true,'GET');assert.equal(response.status,200);
        const routine=response.body.view.service;assert.equal(routine.id,fixture.work.wanderer.id);assert.equal(routine.name,fixture.work.wanderer.name);assert.equal(routine.fishing.water,fixture.work.site.water);
        assert(!response.body.view.actors.some((a:any)=>a.id===routine.id));assert(response.body.view.actors.length<=5);
        const stored=await kv.get(key);clock+=1000;const later=await request(name,{sector:where},true,'GET');assert.deepEqual(await kv.get(key),stored);assert.deepEqual(later.body.view.service.motion,routine.motion);
        assert.deepEqual(await kv.get(lifeStorageKey(where)),before);assert.deepEqual(await kv.get(`save:${name}`),saved);await kv.del(key,`world:territory:${where}`);
    }
});
test('concurrent weather observations share one packing clock and the existing angler resumes from the gatehouse',async t=>{
    const {anglerWorkKey}=await import('./_life-angler.js'),where=6,fixture=anglerFixture(where);clock=fixture.now;const key=anglerWorkKey(where);await kv.del(key);
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    const a=actor(fixture.work.site.bank,where),b=actor(fixture.work.site.bank,where);await request(a,{sector:where},true,'GET');
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'rain',hp:100});clock+=1000;
    const original=kv.compareSet.bind(kv);let changes=0;t.mock.method(kv,'compareSet',async(...args:Parameters<typeof kv.compareSet>)=>{if(args[0]===key)changes++;return original(...args);});
    const replies=await Promise.all([request(a,{sector:where,weather:'clear'},true,'GET'),request(b,{sector:where},true,'GET')]);
    assert(replies.every(r=>r.status===200));assert.equal(changes,1);assert.deepEqual(replies[0].body.view.service.motion,replies[1].body.view.service.motion);
    const packing=replies[0].body.view.service;assert.equal(packing.activity,'Putting the line away');assert.equal(packing.fishing,undefined);assert.equal(packing.motion.start,clock);
    clock=packing.hideAt+1000;const indoor=await request(a,{sector:where},true,'GET');assert.equal(indoor.body.view.service.activity,'Resting indoors');
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});clock+=1000;
    const returning=await request(a,{sector:where},true,'GET');assert.equal(returning.body.view.service.activity,'Walking to the fishing spot');assert.equal(returning.body.view.service.motion.frames[0][1],fixture.work.site.door);
    await kv.del(key,`world:territory:${where}`);
});
test('a failed routine CAS cannot partially start a different walk',async t=>{
    const {anglerWorkKey}=await import('./_life-angler.js'),where=18,fixture=anglerFixture(where);clock=fixture.now;const key=anglerWorkKey(where);await kv.del(key);
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});const name=actor(fixture.work.site.bank,where);await request(name,{sector:where},true,'GET');const stored=await kv.get(key);
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'rain',hp:100});clock+=1000;
    const original=kv.compareSet.bind(kv);t.mock.method(kv,'compareSet',async(...args:Parameters<typeof kv.compareSet>)=>args[0]===key?false:original(...args));
    assert.equal((await request(name,{sector:where},true,'GET')).status,503);assert.deepEqual(await kv.get(key),stored);await kv.del(key,`world:territory:${where}`);
});
test('actual recorded ground can attract wildlife; forged clues cannot, and weather/deadlines remove it without a save mutation',async()=>{
    const {rememberHarvestGround,harvestGroundKey}=await import('../world/_harvest-ground.js');
    const where=42,key=harvestGroundKey(where),origin=lifeAnchors(where)[2];await kv.del(key);
    clock=Math.floor(clock/WILDLIFE_DISCOVERY_WINDOW)*WILDLIFE_DISCOVERY_WINDOW;
    while(isWorldNight(clock)||(Math.floor(clock/WILDLIFE_DISCOVERY_WINDOW)+where)%4)clock+=WILDLIFE_DISCOVERY_WINDOW;
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    const name=actor(77,where),saved={_saveVersion:12,character:{ryo:77}};await kv.set(`save:${name}`,saved);
    // This fixed tea stop has no intrinsic trail. Only a committed worked patch
    // can supply the clue, irrespective of forged request fields.
    const empty=await request(name,{sector:where,groundTrail:[[50]],wildlife:{restTile:50}},true,'GET');assert.equal(empty.body.view.wildlife,undefined);
    const target=Array.from({length:144},(_,t)=>t).find(t=>harvestGroundTile(where,t)===t&&(walkPath(where,origin,t)?.length??0)>=3&&!empty.body.view.actors.some((a:any)=>a.restTile===t||a.workTile===t))!;
    assert(Number.isInteger(target));await rememberHarvestGround(name,'actual-find',where,{tile:target,at:clock},clock);
    const real=await request(name,{sector:where},true,'GET');assert.equal(real.status,200);assert(real.body.view.wildlife);
    assert.deepEqual(real.body.view.wildlife,wildlifeDiscovery(where,clock,'clear',origin,real.body.view.groundTrail,real.body.view.actors.flatMap((a:any)=>[a.restTile,a.workTile])));
    assert(real.body.view.wildlife.motion.frames.some(([,t]:number[])=>t===target));
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'rain',hp:100});
    assert.equal((await request(name,{sector:where,weather:'clear'},true,'GET')).body.view.wildlife,undefined);
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    clock=real.body.view.wildlife.until;assert.equal((await request(name,{sector:where},true,'GET')).body.view.wildlife,undefined);
    assert.deepEqual(await kv.get(`save:${name}`),saved);await kv.del(key,`world:territory:${where}`);
});
test('all six regional paintings follow the real communal offering ledger and ignore supplied tiers',async()=>{
    const name=actor();await kv.set(`save:${name}`,{_saveVersion:12,character:{ryo:77}});const saved=await kv.get(`save:${name}`);
    for(const shrine of SHRINE_DEFS){const key=`world:shrine:${shrine.id}`;for(const [total,state] of [[0,'dormant'],[25_000,'supported'],[100_000,'radiant']] as const){
        await kv.set(key,{total,kindledAt:clock-60_000});const result=await request(name,{sector:shrine.sector,tier:4,total:9_999_999},true,'GET');assert.equal(result.status,200);
        // The local Heartwood task may be between lamps; its untouched stage
        // here is zero, so its unfunded floor remains dormant too.
        assert.equal(result.body.view.painting,shrine.sector===31?`${shrine.id}-${state}-shrine-supply-v2`:`${shrine.id}-${state}-shrine-v1`);
    }await kv.del(key);}assert.deepEqual(await kv.get(`save:${name}`),saved);
});
test('the real life response gives only a recorded observer first-person dialogue and ignores forged witnesses',async()=>{
    const {withDuelWitnesses}=await import('../pvp/_duel-witnesses.js'),{recordSectorDuelScar}=await import('../_sector-scars.js');
    const key=`world:scars:${sector}`;await kv.del(key);
    const ground=await withDuelWitnesses({sector,tile:104},clock);assert(ground);assert(ground.witnesses?.some(w=>w.id==='resident:15'));
    await recordSectorDuelScar(sector,'Rin','Kota',clock,104,ground.witnesses);
    const player=actor(),forged={witnesses:[{id:'keeper:15',name:'Shrine Keeper',tile:111,at:clock}],victor:'Forged Winner'};
    const view=await request(player,forged,true,'GET');assert.equal(view.status,200);
    assert(view.body.view.actors.find((a:any)=>a.id==='resident:15').line.includes('I saw Rin and Kota fighting near here.'));
    assert(!view.body.view.actors.find((a:any)=>a.id==='keeper:15').line.includes('I saw'));assert(!JSON.stringify(view.body).includes('Forged Winner'));
    clock+=86_400_000;const expired=await request(player,{},true,'GET');assert.equal(expired.status,200);assert(!expired.body.view.actors.some((a:any)=>a.line.includes('I saw Rin')));await kv.del(key);
});
function actor(tile=lifeAnchors(sector)[0],at=sector) {
    const name=`lifewalker${++serial}`;
    store.upsert({name,sector:at,tile,character:null,restoredWorldPosition:model.fallback(at,tile)!});
    return name;
}
async function request(name: string, body: Record<string,unknown>={}, authenticated=true, method='POST') {
    const result:{status:number;body:any}={status:200,body:null};
    const res={setHeader(){},status(code:number){result.status=code;return res;},json(value:unknown){result.body=value;return res;},end(){return res;}};
    const input={sector,playerName:name,window:lifeWindowAt(clock),step:0,...body};
    await handler({method,body:input,query:input,headers:authenticated?{'x-player-name':name,'x-player-token':tokenFor(name),'x-forwarded-for':'10.90.0.8'}:{},socket:{remoteAddress:'10.90.0.8'}} as never,res as never);
    return result;
}
test('activity reads and actions require identity and reject acting as another player',async()=>{
    const name=actor();
    assert.equal((await request(name,{},false,'GET')).status,401);
    assert.equal((await request(name,{},false)).status,401);
    assert.equal((await request(name,{playerName:'someoneelse'})).status,403);
    assert.equal((await request(name,{sector:999})).status,400);
});
test('a character must be at the current work point, in this sector, and out of battle or travel',async()=>{
    const elsewhere=actor(77,1); assert.equal((await request(elsewhere)).status,409);
    const far=actor(lifeAnchors(sector)[2]); assert.equal((await request(far)).status,409);
    const battle=actor();store.setInBattle(battle,true);assert.equal((await request(battle)).status,409);
    const traveling=actor();store.startTravel(traveling,16,clock+3000,sector);assert.equal((await request(traveling)).status,409);
    assert.equal(await kv.get(lifeStorageKey(sector)),null);
});
test('two players helping at once advance one shared stage, and a refresh preserves the outcome',async()=>{
    const a=actor(),b=actor();
    const results=await Promise.all([request(a),request(b)]);
    assert.equal(results.filter(r=>r.body.changed).length,1);
    assert.equal((await kv.get<any>(lifeStorageKey(sector)))?.step,1);
    const view=await request(a,{},true,'GET');assert.equal(view.status,200);assert.equal(view.body.view.step,1);
    assert.equal(view.body.view.contributors.length,1);
});
test('all three work points produce shared aftermath without touching the player save',async()=>{
    const name=actor();await kv.set(`save:${name}`,{_saveVersion:9,ryo:100});
    for(let step=0;step<3;step++) {
        const present=store.get(name)!;
        assert(store.commitWorldPosition(name,model.fallback(sector,lifeAnchors(sector)[step])!,present.movementSeq ?? 0));
        const result=await request(name,{step});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.view.step,step+1);
        if(step===2)assert.equal(result.body.view.phase,'aftermath');
    }
    assert.deepEqual(await kv.get(`save:${name}`),{_saveVersion:9,ryo:100});
});
test('the festival endpoint retains the existing cook/courier event, packs the real counter and ignores forged time or weather',async()=>{
    const {festivalStallPlan,FESTIVAL_SITE}=await import('../../shared/sector-festival-work.js'),where=52;
    clock=Math.floor(clock/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
    await kv.del(lifeStorageKey(where));await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    const name=actor(104,where),saved={_saveVersion:14,character:{ryo:77}};await kv.set(`save:${name}`,saved);
    const day=await request(name,{sector:where,weather:'rain',now:0,painting:'forged'},true,'GET');assert.equal(day.status,200);
    assert.equal(day.body.view.kind,'courier');assert.equal(day.body.view.painting,FESTIVAL_SITE.open);assert.equal(day.body.view.tile,5);
    const eda=day.body.view.actors.find((actor:any)=>actor.id==='resident:52');assert.equal(eda.name,'Cook Eda');assert.equal(eda.workTile,104);assert.equal(eda.activity,'Serving at the festival counter');
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'rain',hp:100});
    const wet=await request(name,{sector:where,weather:'clear',hour:12},true,'GET');assert.equal(wet.body.view.painting,FESTIVAL_SITE.packed);assert.equal(wet.body.view.actors[0].activity,'Waiting out the weather');
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});clock=festivalStallPlan(clock).restAt+1000;
    const closed=await request(name,{sector:where,hour:8},true,'GET');assert.equal(closed.body.view.painting,FESTIVAL_SITE.packed);assert.equal(closed.body.view.actors[0].activity,'Waiting beside the festival building');
    assert.deepEqual(await kv.get(`save:${name}`),saved);assert.equal(await kv.get(lifeStorageKey(where)),null);await kv.del(`world:territory:${where}`);
});

test('routine responses use server time and the authoritative territory weather instead of client conditions',async()=>{
    clock=Math.floor(clock/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
    const name=actor();
    await kv.set(`world:territory:${sector}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    const day=await request(name,{},true,'GET');assert.equal(day.status,200);assert.equal(day.body.view.actors[0].activity,'Preparing tea');
    await kv.set(`world:territory:${sector}`,{ownerClan:'TestClan',weather:'rain',hp:100});
    const wet=await request(name,{weather:'clear',hour:12},true,'GET');
    assert.equal(wet.body.view.actors[0].activity,'Waiting out the weather');assert.match(wet.body.view.actors[0].line,/weather/);
    assert.equal(wet.body.view.actors[0].restTile,day.body.view.actors[0].restTile);
    await kv.set(`world:territory:${sector}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    clock=Math.floor(clock/WORLD_DAY_MS)*WORLD_DAY_MS+21*WORLD_HOUR_MS;
    const night=await request(name,{weather:'clear',hour:12},true,'GET');
    assert.equal(night.body.view.actors[0].activity,'Resting at the stop');assert.match(night.body.view.actors[0].line,/last cups/);
});

test('local village reactions follow the current saved village and ignore forged request and presence affiliations',async()=>{
    const name=actor();
    store.upsert({name,sector,tile:lifeAnchors(sector)[0],character:{village:'Ashen Leaf Village'} as never});
    await kv.set(`save:${name}`,{character:{village:'Frostfang Village'},_saveVersion:12});
    const rival=await request(name,{village:'Ashen Leaf Village'},true,'GET');
    assert.equal(rival.status,200);
    assert.match(rival.body.view.actors[0].line,/trampling the plants/);
    await kv.set(`save:${name}`,{character:{village:'Ashen Leaf Village'},_saveVersion:13});
    const home=await request(name,{village:'Frostfang Village'},true,'GET');
    assert.match(home.body.view.actors[0].line,/one of ours/);
    assert.deepEqual(await kv.get(`save:${name}`),{character:{village:'Ashen Leaf Village'},_saveVersion:13});
    await kv.del(`save:${name}`);
    const unknown=await request(name,{village:'Frostfang Village'},true,'GET');
    assert.equal(unknown.body.view.actors[0].bark,undefined);
});

test('the Chronicle scribe reports real unexpired local duel records and ignores client claims',async()=>{
    clock=Math.floor(clock/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS+150_000;
    const route=travelerRoute(3),where=route[(Math.floor(clock/300_000)+6)%route.length],name=actor(77,where);
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    await kv.set(`world:scars:${where}`,[{kind:'duel',victor:'Rin',fallen:'Kota',at:clock-60_000}]);
    const response=await request(name,{sector:where,scar:{victor:'Fake',fallen:'Invented'}},true,'GET');
    assert.equal(response.status,200);
    const scribe=response.body.view.actors.find((a:any)=>a.id==='sumi');assert(scribe);
    assert.match(scribe.line,/Rin as the winner against Kota/);assert.doesNotMatch(scribe.line,/Fake|Invented/);
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'rain',hp:100});
    const wet=await request(name,{sector:where,weather:'clear'},true,'GET');
    assert.match(wet.body.view.actors.find((a:any)=>a.id==='sumi').line,/keeping my notes covered/);
    await kv.set(`world:territory:${where}`,{ownerClan:'TestClan',weather:'clear',hp:100});
    await kv.set(`world:scars:${where}`,[{kind:'duel',victor:'Rin',fallen:'Kota',at:clock-86_400_001}]);
    const stale=await request(name,{sector:where},true,'GET');
    assert.doesNotMatch(stale.body.view.actors.find((a:any)=>a.id==='sumi').line,/Rin|Kota/);
    await kv.del(`world:scars:${where}`);await kv.del(`world:territory:${where}`);
});
test('stale windows and failed storage writes cannot complete a task',async t=>{
    const name=actor(); assert.equal((await request(name,{window:lifeWindowAt(clock)-1})).status,409);
    const original=kv.compareSet.bind(kv);
    t.mock.method(kv,'compareSet',async(key:string,expected:unknown,value:unknown,options?:{ex?:number})=>{if(key.startsWith('sector-life:'))throw new Error('injected failure');return original(key,expected,value,options);});
    assert.equal((await request(name)).status,503);
    assert.equal(await kv.get(lifeStorageKey(sector)),null);
});

test('shrine upkeep and its aftermath commit together, survive a new round, and cannot be replayed to extend their life',async()=>{
    clock=121*LIFE_WINDOW_MS+60_000;
    const initial=lifeEventView(sector,parseLifeState(null,clock),clock),name=actor(initial.tile);
    await kv.set(`save:${name}`,{character:{village:'Ashen Leaf Village'},_saveVersion:12,ryo:700});
    const forged=await request(name,{tier:4,maintainedAt:clock},true,'GET');assert.equal(forged.body.view.painting,'heartwood-dormant-shrine-v1');
    for(let step=0;step<3;step++) {
        const view=lifeEventView(sector,{...parseLifeState(null,clock),step},clock),presence=store.get(name)!;
        assert(store.commitWorldPosition(name,model.fallback(sector,view.tile)!,presence.movementSeq??0));
        const result=await request(name,{step,by:'Fake helper'});assert.equal(result.status,200,JSON.stringify(result.body));
        assert.equal(result.body.view.painting,step===0?'heartwood-dormant-shrine-v1':step===1?'heartwood-left-lamp-v1':'heartwood-supported-shrine-v1');
    }
    const care=(await kv.get<any>(lifeStorageKey(sector))).care;assert.equal(care.maintainedAt,clock);assert.equal(care.by,store.get(name)!.displayName);
    clock+=5000;const replay=await request(name,{step:2});assert.equal(replay.body.changed,false);
    assert.deepEqual((await kv.get<any>(lifeStorageKey(sector))).care,care);
    clock+=LIFE_WINDOW_MS;const later=await request(name,{},true,'GET');assert.equal(later.body.view.step,0);assert.equal(later.body.view.painting,'heartwood-supported-shrine-v1');
    assert.deepEqual(await kv.get(`save:${name}`),{character:{village:'Ashen Leaf Village'},_saveVersion:12,ryo:700});
    assert.equal(await kv.get('world:shrine:heartwood'),null,'helping is cosmetic upkeep, not a currency offering');
});

test('a refused atomic shrine commit leaves both the final stage and upkeep unchanged',async t=>{
    clock=121*LIFE_WINDOW_MS+60_000;const name=actor(123);
    for(let step=0;step<2;step++)assert.equal((await request(name,{step})).status,200);
    const before=await kv.get(lifeStorageKey(sector)),original=kv.compareSet.bind(kv);
    t.mock.method(kv,'compareSet',async(key:string,expected:unknown,value:unknown,options?:{ex?:number})=>key===lifeStorageKey(sector)?false:original(key,expected,value,options));
    const refused=await request(name,{step:2});assert.equal(refused.status,409);
    assert.deepEqual(await kv.get(lifeStorageKey(sector)),before);assert.equal((await kv.get<any>(lifeStorageKey(sector)))?.care,undefined);
});

test('shrine completion stays atomic without optional multi-key storage support',async t=>{
    const descriptor=Object.getOwnPropertyDescriptor(kv,'compareSetMany');
    Object.defineProperty(kv,'compareSetMany',{configurable:true,writable:true,value:undefined});
    t.after(()=>{if(descriptor)Object.defineProperty(kv,'compareSetMany',descriptor);else delete kv.compareSetMany;});
    clock=121*LIFE_WINDOW_MS+60_000;const name=actor(123);
    for(let step=0;step<3;step++)assert.equal((await request(name,{step})).status,200);
    const stored=await kv.get<any>(lifeStorageKey(sector));assert.equal(stored.step,3);assert.equal(stored.care.maintainedAt,clock);
});

test('the real communal offering tier maintains the painted shrine independently of the optional task',async()=>{
    const name=actor();
    const plain=await request(name,{shrineTier:4},true,'GET');assert.equal(plain.body.view.painting,'heartwood-dormant-shrine-v1');
    await kv.set('world:shrine:heartwood',{total:25_000});
    const funded=await request(name,{shrineTier:0},true,'GET');assert.equal(funded.body.view.painting,'heartwood-supported-shrine-v1');
    assert(funded.body.view.actors.some((a:any)=>a.id==='keeper:15'));
    await kv.set('world:shrine:heartwood',{total:100_000});
    const more=await request(name,{},true,'GET');assert.equal(more.body.view.painting,'heartwood-radiant-shrine-v1');
});

test('visitor arrivals follow the saved first offering time and ignore forged start times',async()=>{
    clock=121*LIFE_WINDOW_MS+60_000;const name=actor(),kindledAt=clock-30_000;
    await kv.set('world:shrine:heartwood',{total:25_000,kindledAt});
    const first=await request(name,{supportStartedAt:clock+1},true,'GET');
    const pilgrim=first.body.view.actors.find((a:any)=>a.id==='pilgrim:15:0');assert(pilgrim);assert.equal(pilgrim.motion.start,kindledAt+2000);
    await kv.set('world:shrine:heartwood',{total:35_000,kindledAt,updatedAt:clock});
    const later=await request(name,{},true,'GET');assert.deepEqual(later.body.view.actors.find((a:any)=>a.id===pilgrim.id).motion,pilgrim.motion);
});

test('life snapshots refresh only recorded duel marks and remove them when the records expire',async()=>{
    const name=actor(),at=clock;
    await kv.set(`world:scars:${sector}`,[{kind:'duel',victor:'Rin',fallen:'Kota',tile:123,at},{kind:'duel',victor:'Aki',fallen:'Ben',at}]);
    const fresh=await request(name,{groundScars:[{tile:99,victor:'Fake'}]},true,'GET');assert.equal(fresh.body.view.groundScars.length,2);
    assert.equal(fresh.body.view.groundScars[0].tile,123);assert.equal(fresh.body.view.groundScars[1].tile,undefined);
    clock+=86_400_001;const expired=await request(name,{},true,'GET');assert.deepEqual(expired.body.view.groundScars,[]);
});

test('courier rescue completion requires the real return time and does not touch player saves',async()=>{
    const where=31,route=lifeCourierRoute(where),name=actor(route.search,where),key=lifeStorageKey(where),before={_saveVersion:17,character:{ryo:1300}};
    await kv.set(`save:${name}`,before);
    assert.equal((await request(name,{sector:where,step:0})).status,200);
    assert(store.commitWorldPosition(name,model.fallback(where,route.stranded)!,store.get(name)!.movementSeq??0));
    assert.equal((await request(name,{sector:where,step:1})).status,200);
    assert(store.commitWorldPosition(name,model.fallback(where,route.stop)!,store.get(name)!.movementSeq??0));
    const early=await request(name,{sector:where,step:2,updatedAt:clock-route.returnMs,waiting:false});assert.equal(early.status,409);assert.match(early.body.error,/still making/);assert.equal((await kv.get<any>(key)).step,2);
    clock+=route.returnMs;
    const done=await request(name,{sector:where,step:2});assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.view.phase,'aftermath');
    const snapshot=await kv.get(key);assert.equal((await request(name,{sector:where,step:2})).body.changed,false);assert.deepEqual(await kv.get(key),snapshot);
    assert.deepEqual(await kv.get(`save:${name}`),before);
});

test('courier thanks belong to the authenticated helper, while other visitors get the same truthful resting scene',async()=>{
    const {LIFE_COURIER_LINES}=await import('../../shared/sector-life-courier.js');
    const where=52,route=lifeCourierRoute(where),key=lifeStorageKey(where),helper=actor(route.stop,where),visitor=actor(route.stop,where);
    const saved={_saveVersion:17,character:{ryo:1300}};await kv.set(`save:${visitor}`,saved);
    for(const step of [2,3]){
        const state={window:lifeWindowAt(clock),step,updatedAt:clock-route.returnMs-1000,contributors:[helper.toUpperCase()]};
        await kv.set(key,state);
        const helped=await request(helper,{sector:where},true,'GET');
        const other=await request(visitor,{sector:where,viewer:helper,contributors:[visitor],helper:visitor},true,'GET');
        assert.equal(helped.status,200);assert.equal(other.status,200);
        const courier=(reply:typeof helped)=>reply.body.view.actors.find((a:any)=>a.id===`courier:${where}`);
        assert.equal(courier(helped).line,step===2?LIFE_COURIER_LINES.arrived:LIFE_COURIER_LINES.resting);
        assert.equal(courier(other).line,step===2?LIFE_COURIER_LINES.waitingAtStop:LIFE_COURIER_LINES.unhelpedRest);
        assert.deepEqual(courier(other).motion,courier(helped).motion);
        assert.deepEqual(await kv.get(key),state);
    }
    assert.deepEqual(await kv.get(`save:${visitor}`),saved);await kv.del(key);
});

test('frontier scenery uses the original requester and only the authenticated contributor gets personal thanks',async()=>{
    const {FRONTIER_SITES,FRONTIER_LINES}=await import('../../shared/sector-frontier-work.js');
    clock=Math.floor(clock/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
    for(const where of [55,60]){
        const key=lifeStorageKey(where),helper=actor(78,where),visitor=actor(78,where),state={window:lifeWindowAt(clock),step:3,updatedAt:clock-1000,contributors:[helper.toUpperCase()]};
        await kv.set(key,state);const saved={_saveVersion:17,character:{ryo:1300}};await kv.set(`save:${visitor}`,saved);
        const helped=await request(helper,{sector:where},true,'GET'),other=await request(visitor,{sector:where,viewer:helper,contributors:[visitor],painting:'invented-floor',inspection:99},true,'GET');
        for(const response of [helped,other]){assert.equal(response.status,200);assert.equal(response.body.view.painting,FRONTIER_SITES[where].painting);assert.equal(response.body.view.campTile,78);assert.equal(response.body.view.actors[0].name,where===55?'Road Keeper Ise':'Scout Kiyo');assert(response.body.view.actors.length<=5);}
        assert.equal(helped.body.view.actors[0].line,FRONTIER_LINES.helperThanks);assert.equal(other.body.view.actors[0].line,FRONTIER_LINES.rest);
        assert.deepEqual(await kv.get(key),state);assert.deepEqual(await kv.get(`save:${visitor}`),saved);await kv.del(key);
    }
});
