import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { sealGatherFind } from './_gather.js';
import { countOwned } from '../craft/_forge.js';
import { MAX_PENDING_FINDS } from '../../shared/gathering.js';
process.env.NODE_ENV='test';
process.env.SHINOBIX_QA_MEMORY_KV='1';
process.env.SESSION_SECRET='gather-integration-test-secret';
type Json=Record<string,unknown>;
type Handler=(req:never,res:never)=>Promise<unknown>;
let kv:typeof import('../_storage.js').kv;
let token:typeof import('../_auth.js').issuePlayerToken;
let online:typeof import('../_realtime/online-store.js').onlineStore;
let claim:Handler;let explore:Handler;let forge:Handler;let cafeteria:Handler;let donate:Handler;
before(async()=>{
    ({kv}=await import('../_storage.js'));({issuePlayerToken:token}=await import('../_auth.js'));
    ({onlineStore:online}=await import('../_realtime/online-store.js'));
    claim=(await import('./claim-gather.js')).default as unknown as Handler;
    explore=(await import('./explore.js')).default as unknown as Handler;
    forge=(await import('../craft/forge.js')).default as unknown as Handler;
    cafeteria=(await import('../player/cafeteria.js')).default as unknown as Handler;
    donate=(await import('../village/treasury/donate.js')).default as unknown as Handler;
});
async function post(handler:Handler,player:string,body:Json,authenticated=true){
    const out:{status:number;body:Json}={status:200,body:{}};
    const res={setHeader(){return res;},status(n:number){out.status=n;return res;},json(b:Json){out.body=b;return res;},end(){return res;}};
    await handler({method:'POST',body:{playerName:player,...body},headers:authenticated?{'x-player-token':token(player),'content-type':'application/json'}:{},socket:{remoteAddress:'127.4.5.6'}} as never,res as never);
    return out;
}
async function seed(player:string,patch:Json={}){
    const character={name:player,level:65,hp:100,maxHp:100,chakra:100,maxChakra:100,stamina:100,maxStamina:100,
        ryo:99,inventory:[],itemStacks:[],...patch};
    await kv.set('save:'+player,{_saveVersion:1,_saveAt:Date.now(),currentSector:33,character});
    online.upsert({name:player,sector:33,character:{level:65},tile:5});
}
const find=()=>sealGatherFind('integration-find-001',33,()=>0,Date.now()-90*86400000)!;
const choice={findId:'integration-find-001',sector:33,common:'gather-iron-sand',takeTrace:true};
test('authenticated claims ignore client amounts, survive expired discovery receipts and lost replies',async()=>{
    const player='gatherintegrationone';await seed(player,{pendingGatherFinds:[find()]});
    assert.equal((await post(claim,player,choice,false)).status,401);
    const first=await post(claim,player,{...choice,amount:999,rareItemId:'gather-rime-crystal'});
    assert.equal(first.status,200);const c=first.body.character as Json;
    assert.equal(countOwned(c,'gather-iron-sand'),2);assert.equal(countOwned(c,'gather-ember-ore'),1);
    assert.equal(countOwned(c,'gather-rime-crystal'),0);assert.equal(c.ryo,99);
    const retry=await post(claim,player,choice);assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);
    assert.equal(countOwned(retry.body.character as Json,'gather-iron-sand'),2);
    assert.equal(retry.body._saveVersion,first.body._saveVersion);
});
test('concurrent devices commit only once and a changed committed choice cannot pay again',async()=>{
    const player='gatherintegrationconcurrent';await seed(player,{pendingGatherFinds:[find()]});
    const results=await Promise.all([post(claim,player,choice),post(claim,player,choice)]);
    assert.ok(results.some(r=>r.status===200));
    const retry=await post(claim,player,choice);assert.equal(retry.status,200);
    const saved=await kv.get<{character:Json}>('save:'+player);
    assert.equal(countOwned(saved!.character,'gather-iron-sand'),2);
    assert.equal(countOwned(saved!.character,'gather-ember-ore'),1);
    assert.equal((await post(claim,player,{...choice,common:'gather-field-herb'})).status,409);
});
test('forged sector and unavailable trace refuse without consuming the pending find',async()=>{
    const player='gatherintegrationforgery';await seed(player,{pendingGatherFinds:[{...find(),rareTrace:false}]});
    assert.equal((await post(claim,player,{...choice,sector:12})).status,409);
    assert.equal((await post(claim,player,choice)).status,409);
    assert.equal((await post(claim,player,{...choice,common:'gather-ember-ore'})).status,400);
    const result=await post(claim,player,{...choice,takeTrace:false});assert.equal(result.status,200);
    assert.equal(countOwned(result.body.character as Json,'gather-iron-sand'),3);
});
test('pending find outlives explore receipt ring and TTL and never rerolls on explore replay',async()=>{
    const player='gatherintegrationrotation';await seed(player,{pendingGatherFinds:[find()],redeemedSectorExplorations:[]});
    const replay=await post(explore,player,{requestId:find().id,sector:33,resolveOutcome:true});
    assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
    assert.equal((replay.body.outcome as Json).kind,'gather');
    assert.equal(((replay.body.outcome as Json).find as Json).rareTrace,true);
    assert.equal((replay.body.character as Json).serverExploresToday,undefined);
    assert.equal((await post(explore,player,{requestId:find().id,sector:12,resolveOutcome:true})).status,409);
});
test('queue cap is actionable and collecting a find clears it without spending another tile',async()=>{
    const player='gatherintegrationcapacity';
    await seed(player,{pendingGatherFinds:Array.from({length:MAX_PENDING_FINDS},(_,i)=>({...find(),id:i===0?choice.findId:'capacity-find-'+i}))});
    const refused=await post(explore,player,{requestId:'capacity-new-explore',sector:33,resolveOutcome:true});
    assert.equal(refused.status,409);assert.equal(refused.body.error,'pending-find-limit');
    const collected=await post(claim,player,choice);assert.equal(collected.status,200);
    assert.equal(((collected.body.character as Json).pendingGatherFinds as unknown[]).length,MAX_PENDING_FINDS-1);
});
test('one atomic explore seals the find, consumes one pool slot, and replays without more credit',async()=>{
    const player='gatherintegrationatomic';await seed(player,{itemStacks:[{itemId:'hunt-beast-meat',count:3},{itemId:'gather-iron-sand',count:3},{itemId:'gather-heartwood-bark',count:1},{itemId:'gather-binding-fiber',count:2}]});
    const {sectorPoolKey,cleanSectorPoolRow}=await import('./_sector-pool.js');
    const poolKey=sectorPoolKey(33,Date.now());const beforePool=cleanSectorPoolRow(await kv.get(poolKey)).explores;
    const original=crypto.randomInt;
    const values=[990000000,990000000,10000000];
    crypto.randomInt=((...args:unknown[])=>args.length===1&&args[0]===1000000000?values.shift()??10000000:Reflect.apply(original,crypto,args)) as typeof original;
    syncBuiltinESMExports();
    let first:Awaited<ReturnType<typeof post>>;
    try{first=await post(explore,player,{requestId:'atomic-explore-find',sector:33,resolveOutcome:true});}
    finally{crypto.randomInt=original;syncBuiltinESMExports();}
    assert.equal(first!.status,200);
    assert.equal((first!.body.outcome as Json).kind,'gather');
    const c=first!.body.character as Json;assert.equal(c.ryo,99);assert.equal(c.serverExploresToday,1);
    assert.equal((c.pendingGatherFinds as unknown[]).length,1);
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores,beforePool+1);
    const replay=await post(explore,player,{requestId:'atomic-explore-find',sector:33,resolveOutcome:true});
    assert.equal(replay.status,200);assert.deepEqual(replay.body.outcome,first!.body.outcome);
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores,beforePool+1);

    // Spend the actual exploration reward through the authenticated forge route.
    // A later claim retry must return the current balance, not restore spent ore.
    const harvest={findId:'atomic-explore-find',sector:33,common:'gather-iron-sand',takeTrace:false};
    const claimed=await post(claim,player,harvest);assert.equal(claimed.status,200,JSON.stringify(claimed.body));
    assert.equal(countOwned(claimed.body.character as Json,'gather-iron-sand'),6);
    const craftBody={requestId:'gather-journey-shuriken',kind:'supply',recipeId:'thrown-shuriken',quantity:1,materials:[{'gather-iron-sand':6},{'gather-heartwood-bark':1},{'gather-binding-fiber':2}]};
    const crafted=await post(forge,player,craftBody);assert.equal(crafted.status,200,JSON.stringify(crafted.body));
    const forged=crafted.body.character as Json;
    assert.equal(countOwned(forged,'thrown-shuriken'),3);
    assert.equal(countOwned(forged,'gather-iron-sand'),0);
    assert.equal(countOwned(forged,'hunt-beast-meat'),3,'forging throwing stars preserves food');
    assert.equal(forged.ryo,99,'shuriken crafting adds no ryo fee');
    const craftRetry=await post(forge,player,craftBody);assert.equal(craftRetry.status,200);
    assert.equal(countOwned(craftRetry.body.character as Json,'thrown-shuriken'),3);
    const claimRetry=await post(claim,player,harvest);assert.equal(claimRetry.status,200);
    assert.equal(claimRetry.body.replayed,true);
    assert.equal(countOwned(claimRetry.body.character as Json,'gather-iron-sand'),0);
    assert.equal((claimRetry.body.character as Json).serverExploresToday,1);
    assert.deepEqual((await kv.get<{character:Json}>('save:'+player))!.character,claimRetry.body.character);
});


