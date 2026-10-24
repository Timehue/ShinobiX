import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceBuildingAction, buildingActionTarget } from './_building-actions.js';
import { countOwned } from '../craft/_forge.js';
import { readBuildingProgress, readSharedBuilding } from '../../shared/sector-building-state.js';
import { buildingWorkView } from '../../shared/sector-building-content.js';
import { buildingFestivalTasks } from '../../shared/sector-building-stories.js';
import { sectorBuilding } from '../../shared/sector-buildings.js';
import type { BuildingAction } from '../../shared/sector-building-types.js';
import type { CraftMaterialSelection } from '../../shared/crafting-recipes.js';

const NOW=Date.parse('2026-10-22T12:00:00Z');

test('HTTP work requests reject non-order services before they can create an unreadable order',async()=>{
    process.env.SHINOBIX_QA_MEMORY_KV='1';process.env.NODE_ENV='test';
    const {parseBuildingAction}=await import('./buildings.js');
    const body={action:'begin',buildingId:'stronghold-2',requestId:'work-validation-00001'};
    for(const service of ['reception','register','survey','workshop','unknown',null,{},12])assert.equal(parseBuildingAction({...body,service}),undefined);
    for(const service of ['repair','courier','watch','intelligence','festival','tea'])assert.equal(parseBuildingAction({...body,service})?.service,service);
});
const selection:CraftMaterialSelection=[{'gather-iron-sand':3},{'hunt-torn-hide':2},{'gather-river-fish':2},{'gather-binding-fiber':4}];
const base=():Record<string,unknown>=>({name:'builder',level:100,ryo:1000,boneCharms:0,fateShards:0,inventory:[],itemStacks:[
    {itemId:'gather-iron-sand',count:300},{itemId:'hunt-torn-hide',count:200},{itemId:'gather-river-fish',count:200},{itemId:'gather-binding-fiber',count:400},
    {itemId:'gather-iron-sand-pristine',count:3},{itemId:'gather-river-fish-pristine',count:2},
]});
let sequence=0;
function act(character:Record<string,unknown>,input:Omit<BuildingAction,'requestId'>&{requestId?:string},now=NOW,shared:unknown=null){
    const requestId=input.requestId??`request-${++sequence}-building`;
    return reduceBuildingAction(character,{...input,requestId},{...readSharedBuilding(shared)}, {now,orderId:`order-${++sequence}`,displayName:'Builder'});
}
function progress(character:Record<string,unknown>,now=NOW){return readBuildingProgress(character.sectorBuildings,now);}
function finish(character:Record<string,unknown>,now=NOW,shared:unknown=null){
    let next=character,communal=readSharedBuilding(shared);
    for(let guard=0;guard<6&&progress(next,now).active;guard++){
        const order=progress(next,now).active!,view=buildingWorkView(order)!;now=Math.max(now+6000,view.readyAt);
        const choice=order.kind==='intelligence'?['observe','read-mark',order.protocol?`handoff-${order.protocol}`:'quiet-handoff'][order.step]:order.kind==='festival'?buildingFestivalTasks(order.buildingId)[order.step].choice:undefined;
        const result=act(next,{action:'step',buildingId:order.buildingId,orderId:order.id,step:order.step,choice},now,communal);
        assert.ok(result.ok,JSON.stringify(result));if(!result.ok)throw Error('Work step failed');next=result.character;communal=result.shared;
    }
    return{character:next,shared:communal,now};
}
test('repair reserves the four selected materials, resumes after parsing, refunds once and preserves pristine stock',()=>{
    const character=base(),begun=act(character,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection});assert.ok(begun.ok);if(!begun.ok)return;
    for(const row of selection)for(const[id,count]of Object.entries(row))assert.equal(countOwned(begun.character,id),countOwned(character,id)-count);
    assert.equal(countOwned(begun.character,'gather-iron-sand-pristine'),3);
    assert.equal(countOwned(begun.character,'gather-river-fish-pristine'),2);
    const order=progress(begun.character).active!;
    const restored=act({...begun.character,sectorBuildings:progress(begun.character)},{action:'cancel',buildingId:'gorgewatch',orderId:order.id,requestId:'cancel-repair-0001'});
    assert.ok(restored.ok);if(!restored.ok)return;
    assert.equal(countOwned(restored.character,'gather-iron-sand'),300);
    const retry=act(restored.character,{action:'cancel',buildingId:'gorgewatch',orderId:order.id,requestId:'cancel-repair-0001'});
    assert.ok(retry.ok);if(retry.ok){assert.equal(retry.replayed,true);assert.equal(countOwned(retry.character,'gather-iron-sand'),300);}
    assert.equal(act(restored.character,{action:'cancel',buildingId:'gorgewatch',orderId:order.id}).ok,false);
});
test('missing, inflated, mismatched and short material selections never debit inventory or start work',()=>{
    const c=base();
    const invalid:(CraftMaterialSelection|undefined)[]=[undefined,[],[{'gather-iron-sand':999},...selection.slice(1)],[{'gather-iron-sand':2},...selection.slice(1)],[{'fateShards':3},...selection.slice(1)]];
    for(const materials of invalid){
        const before=structuredClone(c);assert.equal(act(c,{action:'begin',buildingId:'gorgewatch',service:'repair',materials}).ok,false);assert.deepEqual(c,before);
    }
});
test('repair work rejects premature and out-of-order steps, then co-produces its reward and communal stage',()=>{
    const begun=act(base(),{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection});assert.ok(begun.ok);if(!begun.ok)return;
    const order=progress(begun.character).active!;
    assert.equal(act(begun.character,{action:'step',buildingId:'gorgewatch',orderId:order.id,step:0},NOW+5999).ok,false);
    assert.equal(act(begun.character,{action:'step',buildingId:'gorgewatch',orderId:order.id,step:2},NOW+6000).ok,false);
    const done=finish(begun.character,NOW,{repairs:3});assert.equal(progress(done.character).repairs,1);
    assert.equal(done.character.ryo,1180);assert.equal(done.shared.stage,1);assert.equal(done.shared.repairs,4);
    assert.equal(progress(done.character).active,undefined);
});

