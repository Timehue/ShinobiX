import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { KvLike } from '../_storage.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import type { BuildingAction } from '../../shared/sector-building-types.js';
import type { CraftMaterialSelection } from '../../shared/crafting-recipes.js';
import { battleLockKey } from '../_elapsed-state.js';
import { festivalStallPlan } from '../../shared/sector-festival-work.js';
import { WORLD_HOUR_MS } from '../../shared/world-clock.js';

process.env.SHINOBIX_QA_MEMORY_KV='1';process.env.NODE_ENV='test';
let kv:typeof import('../_storage.js').kv;
let settle:typeof import('./_building-settlement.js').settleBuildingAction;
let reduce:typeof import('./_building-actions.js').reduceBuildingAction;
let withLock:typeof import('../_lock.js').withKvLock;
let building:NonNullable<ReturnType<typeof import('../../shared/sector-buildings.js').sectorBuilding>>;
const NOW=Date.now();
const materials:CraftMaterialSelection=[{'gather-iron-sand':3},{'hunt-torn-hide':2},{'gather-river-fish':2},{'gather-binding-fiber':4}];
before(async()=>{
    ({kv}=await import('../_storage.js'));({settleBuildingAction:settle}=await import('./_building-settlement.js'));
    ({reduceBuildingAction:reduce}=await import('./_building-actions.js'));({withKvLock:withLock}=await import('../_lock.js'));
    building=(await import('../../shared/sector-buildings.js')).sectorBuilding('gorgewatch')!;
});
beforeEach(async()=>{
    for(const pattern of ['save:*','world:building:*','world:territory:*','ledger:currency:*'])for(const key of await kv.keys(pattern))await kv.del(key);
});
const presence=(player='builder'):OnlinePlayer=>({name:player,displayName:player,sector:38,tile:building.approach,lastSeenAt:NOW,connectedAt:NOW,pendingAttacker:null,character:null});
function prepared(player='builder',priorRepairs=0,shardClaims=0){
    let c:Record<string,unknown>={name:player,level:100,ryo:1000,boneCharms:0,fateShards:0,inventory:[],itemStacks:[
        {itemId:'gather-iron-sand',count:30},{itemId:'hunt-torn-hide',count:20},{itemId:'gather-river-fish',count:20},{itemId:'gather-binding-fiber',count:40}]};
    c.sectorBuildings={repairs:priorRepairs,shardClaims};
    const begin=reduce(c,{action:'begin',buildingId:building.id,service:'repair',materials,requestId:`${player}-begin-00001`},null,{now:NOW-18000,orderId:`${player}-order`,displayName:player});
    assert.ok(begin.ok);c=begin.character;
    for(let step=0;step<2;step++){
        const r=reduce(c,{action:'step',buildingId:building.id,orderId:`${player}-order`,step,requestId:`${player}-step-${step}-0001`},null,{now:NOW-12000+step*6000,orderId:`${player}-receipt-${step}`,displayName:player});
        assert.ok(r.ok);c=r.character;
    }
    return{_saveVersion:1,character:c};
}
const finalAction=(player='builder'):BuildingAction=>({action:'step',buildingId:'gorgewatch',orderId:`${player}-order`,step:2,requestId:`${player}-finish-00001`});
const run=(store:Pick<KvLike,'get'|'compareSet'>&Partial<Pick<KvLike,'compareSetMany'>>,player='builder',p=presence(player))=>
    withLock('world:building:gorgewatch',()=>withLock(`save:${player}`,()=>settle(store,player,finalAction(player),{now:NOW,orderId:`${player}-final-receipt`,presence:p}),{failClosed:true}),{failClosed:true});

