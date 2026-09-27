import test from 'node:test';
import assert from 'node:assert/strict';
import { towerRecordsForClear, settleTowerRecords } from './_records.js';
import { createTowerSession, type TowerActor } from './_tower-session.js';
import { applyTowerRouteChoice } from './_route-choice.js';
import { settleFloorForMember, type TowerKv, type TowerLock } from './_tower-store.js';
import { sanitizeCharacterSave } from '../save/[name].js';
import { TOWER_HONORS } from '../../shared/tower-progression.js';

function fixture() {
    const actor:TowerActor={id:'sq',side:'squad',name:'Rill',ai:false,ownerSlug:'rill',hp:1000,maxHp:1000,chakra:100,maxChakra:100,stamina:100,maxStamina:100,shield:0,statuses:[],cooldowns:{},pos:0,character:{}};
    const s=createTowerSession({towerId:'celestial',runId:'record-test',floor:1,seed:42,partySize:1,now:1000,map:{width:16,height:10,blockedTiles:[],hazardTiles:[],objectiveTiles:[]},actors:[actor],objectiveKind:'defeat-all'});
    s.status='done';s.winner='squad';s.round=2;s.towerTactics={version:1,disruptedPylons:[10],chargeBaits:1,avoidedStrikes:1,squadKnockouts:[]};return s;
}
function storage() {
    const rows=new Map<string,unknown>([['save:rill',{character:{name:'Rill',level:100,maxHp:1000,stats:{},ryo:0,xp:0}}]]);
    let writes=0;
    const kv:TowerKv={get:async<T>(key:string)=>(rows.get(key)??null) as T|null,set:async(key,value,opts)=>{if(opts?.nx&&rows.has(key))return null;rows.set(key,value);writes++;return 'OK';},del:async(...keys)=>keys.reduce((n,k)=>n+Number(rows.delete(k)),0),incr:async(key)=>{const n=Number(rows.get(key)??0)+1;rows.set(key,n);return n;}};
    const lock:TowerLock=async(_key,fn)=>fn();return{rows,kv,lock,writes:()=>writes};
}
test('all six honors require a server-confirmed clear and their combat evidence',()=>{
    const s=fixture();applyTowerRouteChoice(s,'elite-shortcut');const records=towerRecordsForClear(undefined,s);
    assert.equal(Object.keys(records.honors).length,TOWER_HONORS.length);assert.ok(records.bests['story:1:1:elite-shortcut']);
    s.winner='enemy';assert.deepEqual(towerRecordsForClear(undefined,s),{bests:{},honors:{}});
    s.winner='squad';s.status='active';assert.deepEqual(towerRecordsForClear(undefined,s),{bests:{},honors:{}});
});
test('records only improve, retain knockout evidence, and separate route and squad size',()=>{
    const s=fixture();const first=towerRecordsForClear(undefined,s);s.round=20;s.actors[0].hp=1;s.towerTactics!.squadKnockouts=['sq'];
    assert.deepEqual(towerRecordsForClear(first,s),first);
    const dirty=towerRecordsForClear(undefined,s);assert.equal(dirty.honors['tower-clean-clear'],undefined);
    s.actors.push({...structuredClone(s.actors[0]),id:'ally',ownerSlug:'ally'});applyTowerRouteChoice(s,'focused-assault');
    assert.equal(Object.keys(towerRecordsForClear(first,s).bests).length,2);
});
test('embedded encounters, PvP, and clan bosses cannot award Tower records',()=>{
    for(const towerId of ['mission','tower-pvp','clan-boss']){const s=fixture();s.towerId=towerId;assert.deepEqual(towerRecordsForClear(undefined,s),{bests:{},honors:{}});}
});
test('record retries are monotonic and do not duplicate save writes or currency',async()=>{
    const store=storage(),s=fixture();await settleTowerRecords(s,'rill',store);const committed=structuredClone(store.rows.get('save:rill'));const writes=store.writes();
    await settleTowerRecords(s,'rill',store);assert.deepEqual(store.rows.get('save:rill'),committed);assert.equal(store.writes(),writes);
    assert.equal((committed as any).character.ryo,0);await settleTowerRecords(s,'stranger',store);assert.equal(store.writes(),writes);
});
test('uncommitted record writes fail so the client can retry settlement',async()=>{
    const store=storage();await assert.rejects(()=>settleTowerRecords(fixture(),'rill',{...store,kv:{...store.kv,set:async()=>null}}),/not committed/);
    store.rows.clear();await assert.rejects(()=>settleTowerRecords(fixture(),'rill',store),/unavailable/);
});
test('generic saves cannot forge or erase Tower achievement evidence',()=>{
    const records=towerRecordsForClear(undefined,fixture());
    const first=sanitizeCharacterSave({character:{name:'Rill',battleTowerRecords:records}},null);
    assert.equal((first.character as any).battleTowerRecords,undefined);
    const saved=sanitizeCharacterSave({character:{name:'Rill',battleTowerRecords:{bests:{},honors:{}}}},{character:{name:'Rill',battleTowerRecords:records}});
    assert.deepEqual((saved.character as any).battleTowerRecords,records);
});
test('Elite first-clear ryo is awarded once; replays only improve records',async()=>{
    const store=storage(),s=fixture();applyTowerRouteChoice(s,'elite-shortcut');
    const paid=await settleFloorForMember({session:s,slug:'rill'},store);assert.equal(paid.paid,true);
    const before=(store.rows.get('save:rill') as any).character.ryo;assert.equal(before,500);
    await settleFloorForMember({session:s,slug:'rill'},store);await settleTowerRecords(s,'rill',store);await settleTowerRecords(s,'rill',store);
    assert.equal((store.rows.get('save:rill') as any).character.ryo,before);
});


test('personal-best comparison survives retries and later, stronger clears', async () => {
    const store=storage(), first=fixture(); first.runId='prior'; first.round=8;
    const initial=await settleTowerRecords(first,'rill',store);
    assert.equal(initial?.previous,undefined);
    const improved=fixture(); improved.runId='improved'; improved.round=4;
    const comparison=await settleTowerRecords(improved,'rill',store);
    assert.equal(comparison?.previous?.fastestRounds,8);
    assert.equal(comparison?.rounds,4);
    assert.ok(comparison!.score>comparison!.previous!.bestScore);
    const later=fixture(); later.runId='later'; later.round=1;
    await settleTowerRecords(later,'rill',store);
    assert.deepEqual(await settleTowerRecords(improved,'rill',store),comparison);
});

test('failed save keeps the comparison baseline for a safe retry', async () => {
    const store=storage(), s=fixture();
    const failSave={...store,kv:{...store.kv,set:async(key:string,value:unknown,opts?:{ex?:number;nx?:boolean})=>key==='save:rill'?null:store.kv.set(key,value,opts)}};
    await assert.rejects(()=>settleTowerRecords(s,'rill',failSave),/not committed/);
    const receipt=structuredClone(store.rows.get(`tower-record-comparison:${s.runId}:rill`));
    assert.deepEqual(await settleTowerRecords(s,'rill',store),receipt);
    assert.ok((store.rows.get('save:rill') as any).character.battleTowerRecords);
});

test('comparisons match floor, human squad size and route; losses have no receipt',async()=>{
    const store=storage(),s=fixture(); await settleTowerRecords(s,'rill',store);
    s.runId='elite';applyTowerRouteChoice(s,'elite-shortcut');
    assert.equal((await settleTowerRecords(s,'rill',store))?.previous,undefined);
    s.runId='loss';s.winner='enemy';assert.equal(await settleTowerRecords(s,'rill',store),undefined);
});