test('a twenty-first contributor still earns their repair without evicting the leading public work entries',()=>{
    const contributors=Array.from({length:20},(_,i)=>({name:`Worker ${i}`,repairs:100-i}));
    const started=act(base(),{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection});assert.ok(started.ok);if(!started.ok)return;
    const done=finish(started.character,NOW,{repairs:30,contributors});
    assert.equal(done.character.ryo,1180);assert.equal(progress(done.character).standing.gorgewatch.repairCount,1);
    assert.equal(done.shared.contributors.length,20);assert.deepEqual(done.shared.contributors[0],contributors[0]);
    assert.deepEqual(done.shared.contributors.at(-1),contributors.at(-1));
});
test('material-backed repairs continue past six in one day and pay every third and twentieth milestone',()=>{
    let c=base(),shared=readSharedBuilding(null),now=Date.parse('2026-10-19T12:00:00Z');
    c.itemStacks=[{itemId:'gather-iron-sand',count:126},{itemId:'hunt-torn-hide',count:84},{itemId:'gather-river-fish',count:84},{itemId:'gather-binding-fiber',count:168}];
    for(let count=1;count<=42;count++){
        c={...c,sectorBuildings:JSON.parse(JSON.stringify(progress(c,now)))};
        const started=act(c,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection},now,shared);assert.ok(started.ok);if(!started.ok)return;
        const done=finish(started.character,now,shared);c=done.character;shared=done.shared;now=done.now;
        assert.equal(c.boneCharms,Math.floor(count/3)*3);assert.equal(c.fateShards,Math.floor(count/20)*5);
        assert.equal(progress(c,now).repairsToday,count);assert.equal(progress(c,now).rewardsToday,count);assert.equal(c.ryo,1000+count*180);
        for(const row of selection)for(const[id,quantity]of Object.entries(row))assert.equal(countOwned(c,id),(42-count)*quantity);
        const reward=progress(c,now).receipts.at(-1)!.reward;
        assert.deepEqual(reward,{ryo:180,boneCharms:count%3===0?3:0,fateShards:count%20===0?5:0});
    }
    const p=progress(c,now);assert.equal(p.shardClaims,2);assert.ok(p.titles.includes('Road Restorer'));
    assert.equal(new Date(now).toISOString().slice(0,10),'2026-10-19','all 42 completions and both shard payouts occur on the same UTC day');
    const before=structuredClone(c),short=act(c,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection},now,shared);
    assert.equal(short.ok,false);assert.deepEqual(c,before,'insufficient materials cannot advance counts or pay rewards');
    c.itemStacks=[{itemId:'gather-iron-sand',count:3},{itemId:'hunt-torn-hide',count:2},{itemId:'gather-river-fish',count:2},{itemId:'gather-binding-fiber',count:4}];
    const replenished=act(c,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection},now,shared);
    assert.ok(replenished.ok);if(!replenished.ok)return;
    const next=finish(replenished.character,now,shared);assert.equal(progress(next.character,next.now).repairsToday,43);
    assert.equal(next.character.boneCharms,42);assert.equal(next.character.fateShards,10);
});
test('repairs, shared revisions and repeat milestones advance past one million across reloads',()=>{
    let now=NOW,c=base(),shared=readSharedBuilding({repairs:999_999,revision:999_999,contributors:[{name:'Builder',repairs:999_999}]});
    const state=progress(c,now);state.repairs=999_999;state.repairsToday=999_999;state.shardClaims=49_999;
    state.standing.gorgewatch={metAt:now,trust:100,visits:1,visitDay:state.day,repairCount:999_999};
    c.sectorBuildings=state;
    for(let count=1;count<=21;count++){
        c={...c,sectorBuildings:readBuildingProgress(JSON.parse(JSON.stringify(c.sectorBuildings)),now)};
        shared=readSharedBuilding(JSON.parse(JSON.stringify(shared)));
        const begun=act(c,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection},now,shared);
        assert.ok(begun.ok);if(!begun.ok)return;
        const done=finish(begun.character,now,shared);c=done.character;shared=done.shared;now=done.now;
        const p=progress(c,now),total=999_999+count;
        assert.equal(p.repairs,total);assert.equal(p.repairsToday,total);assert.equal(p.standing.gorgewatch.repairCount,total);
        assert.equal(shared.repairs,total);assert.equal(shared.revision,total);assert.equal(shared.contributors[0].repairs,total);
        const receipt=p.receipts.at(-1)!;
        assert.deepEqual(receipt.reward,{ryo:180,boneCharms:total%3===0?3:0,fateShards:total%20===0?5:0});
        const replay=act(c,{action:'step',buildingId:'gorgewatch',orderId:'completed-order',step:2,requestId:receipt.requestId},now,shared);
        assert.ok(replay.ok);if(!replay.ok)return;
        assert.equal(replay.replayed,true);assert.deepEqual(replay.character,c);assert.equal(replay.sharedChanged,false);
    }
    assert.equal(progress(c,now).shardClaims,50_001);
    assert.equal(c.fateShards,10);assert.equal(c.boneCharms,21);assert.equal(c.ryo,1000+21*180);
    assert.equal(readSharedBuilding(JSON.parse(JSON.stringify(shared))).repairs,1_000_020);
});

