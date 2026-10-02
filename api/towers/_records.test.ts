import test from 'node:test';
import assert from 'node:assert/strict';
import { towerRecordsForClear, settleTowerRecords } from './_records.js';
import { createTowerSession, type TowerActor } from './_tower-session.js';
import { applyTowerRouteChoice } from './_route-choice.js';
import { settleFloorForMember, type TowerKv, type TowerLock } from './_tower-store.js';
import { sanitizeCharacterSave } from '../save/[name].js';
import { TOWER_HONORS } from '../../shared/tower-progression.js';
import { ERA_CHAPTERS } from '../../shared/era-chapters.js';
import { getSpireFloor } from './_spire-catalog.js';
import { sealTowerCatalogFloor } from './_session-floor.js';
process.env.ENABLE_LEGACY = '1';

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

test('campaign examination commits with Tower records; failed writes and replay cannot advance it twice', async () => {
    const store = storage(), s = fixture();
    s.floor = 5; s.runId = 'era-exam'; s.createdAt = Date.now();
    const journey = { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: 2, stageStartedAt: 2000, stageCounts: {}, completedStages: [{ id: 'field-record', at: 1500 }, { id: 'trusted-orders', at: 2000 }], proofReceipts: Array.from({ length: 60 }, (_, n) => `mission:${n}`) };
    store.rows.set('save:rill', { character: { name: 'Rill', eraJourneys: { 'shinobi-awakening': journey } } });
    const failed = { ...store, kv: { ...store.kv, set: async (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) => key === 'save:rill' ? null : store.kv.set(key, value, opts) } };
    await assert.rejects(() => settleTowerRecords(s, 'rill', failed), /not committed/);
    assert.equal((store.rows.get('save:rill') as any).character.eraJourneys['shinobi-awakening'].stageIndex, 2);
    await settleTowerRecords(s, 'rill', store);
    const committed = structuredClone(store.rows.get('save:rill')) as any;
    assert.equal(committed.character.eraJourneys['shinobi-awakening'].stageIndex, 3);
    assert.equal(committed.character.eraJourneys['shinobi-awakening'].proofReceipts.length, 61);
    assert.ok(committed.character.battleTowerRecords);
    const writes = store.writes();
    await settleTowerRecords(s, 'rill', store);
    assert.equal(store.writes(), writes);
    assert.deepEqual(store.rows.get('save:rill'), committed);
});

test('historic clean records do not combine with a new dirty examination victory', async () => {
    const store = storage(), prior = fixture(); prior.floor = 5; prior.runId = 'old-exam';
    await settleTowerRecords(prior, 'rill', store);
    const saved = store.rows.get('save:rill') as any;
    saved.character.eraJourneys = { 'shinobi-awakening': { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: 2, stageStartedAt: 2000, stageCounts: {}, completedStages: [{ id: 'field-record', at: 1500 }, { id: 'trusted-orders', at: 2000 }], proofReceipts: [] } };
    const dirty = fixture(); dirty.floor = 5; dirty.runId = 'new-dirty'; dirty.createdAt = Date.now(); dirty.towerTactics!.squadKnockouts = ['sq'];
    await settleTowerRecords(dirty, 'rill', store);
    assert.equal((store.rows.get('save:rill') as any).character.eraJourneys['shinobi-awakening'].stageIndex, 2);
});

test('public Spire settlement seals the exact tier and same-run Master/Grandmaster feats with retry-safe saves', async () => {
    for (const chapter of ERA_CHAPTERS.slice(3)) for (const [index, stage] of chapter.routes[0]!.stages!.entries()) {
        const proof = stage.objectives[0]!.proof;
        if (proof.kind !== 'tower') continue;
        const store = storage(), s = fixture();
        s.towerId = 'endless-spire'; s.floor = proof.floor; s.ascensionTier = proof.floor; s.createdAt = Date.now(); s.runId = `era-spire-${proof.floor}`;
        for (let member = 1; member < 4; member++) s.actors.push({ ...structuredClone(s.actors[0]!), id: `ally-${member}`, ownerSlug: `ally${member}`, pos: member });
        s.partySize = 4;
        sealTowerCatalogFloor(s, getSpireFloor(proof.floor)!, 'spire');
        const journey = { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: index, stageStartedAt: 2000,
            stageCounts: {}, completedStages: chapter.routes[0]!.stages!.slice(0, index).map(stage => ({ id: stage.id, at: 2000 })), proofReceipts: [] };
        const seed = { character: { name: 'Rill', eraJourneys: { [chapter.eraId]: journey } } };
        for (const failure of ['story', 'embedded', 'dirty', 'slow', 'no-pylon', 'no-signature', 'old', 'short-party', 'duplicate-owner', 'ai-recruit']) {
            store.rows.set('save:rill', structuredClone(seed));
            const bad = structuredClone(s); bad.runId = `${s.runId}:${failure}`;
            if (failure === 'story') { bad.towerId = 'celestial'; delete bad.ascensionTier; delete bad.floorProvenance; delete bad.sealedCatalogFloor; }
            if (failure === 'embedded') { bad.encounterFloor = getSpireFloor(proof.floor)!; }
            if (failure === 'dirty') bad.towerTactics!.squadKnockouts = ['sq'];
            if (failure === 'slow') bad.round = getSpireFloor(proof.floor)!.roundBudget + 1;
            if (failure === 'no-pylon') bad.towerTactics!.disruptedPylons = [];
            if (failure === 'no-signature') { bad.towerTactics!.avoidedStrikes = 0; bad.towerTactics!.chargeBaits = 0; }
            if (failure === 'old') bad.createdAt = 1999;
            if (failure === 'short-party') bad.actors.pop();
            if (failure === 'duplicate-owner') bad.actors[3]!.ownerSlug = 'rill';
            if (failure === 'ai-recruit') bad.actors[3]!.ai = true;
            await settleTowerRecords(bad, 'rill', store);
            assert.equal((store.rows.get('save:rill') as any).character.eraJourneys[chapter.eraId].stageIndex, index, failure);
        }
        store.rows.set('save:rill', structuredClone(seed));
        const failSave = { ...store, kv: { ...store.kv, set: async (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) => key === 'save:rill' ? null : store.kv.set(key, value, opts) } };
        await assert.rejects(() => settleTowerRecords(s, 'rill', failSave), /not committed/);
        assert.equal((store.rows.get('save:rill') as any).character.eraJourneys[chapter.eraId].stageIndex, index);
        await settleTowerRecords(s, 'rill', store);
        const committed = structuredClone(store.rows.get('save:rill')) as any;
        assert.equal(committed.character.eraJourneys[chapter.eraId].stageIndex, index + 1);
        assert.deepEqual(committed.character.eraJourneys[chapter.eraId].proofReceipts, [`tower:${s.runId}`]);
        assert.ok(committed.character.battleTowerRecords.bests[`spire:${proof.floor}:4:standard`]);
        const writes = store.writes();
        await settleTowerRecords(s, 'rill', store);
        assert.equal(store.writes(), writes); assert.deepEqual(store.rows.get('save:rill'), committed);
    }
});
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
