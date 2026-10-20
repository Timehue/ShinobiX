import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lifeSceneView,parseLifeState,lifeEventView,lifeActorPosition,LIFE_WINDOW_MS } from './sector-life.js';
import { parseShrineCare,renewShrineCare,SHRINE_CARE_MS,HEARTWOOD_SHRINE_ROUND } from './sector-life-memory.js';
import { SHRINE_DEFS } from './shrines.js';
import { sectorExits } from './sector-links.js';
import { isWalkableTile,walkPath } from './sector-walk-mask.js';
import { SHRINE_STANDING_SPOTS } from './sector-shrine-scenes.js';

const now=103*LIFE_WINDOW_MS+60_000;
test('authored shrine standing points stay available across the full day and recurring arrivals',()=>{
    for(const [id,spots] of Object.entries(SHRINE_STANDING_SPOTS)){const sector=Number(id);for(let second=0;second<7200;second+=30){const time=now+second*1000;
        const view=lifeSceneView(sector,parseLifeState(null,time),time,'clear',undefined,undefined,{tier:4,maintainedAt:0,by:''});
        const keeper=view.actors.find(a=>a.id===`keeper:${sector}`)!;assert.equal(keeper.restTile,spots[0],`${sector}: keeper must stay at the authored shrine point`);
        for(const actor of view.actors.filter(a=>a.id.startsWith('pilgrim:')))assert.equal(actor.restTile,spots[Number(actor.id.split(':').at(-1))+1]);
        assert(!view.actors.filter(a=>!a.id.startsWith('keeper:')&&!a.id.startsWith('pilgrim:')).some(a=>spots.includes(a.restTile)),`${sector}: another routine took a shrine stop`);
    }}
});
test('every authored shrine keeps its own permanent floor through dormancy, support and expired care',()=>{
    for(const shrine of SHRINE_DEFS)for(const tier of [0,1,2,3,4]){
        const scene=lifeSceneView(shrine.sector,parseLifeState(null,now+LIFE_WINDOW_MS),now+LIFE_WINDOW_MS,'clear',undefined,undefined,{tier,maintainedAt:0,by:''});
        assert.equal(scene.painting,`${shrine.id}-${tier>=2?'radiant':tier?'supported':'dormant'}-shrine${shrine.sector===31?'-supply-v2':'-v1'}`);
    }
    assert.equal(lifeSceneView(42,parseLifeState(null,now),now,'clear').painting,undefined,'unrelated tea floors retain their existing mapping');
});
test('the shrine round changes the actual lamps in stages while the tea seller keeps working',()=>{
    const state=parseLifeState(null,now);
    for(const [step,painting] of ['heartwood-dormant-shrine-v1','heartwood-dormant-shrine-v1','heartwood-left-lamp-v1','heartwood-supported-shrine-v1'].entries()) {
        const scene=lifeSceneView(15,{...state,step,updatedAt:now},now,'clear');
        assert.equal(scene.kind,'shrine');assert.equal(scene.painting,painting);
        assert.equal(scene.actors[0].name,'Tea Seller Ren');assert.match(scene.actors[0].line,/kettle/);
        const keeper=scene.actors.find(actor=>actor.id==='keeper:15')!;assert(keeper);
        assert.equal(keeper.restTile,HEARTWOOD_SHRINE_ROUND.keeper);
        if(step===2)assert.match(keeper.line,/left lamp is ready/);
        if(step<3)assert.equal(scene.tile,HEARTWOOD_SHRINE_ROUND.steps[step]);
    }
    assert.equal(lifeEventView(15,parseLifeState(null,now+LIFE_WINDOW_MS),now+LIFE_WINDOW_MS).kind,'tea');
});