test('craft requests require exact materials and retries never consume a second selection',async()=>{
    const player='exactmaterialforge';
    await seed(player,{itemStacks:[{itemId:'gather-iron-sand',count:20},{itemId:'gather-iron-sand-fine',count:3},{itemId:'gather-iron-sand-pristine',count:5},{itemId:'gather-heartwood-bark',count:1},{itemId:'gather-binding-fiber',count:2}]});
    const base={requestId:'exact-craft-request-one',kind:'supply',recipeId:'thrown-shuriken',quantity:1};
    const before=await kv.get('save:'+player);
    assert.equal((await post(forge,player,base)).status,400);
    assert.deepEqual(await kv.get('save:'+player),before);
    const invalid=await post(forge,player,{...base,materials:[{'gather-iron-sand-fine':6},{'gather-heartwood-bark':1},{'gather-binding-fiber':2}]});
    assert.equal(invalid.status,409);assert.deepEqual(await kv.get('save:'+player),before);
    const accepted=await post(forge,player,{...base,materials:[{'gather-iron-sand':4,'gather-iron-sand-fine':2},{'gather-heartwood-bark':1},{'gather-binding-fiber':2}]});
    assert.equal(accepted.status,200,JSON.stringify(accepted.body));
    assert.equal(countOwned(accepted.body.character as Json,'gather-iron-sand'),16);
    assert.equal(countOwned(accepted.body.character as Json,'gather-iron-sand-fine'),1);
    assert.equal(countOwned(accepted.body.character as Json,'gather-iron-sand-pristine'),5);
    const replay=await post(forge,player,{...base,materials:[{'gather-iron-sand':1,'gather-iron-sand-pristine':5},{'gather-heartwood-bark':1},{'gather-binding-fiber':2}]});
    assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
    assert.deepEqual(replay.body.character,accepted.body.character);
});