test('personal milestones span buildings, combine at repair sixty and survive a cancelled final step',()=>{
    const p=progress(base());p.repairs=59;p.shardClaims=2;p.standing['stronghold-2']={metAt:NOW,trust:0,visits:0,visitDay:'',repairCount:59};
    const character={...base(),boneCharms:57,fateShards:10,sectorBuildings:p};
    const started=act(character,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection});assert.ok(started.ok);if(!started.ok)return;
    let reserved=started.character;
    for(let step=0;step<2;step++){
        const order=progress(reserved).active!,r=act(reserved,{action:'step',buildingId:order.buildingId,orderId:order.id,step},NOW+(step+1)*6000);
        assert.ok(r.ok);if(!r.ok)return;reserved=r.character;
        assert.equal(reserved.boneCharms,57);assert.equal(reserved.fateShards,10);assert.equal(progress(reserved).repairs,59);
    }
    const cancelled=act(reserved,{action:'cancel',buildingId:'gorgewatch',orderId:progress(reserved).active!.id},NOW+18000);
    assert.ok(cancelled.ok);if(!cancelled.ok)return;
    assert.equal(cancelled.character.boneCharms,57);assert.equal(cancelled.character.fateShards,10);assert.equal(progress(cancelled.character).repairs,59);
    assert.equal(countOwned(cancelled.character,'gather-iron-sand'),300);
    const again=act(cancelled.character,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection},NOW+18000);
    assert.ok(again.ok);if(!again.ok)return;
    const done=finish(again.character,NOW+18000),state=progress(done.character,done.now);
    assert.equal(state.repairs,60);assert.equal(state.shardClaims,3);assert.equal(state.standing.gorgewatch.repairCount,1);
    assert.equal(done.character.boneCharms,60);assert.equal(done.character.fateShards,15);assert.equal(done.character.ryo,1180);
    assert.deepEqual(state.receipts.at(-1)!.reward,{ryo:180,boneCharms:3,fateShards:5});
});