test('completed upkeep brings a visitor from a real road to the shrine and back out',()=>{
    const state={...parseLifeState(null,now),step:3,updatedAt:now};
    const scene=lifeSceneView(15,state,now,'clear');
    const pilgrim=scene.actors.find(a=>a.id==='pilgrim:15:0')!;assert(pilgrim);
    const motion=pilgrim.motion!,entry=motion.frames[0][1],exit=motion.frames.at(-1)![1];
    assert(sectorExits(15).some(e=>e.tile===entry));assert(sectorExits(15).some(e=>e.tile===exit));
    assert.equal(lifeActorPosition(15,pilgrim,now).row*12+lifeActorPosition(15,pilgrim,now).col,entry);
    const resting=motion.frames.findIndex((frame,i)=>i>0&&frame[1]===pilgrim.restTile&&motion.frames[i-1][1]===pilgrim.restTile);
    assert(resting>0);const restTime=motion.start+motion.frames[resting-1][0]+10_000;
    const visiting=lifeSceneView(15,state,restTime,'clear');
    assert.equal(visiting.actors.find(a=>a.id===pilgrim.id)?.activity,'Visiting the shrine');
    assert.match(visiting.description,/visitor is spending/);
    for(let time=0;time<=motion.frames.at(-1)![0];time+=500) {
        const pose=lifeActorPosition(15,pilgrim,motion.start+time);
        assert(isWalkableTile(15,Math.round(pose.row)*12+Math.round(pose.col)));
    }
    const after=lifeSceneView(15,state,motion.start+motion.frames.at(-1)![0]+3000,'clear');
    assert(!after.actors.some(a=>a.id===pilgrim.id));assert.match(after.description,/continued along the road/);
});

test('world upkeep survives a new event round, then runs out of oil without removing its fixed lamps',()=>{
    const memory={tier:0,maintainedAt:now,by:'Aki'},later=now+LIFE_WINDOW_MS;
    const remembered=lifeSceneView(15,parseLifeState(null,later),later,'clear',undefined,undefined,memory);
    assert.equal(remembered.kind,'tea');assert.equal(remembered.painting,'heartwood-supported-shrine-v1');
    assert.match(remembered.actors.find(a=>a.id==='keeper:15')!.line,/Aki helped/);
    const expired=now+SHRINE_CARE_MS+1;
    const cold=lifeSceneView(15,parseLifeState(null,expired),expired,'clear',undefined,undefined,memory);
    assert.equal(cold.painting,'heartwood-dormant-shrine-v1');assert(cold.actors.some(a=>a.id==='keeper:15'));
    const funded=lifeSceneView(15,parseLifeState(null,expired),expired,'clear',undefined,undefined,{...memory,tier:1});
    assert.equal(funded.painting,'heartwood-supported-shrine-v1');
    assert.deepEqual(parseShrineCare({maintainedAt:now+1,by:'False'},now),{maintainedAt:0,by:'False'});
    assert.equal(parseShrineCare({maintainedAt:'nonsense'},now).maintainedAt,0);
});