test('festival tea settlement reads the actual territory sky, charges only an open ledge and honors a reserved cup after packing',async()=>{
    const tea=(await import('../../shared/sector-buildings.js')).sectorBuilding('festival-tea-counter')!;
    const plan=festivalStallPlan(Date.UTC(2026,9,23)+6*WORLD_HOUR_MS),now=plan.packAt-1000;
    await kv.set('save:tea-visitor',{_saveVersion:1,character:{name:'tea-visitor',level:85,ryo:1000}});
    const invoke=(action:BuildingAction,at:number,orderId:string)=>withLock(`world:building:${tea.id}`,()=>withLock('save:tea-visitor',()=>settle(kv,'tea-visitor',action,{now:at,orderId,presence:{...presence('tea-visitor'),sector:52,tile:tea.approach,lastSeenAt:at}}),{failClosed:true}),{failClosed:true});
    const request:BuildingAction={action:'tea',buildingId:tea.id,requestId:'native-tea-admission-001'};
    await kv.set('world:territory:52',{ownerClan:'HostClan',weather:'rain'});
    const before=await kv.get('save:tea-visitor');assert.equal((await invoke(request,now,'tea-cup')).ok,false);
    assert.deepEqual(await kv.get('save:tea-visitor'),before);assert.equal(await kv.get('ledger:currency:tea-visitor'),null);
    await kv.set('world:territory:52',{ownerClan:'HostClan',weather:'clear'});
    assert.ok((await invoke(request,now,'tea-cup')).ok);
    const closed=plan.packAt+15000;
    assert.ok((await invoke({action:'step',buildingId:tea.id,orderId:'tea-cup',step:0,requestId:'native-tea-finish-after-close'},closed,'tea-served')).ok);
    const saved=await kv.get<{character:{ryo:number;sectorBuildings:{active?:unknown}}}>('save:tea-visitor');
    assert.equal(saved?.character.ryo,970);assert.equal(saved?.character.sectorBuildings.active,undefined);
    assert.ok(await kv.get('ledger:currency:tea-visitor'));
});

test('repair payout, protected receipt, shared stage and currency ledger commit once under concurrent retries',async()=>{
    await kv.set('save:builder',prepared());await kv.set('world:building:gorgewatch',{version:1,repairs:3,revision:1});
    const results=await Promise.all([run(kv),run(kv)]);assert.ok(results.every(r=>r.ok));
    const saved=await kv.get<{character:Record<string,unknown>}>('save:builder'),shared=await kv.get<{repairs:number;stage:number}>('world:building:gorgewatch');
    assert.equal(saved?.character.ryo,1180);assert.equal(shared?.repairs,4);assert.equal(shared?.stage,1);
    assert.equal((saved?.character.sectorBuildings as {active?:unknown}).active,undefined,'completion must clear the durable work order');
    assert.equal(results.filter(r=>r.ok&&r.replayed).length,1);
    const ledger=await kv.get<Record<string,unknown>>('ledger:currency:builder');assert.ok(ledger,'payout must use the existing atomic currency commit');
});

test('a fresh request cannot reopen or repay a completed order after reload',async()=>{
    await kv.set('save:builder',prepared());assert.ok((await run(kv)).ok);
    const after=await kv.get('save:builder');
    const retry=await withLock('world:building:gorgewatch',()=>withLock('save:builder',()=>settle(kv,'builder',
        {...finalAction(),requestId:'builder-fresh-finish-0002'},
        {now:NOW+6000,orderId:'fresh-receipt',presence:{...presence(),lastSeenAt:NOW+6000}}),{failClosed:true}),{failClosed:true});
    assert.equal(retry.ok,false);assert.deepEqual(await kv.get('save:builder'),after);
    assert.equal((await kv.get<{repairs:number}>('world:building:gorgewatch'))?.repairs,1);
});

test('overlapping charm and shard milestones commit once with their receipt and ledger under concurrent retries',async()=>{
    await kv.set('save:builder',prepared('builder',59,2));
    const results=await Promise.all([run(kv),run(kv)]);assert.ok(results.every(r=>r.ok));
    const saved=await kv.get<{character:{ryo:number;boneCharms:number;fateShards:number;sectorBuildings:{repairs:number;shardClaims:number;receipts:{reward:unknown}[]}}}>('save:builder');
    assert.equal(saved?.character.ryo,1180);assert.equal(saved?.character.boneCharms,3);assert.equal(saved?.character.fateShards,5);
    assert.equal(saved?.character.sectorBuildings.repairs,60);assert.equal(saved?.character.sectorBuildings.shardClaims,3);
    assert.deepEqual(saved?.character.sectorBuildings.receipts.at(-1)?.reward,{ryo:180,boneCharms:3,fateShards:5});
    assert.equal(results.filter(r=>r.ok&&r.replayed).length,1);
    assert.equal((await kv.get<{repairs:number}>('world:building:gorgewatch'))?.repairs,1);
    const ledger=await kv.get<{balances:Record<string,number>}>('ledger:currency:builder');
    assert.equal(ledger?.balances.ryo,1180);assert.equal(ledger?.balances.boneCharms,3);assert.equal(ledger?.balances.fateShards,5);
});

