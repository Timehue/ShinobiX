import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildWorldNavigation,createWorldWalker,worldRoute,type WorldNode} from '../../../shared/continuous-world-navigation';
import {WorldCompanionMotion,worldCompanionPet,WORLD_COMPANION_LIMITS as L,type WorldCompanionFrame,type CompanionMark} from './world-pet-companion';
import {STARTER_PETS} from '../data/starter-pets';
import type {Character} from '../types/character';
const pet={...STARTER_PETS[0].pet,id:'owned',name:'Owned companion',level:1,unlockedForPve:false};
test('only the actual owned selection follows; away pets and active breeding parents stay away without changing combat eligibility',()=>{
    const owner={pets:[pet,{...pet,id:'reserve'}],activePetId:pet.id,activePetId2v2:'reserve'} as Character;
    assert.equal(worldCompanionPet(owner,100),pet);assert.equal(pet.unlockedForPve,false);
    assert.equal(worldCompanionPet({...owner,activePetId:'missing'},100),undefined);
    assert.equal(worldCompanionPet({...owner,activePetId:undefined},100),undefined);
    assert.equal(worldCompanionPet({...owner,pets:[{...pet,expedition:{endsAt:1} as never}]},100),undefined,'uncollected returns stay away');
    const breeding={state:'breeding',readyAt:200,parentIds:[pet.id,'other']} as Character['petBreeding'];
    assert.equal(worldCompanionPet({...owner,petBreeding:breeding},100),undefined);
    assert.equal(worldCompanionPet({...owner,petBreeding:breeding},200),pet);
    assert.equal(worldCompanionPet({...owner,pets:[{...pet,breedingSessionId:'lineage-only'}]},100)?.id,pet.id);
});
const nodes=new Map<string,WorldNode>([
    ['a',{id:'a',sector:42,x:.5,y:.5,neighbors:['b']}],['b',{id:'b',sector:42,x:1.5,y:.5,neighbors:['a','c']}],
    ['c',{id:'c',sector:42,x:1.5,y:1.5,neighbors:['b','d']}],['d',{id:'d',sector:43,x:2.5,y:1.5,neighbors:['c']}],
]);
function frame(from='b',to=from,progress=0):WorldCompanionFrame{
    const a=nodes.get(from)!,b=nodes.get(to)!;
    return {now:1000,seconds:.05,cursor:{layoutVersion:'test',from,to,progress},player:{x:a.x+(b.x-a.x)*progress,y:a.y+(b.y-a.y)*progress},sector:a.sector,nodes,chunk:{x:0,y:0},tilePx:32,paused:false};
}
test('the follower keeps corners, partial edges and border continuity while staying on real graph segments',()=>{
    const motion=new WorldCompanionMotion();let now=0;
    for(const edge of [['b','c'],['c','d']] as const)for(let i=0;i<=20;i++){
        const f={...frame(...edge,i/20),now:now+=50};const old=motion.position,pose=motion.step(f,[],0);
        assert(pose.point);if(old)assert(Math.hypot(old.x-pose.point.x,old.y-pose.point.y)<=L.speed*.05+.0001);
        const p=pose.point;assert(Math.abs(p.y-.5)<1e-6&&p.x>=.5&&p.x<=1.5||Math.abs(p.x-1.5)<1e-6&&p.y>=.5&&p.y<=1.5||Math.abs(p.y-1.5)<1e-6&&p.x>=1.5&&p.x<=2.5,JSON.stringify({p,old,edge,i}));
        assert(motion.queued<=L.points);
    }
    const before=motion.position!;motion.step({...frame('d'),now:now+50,sector:43},[],0);
    assert(Math.hypot(before.x-motion.position!.x,before.y-motion.position!.y)<=.4+.0001,'sector change does not respawn the pet');
});
test('only live tracking clues cause a bounded pause, with no invented gathering or stale-duel reactions',()=>{
    const mark:CompanionMark={tile:0,direction:0,seed:10,until:5000};
    for(const bad of [{...mark,direction:undefined},{...mark,worked:true},{...mark,until:0},{...mark,tile:144}])assert.equal(new WorldCompanionMotion().step(frame(),[bad],100).noticing,false);
    const motion=new WorldCompanionMotion();assert(motion.step(frame(),[mark],100).noticing);
    const position=motion.position;for(let i=0;i<10;i++)motion.step({...frame(),now:1100+i*50},[mark],100);
    assert.deepEqual(motion.position,position);assert.equal(motion.remembered,1);
    for(let i=0;i<45;i++)motion.step({...frame(),now:2000+i*50},[mark],100);
    assert.equal(motion.step(frame(),[mark],100).noticing,false,'same live clue is inspected once');
    assert.equal(new WorldCompanionMotion().step(frame(),[mark],5000).noticing,false);
});
test('paused frames do no walking or clue work, and an expired clue cancels a cached reaction',()=>{
    const motion=new WorldCompanionMotion(),marks=[{tile:0,direction:0,seed:10,until:5000}];motion.step(frame(),marks,100);
    const before=motion.position;const hidden=motion.step({...frame('b','c',.9),paused:true,seconds:600,now:999999},marks,100);
    assert.deepEqual(motion.position,before);assert.equal(hidden.visible,false);
    assert.equal(motion.step(frame(),marks,5000).noticing,false);
});
test('a server relocation fades to connected ground, without storing an unbounded world route',()=>{
    const far={id:'far',sector:45,x:40.5,y:40.5,neighbors:[]} as WorldNode,graph=new Map([...nodes,['far',far] as const]);
    const motion=new WorldCompanionMotion();motion.step(frame(),[],0);
    const f={...frame(),nodes:graph,cursor:{layoutVersion:'test',from:'far',to:'far',progress:0},player:far,sector:45};
    assert.equal(motion.step(f,[],0).visible,false);assert.deepEqual(motion.position,{x:40.5,y:40.5});assert(motion.queued<=L.points);
});
test('an occupied waiting spot is replaced by a connected free spot, then the pet rejoins without a warp',()=>{
    const graph=new Map(nodes);graph.set('b',{...graph.get('b')!,neighbors:['a','c','e']});graph.set('e',{id:'e',sector:42,x:2.5,y:.5,neighbors:['b']});
    const occupied=[{x:.5,y:.5}],motion=new WorldCompanionMotion(),marks=[{tile:1,direction:0,seed:1,until:5000}];
    for(let i=0;i<80;i++){
        const before=motion.position,pose=motion.step({...frame(),nodes:graph,occupied,now:i*50},marks,0);
        if(before)assert(Math.hypot(before.x-pose.point!.x,before.y-pose.point!.y)<=.40001);
    }
    assert(Math.hypot(motion.position!.x-.5,motion.position!.y-.5)>=.8);
    assert(Math.hypot(motion.position!.x-1.5,motion.position!.y-.5)>=.8);
    for(let i=0;i<20;i++){
        const before=motion.position,pose=motion.step({...frame('b','c',Math.min(1,i/10)),nodes:graph,occupied,now:4000+i*50},[],0);
        assert(Math.hypot(before!.x-pose.point!.x,before!.y-pose.point!.y)<=.40001);
    }
    assert(motion.queued<=L.points);
});
test('a fully occupied small clearing does not retry graph work on every frame',()=>{
    const graph=new Map(nodes),read=graph.get.bind(graph);let reads=0;graph.get=id=>{reads++;return read(id);};
    const motion=new WorldCompanionMotion(),occupied=[...nodes.values()].map(p=>({x:p.x,y:p.y})),marks:CompanionMark[]=[];
    for(let i=0;i<100;i++)motion.step({...frame(),nodes:graph,occupied,now:i*10,seconds:.01},marks,0);
    assert(reads<200,`crowded idle second used ${reads} graph reads`);assert(motion.queued<=L.points);
});
test('the real Midlands and inter-sector road graph keeps the companion on connected walkable edges',()=>{
    const space=JSON.parse(readFileSync(new URL('../../../shared/continuous-world-layout.json',import.meta.url),'utf8'));
    const graph=buildWorldNavigation(space).byId;
    const destination=worldRoute(graph,'42:65','43:65')?'43:65':graph.get('42:65')!.neighbors[0];
    const walker=createWorldWalker(graph,'42:65'),motion=new WorldCompanionMotion();assert(walker.go(destination));
    const route=worldRoute(graph,'42:65',destination)!;assert(route.length>1);
    for(let i=0;i<500&&walker.moving;i++){
        walker.tick(.05);const cursor=walker.cursor('actual');
        const pose=motion.step({now:i*50,seconds:.05,cursor,player:walker.position,sector:walker.node.sector,nodes:graph,chunk:{x:0,y:0},tilePx:30,paused:false},[],0);
        assert(pose.point);assert(motion.queued<=L.points);
        assert(Number.isFinite(pose.point.x)&&Number.isFinite(pose.point.y));
    }
    assert.equal(walker.moving,false);
});