test('renewed oil and further support preserve visitors already walking, while a fresh revival starts at the road',()=>{
    const since=now-90_000,first={tier:0,...renewShrineCare(undefined,'Aki',since)},later=now;
    const state=parseLifeState(null,later),visitor=(memory:typeof first&{supportStartedAt?:number})=>lifeSceneView(15,state,later,'clear',undefined,undefined,memory).actors.find(a=>a.id==='pilgrim:15:0')!;
    const before=visitor(first),renewed={tier:0,...renewShrineCare(first,'Ben',later)};
    assert.deepEqual(visitor(renewed).motion,before.motion);
    const funded={...renewed,tier:1,supportStartedAt:later-1000};assert.deepEqual(visitor(funded).motion,before.motion);
    const expiredAt=since+SHRINE_CARE_MS+1000,revived=renewShrineCare(first,'Cora',expiredAt);
    assert.equal(revived.visitorSince,expiredAt);
    const fresh=lifeSceneView(15,parseLifeState(null,expiredAt),expiredAt,'clear',undefined,undefined,{tier:0,...revived}).actors.find(a=>a.id==='pilgrim:15:0')!;
    assert(sectorExits(15).some(e=>e.tile===fresh.motion!.frames[0][1]));assert.equal(fresh.motion!.start,expiredAt+2000);
    const sustained=renewShrineCare(first,'Dana',expiredAt,later);assert.equal(sustained.visitorSince,since,'funding before oil ran out keeps traffic continuous');
    const fundedAfterGap=expiredAt-500;
    assert.equal(renewShrineCare(first,'Emi',expiredAt,fundedAfterGap).visitorSince,expiredAt,'funding after a gap does not revive the expired route');
    const startView=lifeSceneView(15,parseLifeState(null,later),later,'clear',undefined,undefined,{tier:1,maintainedAt:0,by:'',supportStartedAt:later});
    assert.equal(startView.actors.find(a=>a.id==='pilgrim:15:0')!.motion!.start,later+2000);
    assert.deepEqual(parseShrineCare({maintainedAt:now,by:'Aki',visitorSince:now+1},now),{maintainedAt:now,by:'Aki'});
});

test('supported shrines use grounded, distinct keeper/visitor positions within the mobile cast budget',()=>{
    for(const shrine of SHRINE_DEFS)for(let minutes=0;minutes<20;minutes++) {
        const time=now+minutes*60_000;
        const scene=lifeSceneView(shrine.sector,parseLifeState(null,time),time,'clear',undefined,undefined,{tier:4,maintainedAt:now,by:'Aki'});
        assert(scene.actors.length<=5);
        const keeper=scene.actors.find(a=>a.id===`keeper:${shrine.sector}`);assert(keeper,`${shrine.id}: keeper must stay present`);
        const visitors=scene.actors.filter(a=>a.id.startsWith('pilgrim:'));
        assert.equal(new Set([keeper.restTile,...visitors.map(a=>a.restTile)]).size,visitors.length+1);
        for(const actor of [keeper,...visitors]) {
            assert(isWalkableTile(shrine.sector,actor.restTile));assert(walkPath(shrine.sector,keeper.restTile,actor.restTile));
        }
        assert.equal(scene.painting,`${shrine.id}-radiant-shrine${shrine.sector===31?'-supply-v2':'-v1'}`,'each supported shrine uses its reviewed regional floor');
    }
});

test('arriving recurring travelers do not change a shrine visitor route halfway through its wave',()=>{
    for(const shrine of SHRINE_DEFS){const motions=new Map<string,unknown>();
        for(let seconds=0;seconds<1800;seconds+=10){const time=now+seconds*1000;
            const scene=lifeSceneView(shrine.sector,parseLifeState(null,time),time,'clear',undefined,undefined,{tier:2,maintainedAt:now,by:'Aki',supportStartedAt:now});
            for(const actor of scene.actors.filter(a=>a.id.startsWith('pilgrim:'))){const key=`${actor.id}:${actor.motion!.start}`;
                if(motions.has(key))assert.deepEqual(actor.motion,motions.get(key),`${shrine.id}: ${key}`);else motions.set(key,actor.motion);
            }
        }
    }
});

test('all delivered shrine floors match their admission hashes and protected base',()=>{
    const folder=new URL('../shinobij.client/public/sector-life/',import.meta.url);
    const base=readFileSync(new URL('heartwood-rest-stop-v1.webp',folder));
    const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
    for(const slug of ['heartwood-dormant-shrine-v1','heartwood-left-lamp-v1','heartwood-supported-shrine-v1','heartwood-radiant-shrine-v1']) {
        const receipt=JSON.parse(readFileSync(new URL(`${slug}.json`,folder),'utf8'));
        assert.equal(receipt.changedOutside,0);assert.equal(receipt.baseSha256,hash(base));
        assert.equal(receipt.deliveredSha256,hash(readFileSync(new URL(`${slug}.webp`,folder))));
    }
});