test('legacy deferred shard batches settle together once with the save, shared work and ledger',async()=>{
    const original=prepared('builder',79,2);
    await kv.set('save:builder',original);
    const results=await Promise.all([run(kv),run(kv)]);assert.ok(results.every(r=>r.ok));
    const saved=await kv.get<{character:{fateShards:number;sectorBuildings:{repairs:number;shardClaims:number;receipts:{reward:{fateShards:number}}[]}}}>('save:builder');
    assert.equal(saved?.character.fateShards,10);assert.equal(saved?.character.sectorBuildings.repairs,80);assert.equal(saved?.character.sectorBuildings.shardClaims,4);
    assert.equal(saved?.character.sectorBuildings.receipts.at(-1)?.reward.fateShards,10);
    assert.equal(results.filter(r=>r.ok&&r.replayed).length,1);
    const ledger=await kv.get<{balances:Record<string,number>}>('ledger:currency:builder');assert.equal(ledger?.balances.fateShards,10);
    assert.equal((await kv.get<{repairs:number}>('world:building:gorgewatch'))?.repairs,1);
});

test('cancellation durably clears escrow and refunds exact grades only once',async()=>{
    await kv.set('save:builder',prepared());
    const cancel:BuildingAction={action:'cancel',buildingId:'gorgewatch',orderId:'builder-order',requestId:'cancel-builder-00001'};
    const act=(action:BuildingAction)=>withLock('world:building:gorgewatch',()=>withLock('save:builder',()=>settle(kv,'builder',action,
        {now:NOW,orderId:'cancel-receipt',presence:presence()}),{failClosed:true}),{failClosed:true});
    const result=await act(cancel);assert.ok(result.ok);if(!result.ok)return;
    assert.equal((result.character.sectorBuildings as {active?:unknown}).active,undefined);
    assert.equal((result.character.itemStacks as {itemId:string;count:number}[]).find(s=>s.itemId==='gather-iron-sand')?.count,30);
    assert.equal(result.character.ryo,1000);
    const after=await kv.get('save:builder');
    assert.ok((await act(cancel)).ok,'same request recovers its receipt');
    assert.equal((await act({...cancel,requestId:'cancel-builder-fresh-00002'})).ok,false);
    assert.deepEqual(await kv.get('save:builder'),after);
});
test('two players repairing one frontage preserve both contributions',async()=>{
    await kv.set('save:builder',prepared());await kv.set('save:helper',prepared('helper'));
    const results=await Promise.all([run(kv),run(kv,'helper')]);assert.ok(results.every(r=>r.ok));
    const shared=await kv.get<{repairs:number;contributors:unknown[]}>('world:building:gorgewatch');assert.equal(shared?.repairs,2);assert.equal(shared?.contributors.length,2);
});
test('a failed atomic comparison writes no payout, shared stage or completion receipt',async()=>{
    const original=prepared();await kv.set('save:builder',original);
    const refused={get:kv.get.bind(kv),compareSet:kv.compareSet.bind(kv),compareSetMany:async()=>false};
    await assert.rejects(()=>run(refused),/player-save-version-conflict/);
    assert.deepEqual(await kv.get('save:builder'),original);assert.equal(await kv.get('world:building:gorgewatch'),null);
});
test('a lost transaction acknowledgement is recovered from the committed save and never pays twice',async()=>{
    await kv.set('save:builder',prepared());let lost=true;
    const store={get:kv.get.bind(kv),compareSet:kv.compareSet.bind(kv),compareSetMany:async(ops:Parameters<NonNullable<KvLike['compareSetMany']>>[0])=>{
        const committed=await kv.compareSetMany!(ops);if(committed&&lost){lost=false;throw Error('lost transaction response');}return committed;
    }};
    const result=await run(store);assert.ok(result.ok);
    const retry=await run(store);assert.ok(retry.ok);if(retry.ok){assert.equal(retry.replayed,true);assert.equal(retry.character.ryo,1180);}
    assert.equal((await kv.get<{repairs:number}>('world:building:gorgewatch'))?.repairs,1);
});
test('a backend without atomic shared writes refuses before consuming the reserved order',async()=>{
    const original=prepared();await kv.set('save:builder',original);
    const result=await run({get:kv.get.bind(kv),compareSet:kv.compareSet.bind(kv)});assert.equal(result.ok,false);
    assert.deepEqual(await kv.get('save:builder'),original);assert.equal(await kv.get('world:building:gorgewatch'),null);
});
test('distant, stale, unverified, traveling, battling and wrong-sector presence cannot settle building work',async()=>{
    const original=prepared();await kv.set('save:builder',original);
    for(const patch of [{sector:50},{lastSeenAt:NOW-31000},{locationUnverified:true},{travelingUntil:NOW+3000},{inBattle:true},{tile:143}]){
        const result=await run(kv,'builder',{...presence(),...patch});assert.equal(result.ok,false,JSON.stringify(patch));
        assert.deepEqual(await kv.get('save:builder'),original);
    }
});

