import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {lifeSceneView,parseLifeState,lifeActorPosition,lifeEventView,LIFE_WINDOW_MS} from './sector-life.js';
import {lifeActivityAtPosition,lifeActivityAt} from './sector-life-motion.js';
import {SHRINE_SWEEP,SHRINE_WORK_LINES,SHRINE_SWEEP_CLEARANCE} from './sector-shrine-work.js';
import {sectorWalkMask,isWalkableTile} from './sector-walk-mask.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';
import {rememberLifeWitness} from './sector-life-witness.js';

const day=Math.floor(Date.UTC(2026,9,19)/WORLD_DAY_MS)*WORLD_DAY_MS;
const noon=day+8*WORLD_HOUR_MS;
const state={...parseLifeState(null,noon),step:3,updatedAt:noon-300_000};
const scene=(at:number,weather='clear',step=3)=>lifeSceneView(15,{...state,window:Math.floor(at/LIFE_WINDOW_MS),step},at,weather,undefined,undefined,{tier:2,maintainedAt:noon-1000,by:'Aki'});
const keeper=scene(noon).actors.find(a=>a.id==='keeper:15')!;

test('the existing Heartwood keeper sweeps only the two connected paved sections and returns to the lamp post',()=>{
    assert.equal(keeper.workTool,'broom');assert.equal(keeper.restTile,SHRINE_SWEEP.post);
    for(const tile of SHRINE_SWEEP.sections)assert.equal(sectorWalkMask(15)![Math.floor(tile/12)][tile%12],'=');
    const tiles=new Set<number>();
    for(let elapsed=0;elapsed<=SHRINE_SWEEP.period;elapsed+=500){
        const at=keeper.motion!.start+elapsed,p=lifeActorPosition(15,keeper,at),tile=Math.round(p.row)*12+Math.round(p.col);
        assert(isWalkableTile(15,tile));tiles.add(tile);
        const work=lifeActivityAtPosition(keeper,p,at);
        if('working' in work&&work.working){assert(SHRINE_SWEEP.sections.includes(tile as 112|100));assert.match(work.line,/Aki helped/);assert(work.line.includes(SHRINE_WORK_LINES.sweep));}
    }
    assert.deepEqual([...tiles].sort((a,b)=>a-b),[100,111,112]);
    const final=lifeActorPosition(15,keeper,keeper.motion!.start+SHRINE_SWEEP.period-1);
    assert.deepEqual([final.col,final.row],[3,9]);
});

test('late physical arrival keeps work speech and the broom off until the actual section is reached',()=>{
    for(const [offset,tile] of [[24_000,112],[47_000,100]]){
        const at=keeper.motion!.start+offset;
        const late=lifeActivityAtPosition(keeper,{col:3,row:9},at);
        assert.equal(late.activity,'Walking to the next sweep section');assert(!('working' in late));
        const work=lifeActivityAtPosition(keeper,{col:tile%12,row:Math.floor(tile/12)},at);
        assert.equal(work.activity,'Sweeping the shrine approach');assert('working' in work&&work.working);
    }
});

test('lamp help, adverse weather and night retain the same keeper without sweeping; cached dry work closes at the post',()=>{
    for(const weather of ['rain','thunderstorm','tornado','ashfall'])assert.equal(scene(noon,weather).actors.find(a=>a.id===keeper.id)?.workTool,undefined);
    for(const hour of [0,4.99,20,23])assert.equal(scene(day+hour*WORLD_HOUR_MS).actors.find(a=>a.id===keeper.id)?.workTool,undefined);
    let helpWindow=Math.floor(noon/LIFE_WINDOW_MS);if(helpWindow%2===0)helpWindow++;const help=helpWindow*LIFE_WINDOW_MS+60_000;
    assert.equal(lifeEventView(15,parseLifeState(null,help),help).phase,'active');
    const asking=scene(help,'clear',0).actors.find(a=>a.id===keeper.id)!;
    assert.equal(asking.workTool,undefined);assert.match(asking.line,/left one/);
    const until=keeper.motion!.ending!.at;
    for(const at of [until,day+20*WORLD_HOUR_MS,day+WORLD_DAY_MS+4*WORLD_HOUR_MS]){
        const p=lifeActorPosition(15,keeper,at);assert.deepEqual([p.col,p.row],[3,9]);
        assert(!('working' in lifeActivityAt(keeper,at)));
    }
});

test('sweeping reuses the existing keeper and preserves real helper and witness memory through every work phase',()=>{
    for(let elapsed=0;elapsed<2*WORLD_DAY_MS;elapsed+=30_000){
        const view=scene(noon+elapsed);assert(view.actors.length<=5);assert.equal(view.actors.filter(a=>a.id===keeper.id).length,1);
        for(const visitor of view.actors.filter(a=>a.id!==keeper.id))assert(!SHRINE_SWEEP.sections.includes(visitor.restTile as 112|100),`${visitor.id} must not rest in a sweep section`);
        for(const visitor of view.actors.filter(a=>a.id.startsWith('pilgrim:'))){assert.deepEqual(visitor.clearance,SHRINE_SWEEP_CLEARANCE);for(const [,tile]of visitor.motion!.frames)assert(!SHRINE_SWEEP_CLEARANCE.includes(tile),'visitors walk around the keeper and broom');}
    }
    const at=noon,remembered=rememberLifeWitness(keeper,[{at,victor:'Aki',fallen:'Ben',witnesses:[{id:keeper.id,name:keeper.name,tile:112,at}]}],at);
    for(const phase of remembered.cyclePhases!){assert.match(phase.line,/Aki helped/);assert.match(phase.line,/I saw Aki and Ben/);if(phase.approach)assert.match(phase.approach.line,/I saw Aki and Ben/);}
});

test('the tiny transparent tool and reviewed floor bindings match the admitted local art',async()=>{
    const review=JSON.parse(readFileSync(new URL('shrine-work-review.json',import.meta.url),'utf8'));
    assert.match(review.visualReview,/^passed/,'regenerated tools need a fresh native visual review');
    const hash=(file:string)=>createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex');
    assert.equal(hash(review.tool.file),review.tool.sha256);assert(review.tool.bytes<4096);assert(review.tool.width*review.tool.height*4<16_384);
    for(const floor of review.floors)assert.equal(hash(floor.file),floor.sha256);
    const bytes=readFileSync(new URL('../'+review.tool.file,import.meta.url)),metadata=await sharp(bytes).metadata();
    assert.equal(bytes.length,review.tool.bytes);assert.equal(metadata.width,21);assert.equal(metadata.height,96);assert(metadata.hasAlpha);
    const {data}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert(data.filter((_,i)=>i%4===3&&data[i]===0).length>1000,'the broom retains a clean transparent surround');
    assert.deepEqual(review.sections,[112,100]);assert.equal(review.newActors,0);assert.equal(review.newRafLoops,0);
});
