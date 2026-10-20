import { before,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { withDuelWitnesses } from './_duel-witnesses.js';
import { lifeSceneView,parseLifeState } from '../../shared/sector-life.js';
import { SCAR_TTL_MS } from '../../shared/sector-scars.js';
process.env.NODE_ENV='test';process.env.SHINOBIX_QA_MEMORY_KV='1';
let kv:typeof import('../_storage.js').kv,scars:typeof import('../_sector-scars.js');
const sector=42,tile=99,now=1_800_000_060_000;
before(async()=>{({kv}=await import('../_storage.js'));scars=await import('../_sector-scars.js');});
beforeEach(async()=>{for(const key of await kv.keys('*'))await kv.del(key);});
test('battle-start captures the real staffed scene and retains its observers through later scar writes and reads',async()=>{
    await kv.set(`world:territory:${sector}`,{weather:'rain'});
    const ground=await withDuelWitnesses({sector,tile},now);const witness=ground?.witnesses?.find(w=>w.id==='resident:42');assert(witness);assert.equal(witness.name,'Tea Seller Mako');assert.equal(witness.at,now);
    await scars.recordSectorDuelScar(sector,'Rin','Kota',now+10_000,tile,ground!.witnesses);
    await scars.recordSectorDuelScar(sector,'Aki','Ben',now+11_000,tile);
    const rows=await scars.readSectorScars(sector,now+12_000);assert.deepEqual(rows.find(r=>r.victor==='Rin')!.witnesses,ground!.witnesses);assert.equal(rows.find(r=>r.victor==='Aki')!.witnesses,undefined);
    const view=lifeSceneView(sector,parseLifeState(null,now+12_000),now+12_000,'rain',undefined,rows[0],undefined,rows);
    assert(view.actors.find(a=>a.id===witness.id)!.line.includes('I saw Rin and Kota fighting near here.'));
    const old=await scars.readSectorScars(sector,now+SCAR_TTL_MS);assert(old.some(r=>r.victor==='Rin'),'result itself has a later expiry');assert.equal(old.find(r=>r.victor==='Rin')!.witnesses,undefined,'the older observation must expire independently');
});
test('storage failure preserves battle ground but cannot invent a witness or accept an incoming observer list',async t=>{
    t.mock.method(kv,'get',async()=>{throw Error('cosmetic snapshot unavailable');});
    assert.deepEqual(await withDuelWitnesses({sector,tile,witnesses:[{id:'sumi',name:'Forged witness',tile,at:now}]},now),{sector,tile});
    assert.equal(await withDuelWitnesses(undefined,now),undefined);
});
test('a later fight by the same victor replaces, rather than inherits, the old observation',async()=>{
    const ground=await withDuelWitnesses({sector,tile},now);assert(ground?.witnesses?.length);
    await scars.recordSectorDuelScar(sector,'Rin','Kota',now+10_000,tile,ground.witnesses);
    await scars.recordSectorDuelScar(sector,'Rin','Aki',now+20_000,tile);
    const rows=await scars.readSectorScars(sector,now+20_000);assert.equal(rows.length,1);assert.equal(rows[0].witnesses,undefined);
});

test('a Chronicle spectator is sealed at his actual watching point rather than his ordinary road stop',async()=>{
    const {stopChronicleGame}=await import('../sector/_life-chronicle-game.js'),{chronicleStopPlan}=await import('../../shared/sector-chronicle-stop.js');
    let at=0;
    for(let day=0;day<30;day++){const window=day*24+20,p=chronicleStopPlan({window},stopChronicleGame(window));if(lifeSceneView(42,parseLifeState(null,p.matchAt+1000),p.matchAt+1000,'clear').actors.some(a=>a.id==='gen')){at=p.matchAt+1000;break;}}
    assert(at);await kv.set('world:territory:42',{weather:'clear'});
    const ground=await withDuelWitnesses({sector:42,tile:137},at),gen=ground?.witnesses?.find(w=>w.id==='gen');assert(gen);assert.equal(gen.tile,138);assert.equal(gen.name,'Gen');
});
