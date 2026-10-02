import test from 'node:test';
import assert from 'node:assert/strict';
import { towerRecordsForClear, settleTowerRecords } from './_records.js';
import { createTowerSession, type TowerActor } from './_tower-session.js';
import { applyTowerRouteChoice } from './_route-choice.js';
import { settleFloorForMember } from './_tower-store.js';
import { sanitizeCharacterSave } from '../save/[name].js';
import { TOWER_HONORS } from '../../shared/tower-progression.js';
import { ERA_CHAPTERS } from '../../shared/era-chapters.js';
import { getSpireFloor } from './_spire-catalog.js';
import { sealTowerCatalogFloor } from './_session-floor.js';
import { kv } from '../_storage.js';
process.env.ENABLE_LEGACY = '1';
// The records commit through mutatePlayerSave on the GLOBAL kv, so every case
// runs on its in-memory backend (chosen on first use, in time despite the
// hoisted imports).
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

function fixture() {
    const actor:TowerActor={id:'sq',side:'squad',name:'Rill',ai:false,ownerSlug:'rill',hp:1000,maxHp:1000,chakra:100,maxChakra:100,stamina:100,maxStamina:100,shield:0,statuses:[],cooldowns:{},pos:0,character:{}};
    const s=createTowerSession({towerId:'celestial',runId:'record-test',floor:1,seed:42,partySize:1,now:1000,map:{width:16,height:10,blockedTiles:[],hazardTiles:[],objectiveTiles:[]},actors:[actor],objectiveKind:'defeat-all'});
    s.status='done';s.winner='squad';s.round=2;s.towerTactics={version:1,disruptedPylons:[10],chargeBaits:1,avoidedStrikes:1,squadKnockouts:[]};return s;
}

// Committed writes outside the save locks, which every settle takes and releases.
let writeCount = 0;
const set = kv.set;
const compareSet = kv.compareSet;
kv.set = (async (key: string, value: unknown, opts?: Parameters<typeof set>[2]) => {
    const result = await set.call(kv, key, value, opts);
    if (result && !key.startsWith('lock:')) writeCount++;
    return result;
}) as typeof kv.set;
kv.compareSet = (async (...args: Parameters<typeof compareSet>) => {
    const committed = await compareSet.call(kv, ...args);
    if (committed) writeCount++;
    return committed;
}) as typeof kv.compareSet;

async function storage() {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set('save:rill', { character: { name: 'Rill', level: 100, maxHp: 1000, stats: {}, ryo: 0, xp: 0 } });
    return {
        row: async (key = 'save:rill') => (await kv.get<Json>(key)) as any,
        seed: (value: Json, key = 'save:rill') => kv.set(key, value),
        writes: () => writeCount,
    };
}

/** Every save write loses its compare-and-set while `run` executes, so nothing commits. */
async function savesRefused<T>(run: () => Promise<T>): Promise<T> {
    const current = kv.compareSet;
    kv.compareSet = (async (...args: Parameters<typeof compareSet>) =>
        args[0] === 'save:rill' ? false : current.call(kv, ...args)) as typeof kv.compareSet;
    try {
        return await run();
    } finally {
        kv.compareSet = current;
    }
}

test('campaign examination commits with Tower records; failed writes and replay cannot advance it twice', async () => {
    const store = await storage(), s = fixture();
    s.floor = 5; s.runId = 'era-exam'; s.createdAt = Date.now();
    const journey = { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: 2, stageStartedAt: 2000, stageCounts: {}, completedStages: [{ id: 'field-record', at: 1500 }, { id: 'trusted-orders', at: 2000 }], proofReceipts: Array.from({ length: 60 }, (_, n) => `mission:${n}`) };
    await store.seed({ character: { name: 'Rill', eraJourneys: { 'shinobi-awakening': journey } } });
    await assert.rejects(() => savesRefused(() => settleTowerRecords(s, 'rill')), /not committed/);
    assert.equal((await store.row()).character.eraJourneys['shinobi-awakening'].stageIndex, 2);
    await settleTowerRecords(s, 'rill');
    const committed = structuredClone(await store.row());
    assert.equal(committed.character.eraJourneys['shinobi-awakening'].stageIndex, 3);
    assert.equal(committed.character.eraJourneys['shinobi-awakening'].proofReceipts.length, 61);
    assert.ok(committed.character.battleTowerRecords);
    const writes = store.writes();
    await settleTowerRecords(s, 'rill');
    assert.equal(store.writes(), writes);
    assert.deepEqual(await store.row(), committed);
});

