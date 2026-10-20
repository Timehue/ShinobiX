import { before,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherGroundOrigin,harvestGroundKey,rememberHarvestGround,readHarvestGround } from './_harvest-ground.js';
import { harvestGroundTile,HARVEST_GROUND_MS } from '../../shared/sector-harvest.js';
import { sealGatherFind } from './_gather.js';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';

process.env.NODE_ENV='test';process.env.SHINOBIX_QA_MEMORY_KV='1';process.env.SESSION_SECRET='harvest-ground-integration-secret';
let kv:typeof import('../_storage.js').kv,online:typeof import('../_realtime/online-store.js').onlineStore;
let token:typeof import('../_auth.js').issuePlayerToken,claim:typeof import('./claim-gather.js').default,life:typeof import('../sector/life.js').default;
const sector=42,tile=harvestGroundTile(sector,125)!,model=worldPositionModel();
before(async()=>{({kv}=await import('../_storage.js'));({onlineStore:online}=await import('../_realtime/online-store.js'));({issuePlayerToken:token}=await import('../_auth.js'));claim=(await import('./claim-gather.js')).default as unknown as typeof claim;life=(await import('../sector/life.js')).default as unknown as typeof life;});
beforeEach(async()=>{await kv.del(harvestGroundKey(sector));});
async function request(handler:typeof claim,name:string,body:Record<string,unknown>,method='POST'){
    const output:{status:number;body:any}={status:200,body:null};const res={setHeader(){},status(status:number){output.status=status;return res;},json(value:unknown){output.body=value;return res;},end(){return res;}};
    await handler({method,body:{playerName:name,...body},query:{playerName:name,...body},headers:{'x-player-name':name,'x-player-token':token(name)},socket:{remoteAddress:'10.88.10.1'}} as never,res as never);return output;
}
test('new finds locate only fresh accepted server cursors, never a claimed tile or stale presence',t=>{
    t.mock.timers.enable({apis:['Date'],now:Date.now()});
    const now=Date.now(),name='harvestorigin';online.upsert({name,sector,tile,character:null,restoredWorldPosition:model.fallback(sector,tile)!});
    const player=online.get(name)!;player.lastSeenAt=now;assert.equal(gatherGroundOrigin(player,sector,now),tile);
    for(const patch of [{worldPosition:undefined,tile:7},{lastSeenAt:now-30_001},{lastSeenAt:now+1},{locationUnverified:true},{inBattle:true},{travelingUntil:now+1000},{sector:15}])assert.equal(gatherGroundOrigin({...player,...patch},sector,now),undefined);
});
test('a real committed gather claim produces shared ground memory, preserves rewards and cannot move or refresh it on replay',async()=>{
    const name='harvestclaim',now=Date.now(),id='harvest-real-claim-0001',find=sealGatherFind(id,sector,()=>1,now,tile)!;
    await kv.set(`save:${name}`,{_saveVersion:1,character:{name,ryo:77,pendingGatherFinds:[find]}});
    const body={sector,findId:id,common:'gather-field-herb',takeTrace:false,groundTile:77,at:now+999999};
    const first=await request(claim,name,body);assert.equal(first.status,200);assert.deepEqual(first.body.rewards,[{itemId:'gather-field-herb',count:3}]);assert.equal(first.body.character.ryo,77);
    const saved=await kv.get(`save:${name}`),marks=await kv.get(harvestGroundKey(sector));
    assert.deepEqual(await readHarvestGround(sector,now),[[tile,undefined,now+HARVEST_GROUND_MS]]);
    const retry=await request(claim,name,body);assert.equal(retry.status,200);assert(retry.body.replayed);assert.deepEqual(await kv.get(`save:${name}`),saved);assert.deepEqual(await kv.get(harvestGroundKey(sector)),marks);
    const other=await request(life,'harvestobserver',{sector},'GET');assert.equal(other.status,200);assert(other.body.view.groundTrail.some((m:number[])=>m[0]===tile&&m[2]===now+HARVEST_GROUND_MS));assert(!JSON.stringify(other.body).includes('harvest-real-claim-0001'));
    const forged=await request(claim,name,{...body,findId:'harvest-forged-find-0001'});assert.equal(forged.status,409);assert.deepEqual(await kv.get(harvestGroundKey(sector)),marks);
    assert.deepEqual(await readHarvestGround(sector,now+HARVEST_GROUND_MS),[]);
});
test('storage contention cannot fail a committed reward and an exact retry repairs only the original mark',async t=>{
    const name='harvestrepair',now=Date.now(),id='harvest-repair-claim-001',find=sealGatherFind(id,sector,()=>1,now,tile)!;
    await kv.set(`save:${name}`,{_saveVersion:1,character:{name,pendingGatherFinds:[find]}});
    const original=kv.compareSet.bind(kv);t.mock.method(kv,'compareSet',async(key:string,...args:Parameters<typeof kv.compareSet> extends [string,...infer R]?R:never)=>key===harvestGroundKey(sector)?false:original(key,...args));
    const body={sector,findId:id,common:'gather-binding-fiber',takeTrace:false};
    const first=await request(claim,name,body);assert.equal(first.status,200);assert.deepEqual(await readHarvestGround(sector,now),[]);const saved=await kv.get(`save:${name}`);
    t.mock.restoreAll();const retry=await request(claim,name,body);assert.equal(retry.status,200);assert(retry.body.replayed);assert.deepEqual(await kv.get(`save:${name}`),saved);assert.deepEqual(await readHarvestGround(sector,now),[[tile,undefined,now+HARVEST_GROUND_MS]]);
});
test('late, future, legacy and road records stay invisible; concurrent gatherers retain separate records',async()=>{
    const now=Date.now();await Promise.all(Array.from({length:8},(_,i)=>rememberHarvestGround(`worker${i}`,'harvest-concurrent-001',sector,{tile,at:now},now)));
    assert.equal((await kv.get<unknown[]>(harvestGroundKey(sector)))!.length,8);assert.equal((await readHarvestGround(sector,now)).length,1,'overlapping work does not stack dark patches');
    const prior=await kv.get(harvestGroundKey(sector));for(const ground of [undefined,{tile:65,at:now},{tile,at:now+1},{tile,at:now-HARVEST_GROUND_MS}])await rememberHarvestGround('invalid','harvest-rejected-001',sector,ground,now);
    assert.deepEqual(await kv.get(harvestGroundKey(sector)),prior);
});