test('legacy deferred batches settle together on the next completion without a weekly gate or repeat payment',()=>{
    const p={...progress(base()),repairs:79,shardClaims:2,shardWeek:'2026-10-19'};
    let c:Record<string,unknown>={...base(),fateShards:10,sectorBuildings:p};
    const reserved=act(c,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection});assert.ok(reserved.ok);if(!reserved.ok)return;
    assert.equal(reserved.character.fateShards,10,'reserving materials does not settle unpaid milestones');
    const cancelled=act(reserved.character,{action:'cancel',buildingId:'gorgewatch',orderId:progress(reserved.character).active!.id});
    assert.ok(cancelled.ok);if(!cancelled.ok)return;c=cancelled.character;
    assert.equal(c.fateShards,10);assert.equal(progress(c).shardClaims,2);assert.equal(progress(c).repairs,79);
    for(let i=0;i<3;i++){
        const at=NOW+i*60_000;
        c={...c,sectorBuildings:readBuildingProgress(JSON.parse(JSON.stringify(c.sectorBuildings)),at)};
        const begun=act(c,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection},at);assert.ok(begun.ok);if(!begun.ok)return;
        const done=finish(begun.character,at);c=done.character;
        assert.equal(c.fateShards,20,'two unpaid batches pay together at 80; repairs 81 and 82 do not pay again');
        assert.equal(progress(c,done.now).shardClaims,4);
        const receipt=progress(c,done.now).receipts.at(-1)!;
        assert.equal(receipt.reward.fateShards,i===0?10:0);
        const replay=act(c,{action:'step',buildingId:'gorgewatch',orderId:'finished-order',step:2,requestId:receipt.requestId},done.now);
        assert.ok(replay.ok);if(!replay.ok)return;assert.equal(replay.replayed,true);assert.equal(replay.character.fateShards,20);
    }
});

test('repair completion records the new UTC activity day without resetting lifetime milestones',()=>{
    const before=Date.parse('2026-10-25T23:59:50Z'),p=progress(base(),before);
    p.repairs=39;p.repairsToday=5;p.shardClaims=1;
    const begun=act({...base(),fateShards:5,sectorBuildings:p},{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection},before);
    assert.ok(begun.ok);if(!begun.ok)return;
    const done=finish(begun.character,before),state=progress(done.character,done.now);
    assert.equal(state.repairs,40);assert.equal(state.repairsToday,1);assert.equal(state.day,'2026-10-26');
    assert.equal(done.character.fateShards,10);assert.equal(state.shardClaims,2);
});