test('historic clean records do not combine with a new dirty examination victory', async () => {
    const store = await storage(), prior = fixture(); prior.floor = 5; prior.runId = 'old-exam';
    await settleTowerRecords(prior, 'rill');
    const saved = await store.row();
    saved.character.eraJourneys = { 'shinobi-awakening': { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: 2, stageStartedAt: 2000, stageCounts: {}, completedStages: [{ id: 'field-record', at: 1500 }, { id: 'trusted-orders', at: 2000 }], proofReceipts: [] } };
    await store.seed(saved);
    const dirty = fixture(); dirty.floor = 5; dirty.runId = 'new-dirty'; dirty.createdAt = Date.now(); dirty.towerTactics!.squadKnockouts = ['sq'];
    await settleTowerRecords(dirty, 'rill');
    assert.equal((await store.row()).character.eraJourneys['shinobi-awakening'].stageIndex, 2);
});

test('public Spire settlement seals the exact tier and same-run Master/Grandmaster feats with retry-safe saves', async () => {
    for (const chapter of ERA_CHAPTERS.slice(3)) for (const [index, stage] of chapter.routes[0]!.stages!.entries()) {
        const proof = stage.objectives[0]!.proof;
        if (proof.kind !== 'tower') continue;
        const store = await storage(), s = fixture();
        s.towerId = 'endless-spire'; s.floor = proof.floor; s.ascensionTier = proof.floor; s.createdAt = Date.now(); s.runId = `era-spire-${proof.floor}`;
        for (let member = 1; member < 4; member++) s.actors.push({ ...structuredClone(s.actors[0]!), id: `ally-${member}`, ownerSlug: `ally${member}`, pos: member });
        s.partySize = 4;
        sealTowerCatalogFloor(s, getSpireFloor(proof.floor)!, 'spire');
        const journey = { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: index, stageStartedAt: 2000,
            stageCounts: {}, completedStages: chapter.routes[0]!.stages!.slice(0, index).map(stage => ({ id: stage.id, at: 2000 })), proofReceipts: [] };
        const seed = { character: { name: 'Rill', eraJourneys: { [chapter.eraId]: journey } } };
        for (const failure of ['story', 'embedded', 'dirty', 'slow', 'no-pylon', 'no-signature', 'old', 'short-party', 'duplicate-owner', 'ai-recruit']) {
            await store.seed(structuredClone(seed));
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
            await settleTowerRecords(bad, 'rill');
            assert.equal((await store.row()).character.eraJourneys[chapter.eraId].stageIndex, index, failure);
        }
        await store.seed(structuredClone(seed));
        await assert.rejects(() => savesRefused(() => settleTowerRecords(s, 'rill')), /not committed/);
        assert.equal((await store.row()).character.eraJourneys[chapter.eraId].stageIndex, index);
        await settleTowerRecords(s, 'rill');
        const committed = structuredClone(await store.row());
        assert.equal(committed.character.eraJourneys[chapter.eraId].stageIndex, index + 1);
        assert.deepEqual(committed.character.eraJourneys[chapter.eraId].proofReceipts, [`tower:${s.runId}`]);
        assert.ok(committed.character.battleTowerRecords.bests[`spire:${proof.floor}:4:standard`]);
        const writes = store.writes();
        await settleTowerRecords(s, 'rill');
        assert.equal(store.writes(), writes); assert.deepEqual(await store.row(), committed);
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
test('record retries are monotonic and do not duplicate save writes or currency', async () => {
    const store = await storage(), s = fixture();
    await settleTowerRecords(s, 'rill');
    const committed = structuredClone(await store.row());
    const writes = store.writes();
    await settleTowerRecords(s, 'rill');
    assert.deepEqual(await store.row(), committed);
    assert.equal(store.writes(), writes);
    assert.equal(committed.character.ryo, 0);
    await settleTowerRecords(s, 'stranger');
    assert.equal(store.writes(), writes);
});
test('uncommitted record writes fail so the client can retry settlement', async () => {
    await storage();
    await assert.rejects(() => savesRefused(() => settleTowerRecords(fixture(), 'rill')), /not committed/);
    await kv.del('save:rill');
    await assert.rejects(() => settleTowerRecords(fixture(), 'rill'), /unavailable/);
});
test('generic saves cannot forge or erase Tower achievement evidence',()=>{
    const records=towerRecordsForClear(undefined,fixture());
    const first=sanitizeCharacterSave({character:{name:'Rill',battleTowerRecords:records}},null);
    assert.equal((first.character as any).battleTowerRecords,undefined);
    const saved=sanitizeCharacterSave({character:{name:'Rill',battleTowerRecords:{bests:{},honors:{}}}},{character:{name:'Rill',battleTowerRecords:records}});
    assert.deepEqual((saved.character as any).battleTowerRecords,records);
});
test('Elite first-clear ryo is awarded once; replays only improve records', async () => {
    const store = await storage(), s = fixture(); applyTowerRouteChoice(s, 'elite-shortcut');
    const paid = await settleFloorForMember({ session: s, slug: 'rill' }); assert.equal(paid.paid, true);
    const before = (await store.row()).character.ryo; assert.equal(before, 500);
    await settleFloorForMember({ session: s, slug: 'rill' }); await settleTowerRecords(s, 'rill'); await settleTowerRecords(s, 'rill');
    assert.equal((await store.row()).character.ryo, before);
});


test('personal-best comparison survives retries and later, stronger clears', async () => {
    await storage(); const first = fixture(); first.runId = 'prior'; first.round = 8;
    const initial = await settleTowerRecords(first, 'rill');
    assert.equal(initial?.previous, undefined);
    const improved = fixture(); improved.runId = 'improved'; improved.round = 4;
    const comparison = await settleTowerRecords(improved, 'rill');
    assert.equal(comparison?.previous?.fastestRounds, 8);
    assert.equal(comparison?.rounds, 4);
    assert.ok(comparison!.score > comparison!.previous!.bestScore);
    const later = fixture(); later.runId = 'later'; later.round = 1;
    await settleTowerRecords(later, 'rill');
    assert.deepEqual(await settleTowerRecords(improved, 'rill'), comparison);
});

test('failed save keeps the comparison baseline for a safe retry', async () => {
    const store = await storage(), s = fixture();
    await assert.rejects(() => savesRefused(() => settleTowerRecords(s, 'rill')), /not committed/);
    const receipt = structuredClone(await store.row(`tower-record-comparison:${s.runId}:rill`));
    assert.deepEqual(await settleTowerRecords(s, 'rill'), receipt);
    assert.ok((await store.row()).character.battleTowerRecords);
});

test('comparisons match floor, human squad size and route; losses have no receipt', async () => {
    await storage(); const s = fixture(); await settleTowerRecords(s, 'rill');
    s.runId = 'elite'; applyTowerRouteChoice(s, 'elite-shortcut');
    assert.equal((await settleTowerRecords(s, 'rill'))?.previous, undefined);
    s.runId = 'loss'; s.winner = 'enemy'; assert.equal(await settleTowerRecords(s, 'rill'), undefined);
});