test('the durable battle lease and active gathering refuse work even if presence reports idle',async()=>{
    const original=prepared();await kv.set('save:builder',original);
    await kv.set(battleLockKey('builder'),{at:NOW,sessionId:'real-battle-lease'});
    try{assert.equal((await run(kv)).ok,false);assert.deepEqual(await kv.get('save:builder'),original);}
    finally{await kv.del(battleLockKey('builder'));}
    const gathering={...original,character:{...original.character,resourceGathering:{active:{id:'gathering-order'}}}};
    await kv.set('save:builder',gathering);assert.equal((await run(kv)).ok,false);assert.deepEqual(await kv.get('save:builder'),gathering);
});

test('the communal payout preserves earned idle recovery in its reply and durable regeneration cursor',async()=>{
    const original=prepared(),at=Date.now()-30_000;
    await kv.set('save:builder',{...original,_saveAt:at,_regenAt:at,character:{...original.character,hp:10,maxHp:100,chakra:20,maxChakra:100,stamina:0,maxStamina:100}});
    const result=await run(kv);assert.ok(result.ok);if(!result.ok)return;
    assert.ok(Number(result.character.hp)>=40);assert.ok(Number(result.character.chakra)>=50);assert.ok(Number(result.character.stamina)>=30);
    const saved=await kv.get<{_regenAt:number;character:Record<string,unknown>}>('save:builder');
    assert.ok(saved!._regenAt>=at+30_000);assert.equal(saved!.character.hp,result.character.hp);
});

test('Obsidian’s isolated arena admits a nearby counter visit and refuses distant or blocked tiles',async()=>{
    const {sectorBuilding}=await import('../../shared/sector-buildings.js'),obsidian=sectorBuilding('stronghold-99')!;
    await kv.set('save:builder',{_saveVersion:1,character:{name:'builder',ryo:0}});
    const action:BuildingAction={action:'visit',buildingId:obsidian.id,requestId:'obsidian-visit-00001'};
    const act=(p:OnlinePlayer)=>withLock(`world:building:${obsidian.id}`,()=>withLock('save:builder',()=>settle(kv,'builder',action,
        {now:NOW,orderId:'obsidian-receipt',presence:p}),{failClosed:true}),{failClosed:true});
    for(const tile of [0,137])assert.equal((await act({...presence(),sector:99,tile})).ok,false);
    const result=await act({...presence(),sector:99,tile:obsidian.approach});assert.ok(result.ok);if(!result.ok)return;
    assert.equal((result.character.sectorBuildings as {standing:Record<string,{visits:number}>}).standing[obsidian.id].visits,1);
});

test('the restored watch requires its farther bridge signal point before filing a paid report',async()=>{
    await kv.set('save:builder',{_saveVersion:1,character:{name:'builder',ryo:0}});await kv.set('world:building:gorgewatch',{repairs:24});
    const call=(action:BuildingAction,at:number,tile:number)=>withLock('world:building:gorgewatch',()=>withLock('save:builder',()=>settle(kv,'builder',action,
        {now:at,orderId:`watch-receipt-${at}`,presence:{...presence(),lastSeenAt:at,tile}}),{failClosed:true}),{failClosed:true});
    const begin=await call({action:'begin',buildingId:'gorgewatch',service:'watch',requestId:'restored-watch-begin-0001'},NOW,building.approach);assert.ok(begin.ok);if(!begin.ok)return;
    const order=(begin.character.sectorBuildings as {active:{id:string;watchStage:number}}).active;assert.equal(order.watchStage,3);
    const step=(n:number):BuildingAction=>({action:'step',buildingId:'gorgewatch',orderId:order.id,step:n,requestId:`restored-watch-step-${n}-0001`});
    assert.ok((await call(step(0),NOW+6000,building.approach)).ok);
    assert.equal((await call(step(1),NOW+12000,building.approach)).ok,false,'the doorway does not prove the extended sightline');
    assert.ok((await call(step(1),NOW+12000,building.restoredWatchPoint!.tile)).ok);
    const done=await call(step(2),NOW+18000,building.approach);assert.ok(done.ok);if(!done.ok)return;
    assert.equal(done.character.ryo,80);
    const shared=await kv.get<{reports:{text:string}[]}>('world:building:gorgewatch');assert.match(shared!.reports.at(-1)!.text,/restored lookout signal/);
});
