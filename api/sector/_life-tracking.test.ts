import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import { lifeEventView,parseLifeState,lifeStorageKey,LIFE_WINDOW_MS } from '../../shared/sector-life.js';
import { PLAYABLE_WILD_SECTOR_IDS } from '../../shared/sector-geo.js';
import { WANDERER_BUCKET_MS } from '../../shared/wanderer-roster.js';
import { trackerTrailSectors,TRACKER_TRAIL_TTL_MS } from '../../shared/tracker-trail.js';

process.env.NODE_ENV='test';process.env.SHINOBIX_QA_MEMORY_KV='1';
let kv:typeof import('../_storage.js').kv,link:typeof import('./_life-tracking.js').linkLifeTracking,refresh:typeof import('./_life-tracking.js').refreshLifeTracking;
function findSite(){for(let round=0;round<16;round++)for(const sector of PLAYABLE_WILD_SECTOR_IDS){const now=82_000*WANDERER_BUCKET_MS+round*LIFE_WINDOW_MS+60_000,view=lifeEventView(sector,parseLifeState(null,now),now);if(view.kind==='tracks'&&view.tracker)return {now,sector,tracker:view.tracker};}throw Error('No tracking site');}
const {now,sector,tracker}=findSite(),owner='worldtrailtester',id='trail-world-authority-0001',requestId='world-trail-authority-0001',key=lifeStorageKey(sector);
before(async()=>{({kv}=await import('../_storage.js'));({linkLifeTracking:link,refreshLifeTracking:refresh}=await import('./_life-tracking.js'));});
beforeEach(async()=>{for(const key of await kv.keys('*'))await kv.del(key);});
after(()=>{delete process.env.SHINOBIX_QA_MEMORY_KV;});
async function seed(){const state={...parseLifeState(null,now),step:1,updatedAt:now-1000};const trail={id,requestId,giver:tracker.name,originSector:sector,sectors:trackerTrailSectors(id,sector),step:0 as const,expiresAt:now+TRACKER_TRAIL_TTL_MS};await kv.set(key,state);await kv.set(`tracker-trail:${owner}`,trail);return {state,trail};}
function receipt(){return {version:1,playerName:owner,requestId,day:'2026-10-19',sector:trackerTrailSectors(id,sector)[1],mintedAt:now,token:'0123456789abcdef0123456789abcdef',pet:{id:'standard-0'},trackerTrailId:id,resolvedAt:now+5000,resolution:'befriended'};}
test('world continuation accepts only the already committed natural tracker trail',async()=>{
    const {trail}=await seed();assert.equal(await link(owner,{...trail,id:'trail-forged-world-0001'},tracker.id,now),false);
    assert.equal(await link('anotherplayer',trail,tracker.id,now),false);assert.equal(await link(owner,trail,'w-forged',now),false);
    await kv.set(`tracker-trail:${owner}`,{...trail,expiresAt:now+TRACKER_TRAIL_TTL_MS-2000});assert.equal(await link(owner,{...trail,expiresAt:now+TRACKER_TRAIL_TTL_MS-2000},tracker.id,now),false,'an old personal lead cannot be claimed as new world work');
    await kv.set(`tracker-trail:${owner}`,trail);assert.equal(await link(owner,trail,tracker.id,now),true);assert.equal(await link(owner,trail,tracker.id,now),false,'a shared party is linked once');
});
test('an unsuccessful cosmetic link leaves the personal trail intact and a later world read repairs it',async t=>{
    const {trail}=await seed(),original=kv.compareSet.bind(kv);t.mock.method(kv,'compareSet',async(k:string,expected:unknown,value:unknown,options?:{ex?:number})=>k===key?false:original(k,expected,value,options));
    assert.equal(await link(owner,trail,tracker.id,now),false);assert.deepEqual(await kv.get(`tracker-trail:${owner}`),trail);t.mock.restoreAll();
    assert.equal((await refresh(sector,now,owner)).hunt?.trailId,id);
});
test('cross-player, mismatched and future encounter receipts cannot invent a binding',async()=>{
    const {trail}=await seed();assert(await link(owner,trail,tracker.id,now));
    for(const bad of [{playerName:'anotherplayer'},{requestId:'different-request-0001'},{trackerTrailId:'trail-other-world-0001'},{sector},{mintedAt:now-1},{resolvedAt:now+6000},{token:undefined,pet:undefined}]){
        await kv.set(`pet-encounter-request:${owner}:${requestId}`,{...receipt(),...bad});assert.equal((await refresh(sector,now+5000)).hunt?.result,undefined,JSON.stringify(bad));
    }
    await kv.set(`pet-encounter-request:${owner}:${requestId}`,receipt());const ended=await refresh(sector,now+5000);assert.equal(ended.hunt?.result,'bound');
    const stored=await kv.get(key);await refresh(sector,now+6000);assert.deepEqual(await kv.get(key),stored,'the first result timestamp cannot be extended');
});
test('a refused result CAS retains the durable receipt for a later read to reconcile',async t=>{
    const {trail}=await seed();assert(await link(owner,trail,tracker.id,now));await kv.set(`pet-encounter-request:${owner}:${requestId}`,receipt());const original=kv.compareSet.bind(kv);
    t.mock.method(kv,'compareSet',async(k:string,expected:unknown,value:unknown,options?:{ex?:number})=>k===key?false:original(k,expected,value,options));assert.equal((await refresh(sector,now+5000)).hunt?.result,undefined);t.mock.restoreAll();
    assert.equal((await refresh(sector,now+6000)).hunt?.result,'bound');
});
test('abandoned or expired leads bring people home without claiming an animal was bound',async()=>{
    const {trail}=await seed();assert(await link(owner,trail,tracker.id,now));await kv.del(`tracker-trail:${owner}`);const cold=await refresh(sector,now+1000);assert.equal(cold.hunt?.result,'cold');
    await seed();assert(await link(owner,trail,tracker.id,now));const expired=await refresh(sector,trail.expiresAt);assert.equal(expired.hunt?.result,'cold');assert.equal(expired.step,0,'a result from the previous round must not finish this round');
});