test('an old paid shard receipt stays historical when retried and the next milestone uses the increased amount',()=>{
    const p=progress(base());p.repairs=39;p.shardClaims=1;
    p.receipts=[{id:'old-order',requestId:'legacy-repair-finish-001',buildingId:'gorgewatch',action:'step',at:NOW-7*86400000,message:'Previously settled repair',reward:{ryo:180,boneCharms:0,fateShards:1}}];
    const character={...base(),fateShards:1,sectorBuildings:p};
    const replay=act(character,{action:'step',buildingId:'gorgewatch',orderId:'old-order',step:2,requestId:'legacy-repair-finish-001'});
    assert.ok(replay.ok);if(!replay.ok)return;
    assert.equal(replay.replayed,true);assert.equal(replay.character.fateShards,1);assert.equal(replay.receipt.reward.fateShards,1);
    const begun=act(replay.character,{action:'begin',buildingId:'gorgewatch',service:'repair',materials:selection});assert.ok(begun.ok);if(!begun.ok)return;
    const done=finish(begun.character);assert.equal(done.character.fateShards,6);assert.equal(progress(done.character,done.now).shardClaims,2);
});

test('courier progress is sealed to both named relays, survives reconnect and delivers once',()=>{
    const started=act(base(),{action:'begin',buildingId:'village-1',service:'courier'});assert.ok(started.ok);if(!started.ok)return;
    const order=progress(started.character).active!;assert.equal(order.route?.length,2);
    const target=buildingActionTarget(started.character,{action:'step',buildingId:'village-1',requestId:'courier-step-001',orderId:order.id,step:0},NOW)!;
    assert.equal(target.sector,sectorBuilding(order.route![0])!.sector);
    const done=finish(started.character);assert.equal(done.character.ryo,1120);assert.equal(progress(done.character).deliveries,1);
    const receipt=progress(done.character).receipts.at(-1)!;
    const replay=act(done.character,{action:'step',buildingId:'village-1',requestId:receipt.requestId,orderId:order.id,step:1},done.now);
    assert.ok(replay.ok);if(replay.ok)assert.equal(replay.character.ryo,1120);
});
test('ruin evidence is ordered and records once, while verified shrine deeds cannot be invented',()=>{
    let c=base();
    assert.equal(act(c,{action:'record',buildingId:'gorgewatch',choice:'evidence-only'}).ok,false);
    for(let step=0;step<3;step++){const r=act(c,{action:'survey',buildingId:'gorgewatch',step});assert.ok(r.ok);if(!r.ok)return;c=r.character;}
    const recorded=act(c,{action:'record',buildingId:'gorgewatch',choice:'open-question'});assert.ok(recorded.ok);if(!recorded.ok)return;
    assert.equal(recorded.character.ryo,1090);assert.equal(progress(recorded.character).surveys,1);
    assert.equal(act(recorded.character,{action:'record',buildingId:'gorgewatch',choice:'evidence-only'}).ok,false);
    assert.equal(act(base(),{action:'register',buildingId:'shrine-heartwood',choice:'repair-witness'}).ok,false);
    assert.equal(act(recorded.character,{action:'register',buildingId:'shrine-heartwood',choice:'survey-witness'}).ok,true);
});
test('a broken intelligence seal raises suspicion without a payout or campaign/story mutation',()=>{
    const c={...base(),storyFieldRecords:{untouched:true}},started=act(c,{action:'begin',buildingId:'shuttered-boathouse',service:'intelligence'});assert.ok(started.ok);if(!started.ok)return;
    let order=progress(started.character).active!;
    const observed=act(started.character,{action:'step',buildingId:order.buildingId,orderId:order.id,step:0,choice:'observe'},NOW+6000);assert.ok(observed.ok);if(!observed.ok)return;
    order=progress(observed.character).active!;
    const exposed=act(observed.character,{action:'step',buildingId:order.buildingId,orderId:order.id,step:1,choice:'break-seal'},NOW+12000);assert.ok(exposed.ok);if(!exposed.ok)return;
    assert.equal(exposed.character.ryo,1000);assert.deepEqual(exposed.character.storyFieldRecords,{untouched:true});assert.equal(progress(exposed.character).active,undefined);
    assert.equal(act(exposed.character,{action:'begin',buildingId:order.buildingId,service:'intelligence'},NOW+13000).ok,false);
    const fresh=act(exposed.character,{action:'begin',buildingId:order.buildingId,service:'intelligence'},NOW+320000);assert.ok(fresh.ok);if(fresh.ok)assert.equal(finish(fresh.character,NOW+320000).character.ryo,1100);
});
test('festival mistakes reset the rehearsal, watch reports are shared, and both daily latches survive receipt eviction',()=>{
    const started=act(base(),{action:'begin',buildingId:'festival-welcome',service:'festival'});assert.ok(started.ok);if(!started.ok)return;
    const order=progress(started.character).active!;
    const wrong=act(started.character,{action:'step',buildingId:order.buildingId,orderId:order.id,step:0,choice:'return'},NOW+6000);assert.ok(wrong.ok);if(!wrong.ok)return;
    assert.equal(progress(wrong.character).active?.step,0);
    const dance=finish(wrong.character,NOW+6000);assert.equal(dance.character.ryo,1060);
    assert.equal(act(dance.character,{action:'begin',buildingId:'festival-welcome',service:'festival'},dance.now).ok,false);
    const watch=act(dance.character,{action:'begin',buildingId:'gorgewatch',service:'watch'},dance.now);assert.ok(watch.ok);if(!watch.ok)return;
    const done=finish(watch.character,dance.now);assert.equal(done.shared.reports.length,1);
    assert.equal(act({...done.character,sectorBuildings:{...progress(done.character),receipts:[]}},{action:'begin',buildingId:'gorgewatch',service:'watch'},done.now).ok,false);
});
test('tea reserves its price and uses existing meal recovery after the rest without minting crafting inputs',()=>{
    const started=act({...base(),hp:10,maxHp:100,chakra:10,maxChakra:100,stamina:10,maxStamina:100},{action:'tea',buildingId:'midlands-tea-house'});assert.ok(started.ok);if(!started.ok)return;
    assert.equal(started.character.ryo,970);assert.equal(countOwned(started.character,'ration-pack'),0);
    const done=finish(started.character);assert.equal(done.character.ryo,970);assert.equal(countOwned(done.character,'ration-pack'),0);assert.equal(done.character.hp,35);assert.equal(done.character.chakra,20);assert.equal(done.character.stamina,20);
    assert.equal(act(done.character,{action:'tea',buildingId:'midlands-tea-house'},done.now).ok,false);
});

test('restoration changes Gorgewatch’s round and a sealed earlier round survives subsequent communal repairs',()=>{
    const b=sectorBuilding('gorgewatch')!;
    for(const [repairs,stage]of [[0,0],[4,1],[12,2],[24,3]]as const){
        const started=act(base(),{action:'begin',buildingId:b.id,service:'watch'},NOW,{repairs});assert.ok(started.ok);if(!started.ok)return;
        const order=progress(started.character).active!;assert.equal(order.watchStage,stage);
        const reloaded=readBuildingProgress(JSON.parse(JSON.stringify(started.character.sectorBuildings)),NOW).active!;
        assert.equal(reloaded.watchStage,stage);
        const next=buildingWorkView({...reloaded,step:1})!;
        assert.equal(next.target.tile,stage===3?b.restoredWatchPoint!.tile:b.watchPoints![1].tile);
        const continued=act(started.character,{action:'step',buildingId:b.id,orderId:order.id,step:0},NOW+6000,{repairs:24});assert.ok(continued.ok);if(!continued.ok)return;
        assert.equal(progress(continued.character).active!.watchStage,stage,'a new shared stage must not move an admitted work point');
    }
});