test('claimed herbs cook into rations, combine into a bundle, and donate through the saved village ledger',async()=>{
    const player='gatherintegrationprovisions';
    const villageKey='game:village-state:leaf';
    await kv.set(villageKey,{village:'Leaf',treasury:{ryo:0,items:[]}});
    const commons=['gather-field-herb','gather-field-herb','gather-binding-fiber','gather-iron-sand'];
    const finds=commons.map((_,i)=>sealGatherFind('provision-journey-find-'+i,33,()=>0.9)!);
    await seed(player,{village:'Leaf',itemStacks:[{itemId:'hunt-beast-meat',count:1},{itemId:'gather-heartwood-bark',count:1}],pendingGatherFinds:finds});
    let lastVersion=1;
    for(let i=0;i<finds.length;i++){
        const out=await post(claim,player,{findId:finds[i].id,sector:33,common:commons[i],takeTrace:false});
        assert.equal(out.status,200,JSON.stringify(out.body));
        assert.ok(Number(out.body._saveVersion)>lastVersion);lastVersion=Number(out.body._saveVersion);
    }
    const cooked=await post(cafeteria,player,{recipeId:'field-rations'});
    assert.equal(cooked.status,200,JSON.stringify(cooked.body));
    assert.equal(countOwned(cooked.body.character as Json,'ration-pack'),5);
    assert.equal(countOwned(cooked.body.character as Json,'gather-field-herb'),5);
    assert.equal((cooked.body.character as Json).ryo,69);
    assert.equal(cooked.body.dailyCooked,5);assert.equal(cooked.body.dailyCap,40);
    assert.ok(Number(cooked.body._saveVersion)>lastVersion);lastVersion=Number(cooked.body._saveVersion);

    const craftBody={requestId:'gather-journey-bundle',kind:'supply',recipeId:'village-supply-bundle',quantity:1,materials:[{'ration-pack':5},{'gather-field-herb':3},{'gather-binding-fiber':3},{'gather-iron-sand':3}]};
    const crafted=await post(forge,player,craftBody);assert.equal(crafted.status,200,JSON.stringify(crafted.body));
    const packed=crafted.body.character as Json;
    assert.equal(countOwned(packed,'village-supply-bundle'),1);
    assert.equal(countOwned(packed,'ration-pack'),0);assert.equal(countOwned(packed,'gather-field-herb'),2);
    assert.equal(countOwned(packed,'gather-binding-fiber'),0);assert.equal(countOwned(packed,'gather-iron-sand'),0);
    assert.equal(packed.ryo,39);
    assert.ok(Number(crafted.body._saveVersion)>lastVersion);lastVersion=Number(crafted.body._saveVersion);
    const beforeRefusal=await kv.get('save:'+player);
    const refused=await post(forge,player,{...craftBody,requestId:'gather-journey-missing-input'});
    assert.equal(refused.status,409);assert.deepEqual(await kv.get('save:'+player),beforeRefusal);

    const donation={village:'Leaf',itemId:'village-supply-bundle',count:1,requestId:'gather-journey-donation'};
    const donated=await post(donate,player,donation);assert.equal(donated.status,200,JSON.stringify(donated.body));
    const final=donated.body.character as Json;
    assert.equal(countOwned(final,'village-supply-bundle'),0);
    assert.equal(final.rationsDonatedToday,10);assert.equal(final.ryo,39);
    assert.deepEqual(donated.body.stores,{provisions:10,materialPoints:0});
    assert.ok(Number(donated.body._saveVersion)>lastVersion);
    const {meritForDonation}=await import('../village/_village-merit.js');
    assert.equal(final.villageMerit,meritForDonation(500));
    const retry=await post(donate,player,donation);assert.equal(retry.status,200);assert.equal(retry.body.replayed,true);
    const treasury=(await kv.get<{treasury:Json}>(villageKey))!.treasury;
    assert.equal(treasury.provisions,10);assert.deepEqual(treasury.items,[]);
    const reloaded=(await kv.get<{character:Json}>('save:'+player))!.character;
    assert.deepEqual(reloaded.pendingGatherFinds,[]);assert.equal(reloaded.gatherIntroSeen,true);
    assert.equal(countOwned(reloaded,'village-supply-bundle'),0);assert.equal(countOwned(reloaded,'gather-field-herb'),2);
    assert.equal(reloaded.rationsDonatedToday,10);assert.equal(reloaded.villageMerit,meritForDonation(500));
});
