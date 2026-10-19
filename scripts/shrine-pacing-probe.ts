import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
/** Offline spacing diagnostic: legacy geometry AND legacy hunter-contact rules vs current. */
import { generateHollowGateFloor as afterGen } from '../shinobij.client/src/lib/hollow-gate-generate.ts';
import { hollowGateSeededRandom } from '../shinobij.client/src/lib/hollow-gate-dungeon.ts';
import { validateHollowGateFloorManifest } from '../api/hollow-gate/_floor-manifest.ts';
import { deriveHollowGateFloorFeatures } from '../api/hollow-gate/_floor-features.ts';
import { undergroundFeatureWalkable } from '../shared/underground-floor-collision.ts';
import { createHollowGateWanderers, advanceHollowGateWanderers, hollowGateWandererDistance as distance, hollowGateWandererFriendly as friendly, hollowGateWandererOrigin as origin } from '../shared/hollow-gate-wanderers.ts';

const beforeGen: typeof afterGen = (floor, final, dims, rng) => afterGen(floor, final, dims, rng, true);
const output = process.argv[process.argv.indexOf('--output') + 1];
assert.ok(process.argv.includes('--output') && output, '--output is required');
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sources=['shinobij.client/src/lib/hollow-gate-dungeon.ts','api/hollow-gate/_floor-features.ts','api/hollow-gate/_floor-manifest.ts','shared/underground-floor-collision.ts','shinobij.client/src/lib/hollow-gate-generate.ts','shared/hollow-gate-wanderers.ts','api/hollow-gate/step.ts','api/hollow-gate/combat-settle.ts','shared/hollow-gate-pacing.ts'];
const fingerprint=()=>Object.fromEntries(sources.map(p=>[p,hash(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
const startFingerprint=fingerprint();
// These five full-board hashes were captured from main before the pacing patch,
// using an independent checkout. Pin the legacy reference, not just determinism.
const frozenLegacyHashes = [
 'b3e356eb92526694533888f1d851bedcd3067c5b027c2603b02ae2f2f2e16514',
 '8441984d27705b74bbd7df67082efc9443c70de285e7ff08fea9183678948515',
 '70925079734be4a8ad6c50379faa7655c76e1b8552891986087697bdd42eaac0',
 'a8f76e9da44f268c95f3e7078e6652294fb4cdf19c628b9b29e1d00d1a15e939',
 '37ed38c4176a81484413947d47c537d960d28a388a6a1aad55528964bed1efcf',
];
for (let floor = 1; floor <= 5; floor++) {
 let state = 23 + floor * 1000;
 const rng = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
 assert.equal(hash(beforeGen(floor, floor === 5, undefined, rng)), frozenLegacyHashes[floor - 1]);
}
const neighbors=(n:number,b:any)=>[n-b.width,n+1,n+b.width,n-1].filter(v=>v>=0&&v<b.walkable.length&&distance(v,n,b.width)===1&&b.walkable[v]==='1'&&b.nodes[v]!=='locked');
function path(from:number,to:number,b:any){
 const q=[from],prev=new Map<number,number>([[from,-1]]);
 for(let k=0;k<q.length&&!prev.has(to);k++)for(const n of neighbors(q[k],b))if(!prev.has(n)){prev.set(n,q[k]);q.push(n);}
 if(!prev.has(to))return null;
 const out=[];for(let n=to;n!==from;n=prev.get(n)!)out.push(n);return out.reverse();
}
const physical=new WeakMap();
function simulate(manifest:any,tiles:any[],seed:string,phase:number,mode:string,updated:boolean,rift:boolean,depth:number){
 let board=physical.get(manifest);
 if(!board){const features=deriveHollowGateFloorFeatures(manifest,tiles);board={...manifest,walkable:undergroundFeatureWalkable(manifest.walkable,features)};physical.set(manifest,board);}
 let npcs=createHollowGateWanderers(board,seed,'Ashen Leaf Village');
 let at=manifest.spawn.y*board.width+manifest.spawn.x,step=0,torch=10,threat=0,breather=0,medicDone=mode==='stairs',medicReached=mode==='stairs',medicUnavailable=false,lastFight=-999;
 const target=Number(Object.keys(board.nodes).find(k=>['descend','boss'].includes(board.nodes[k])));
 const resolved=new Set<string>(),events:any[]=[];let cardDone=false,bossEnded=false;
 const fight=(kind:string,id:string,source:string)=>{
  if(resolved.has(id))return;
  resolved.add(id);events.push({step,kind,source,gap:events.length?step-lastFight:null});lastFight=step;threat=0;
  if(kind==='card')cardDone=true;
  else if(updated&&kind!=='boss')breather=3;
  if(kind==='boss')bossEnded=true;
  npcs=npcs.map(n=>n.nodeId===id?{...n,spent:true}:n);
 };
 while((!medicDone||at!==target)&&!bossEnded&&step<400){
  const medic=npcs.find(n=>n.role==='medic'&&!n.spent);
  if(!medicDone&&(!medic||distance(at,medic.tile,board.width)<=1)){
   medicDone=true;medicReached=Boolean(medic);npcs=npcs.map(n=>n.role==='medic'?{...n,spent:true}:n);
  }
  const dest=!medicDone&&medic?medic.tile:target;
  const route=path(at,dest,board);
  if(!route){if(!medicDone){medicUnavailable=true;medicDone=true;continue;}throw new Error('stairs unreachable without optional locked cache');}
  if(!route.length)continue;
  at=route[0];step++;
  if((step+phase)%5===0)torch=Math.max(0,torch-1);
  threat=Math.min(100,threat+4*(torch===0?2:1));
  const oldRoster=npcs;
  npcs=advanceHollowGateWanderers(board,npcs,{x:at%board.width,y:Math.floor(at/board.width)},step);
  const kind=board.nodes[at];
  const nearMedic=npcs.some(n=>n.role==='medic'&&!n.spent&&distance(n.tile,at,board.width)<=1);
  const hunter=(!updated||(breather===0&&!nearMedic))&&(!kind||origin(oldRoster,at))
   ?npcs.find(n=>!n.spent&&!friendly(n)&&distance(n.tile,at,board.width)<=1):undefined;
  const pending=threat>=100?(rift&&!cardDone?'card':manifest.floor>=depth?'boss':'ambush'):hunter?'battle':null;
  if(updated)breather=Math.max(0,breather-1);
  if(pending)fight(pending,pending==='battle'?hunter!.nodeId:`threat:${step}`,pending==='battle'?'hunter':'threat');
  if(!bossEnded&&['battle','elite','boss'].includes(kind)&&!origin(oldRoster,at))fight(kind,`fixed:${at}`,'fixed');
 }
 assert.ok(step<400,'route must terminate');
 const counts=(key:string,val:string)=>events.filter(e=>e[key]===val).length;
 return {steps:step,medicReached,medicUnavailable,bossEnded,total:events.length,mobs:events.filter(e=>e.kind!=='boss'&&e.kind!=='card').length,
  fixed:counts('source','fixed'),hunters:counts('source','hunter'),threat:counts('source','threat'),cards:counts('kind','card'),bosses:counts('kind','boss'),elites:counts('kind','elite'),backToBack:events.filter(e=>e.gap!==null&&e.gap<=1).length,events};
}
const configs=[{id:'standard25x17',width:25,height:17,depth:5,rift:false},{id:'compact15x11',width:15,height:11,depth:3,rift:true},{id:'compact17x13',width:17,height:13,depth:2,rift:true},{id:'large31x21',width:31,height:21,depth:5,rift:false}];
const rows:any[]=[],failures:any[]=[];let legacyExact=0;
for(const cfg of configs)for(let floor=1;floor<=cfg.depth;floor++)for(let i=1;i<=40;i++){
 if(i===1)console.log(`Starting ${cfg.id} floor ${floor}`);
 const seed=`independent-pacing-${i}`,dims={width:cfg.width,height:cfg.height};
 try{
  const old=beforeGen(floor,floor===cfg.depth,dims,hollowGateSeededRandom(seed,floor));
  const legacy=afterGen(floor,floor===cfg.depth,dims,hollowGateSeededRandom(seed,floor),true);
  assert.equal(hash(legacy),hash(old),'legacy reference remains deterministic');legacyExact++;
  const fresh=afterGen(floor,floor===cfg.depth,dims,hollowGateSeededRandom(seed,floor));
  for(const [mode,run] of [['before',old],['after',fresh]] as const){
   const checked=validateHollowGateFloorManifest({floor,finalFloor:floor===cfg.depth,...dims,playerX:run.playerX,playerY:run.playerY,tiles:run.tiles});
   assert.ok(checked.ok,JSON.stringify(checked));if(!checked.ok)continue;
   for(const route of ['stairs','medic-stairs'])for(let phase=0;phase<5;phase++)rows.push({config:cfg.id,floor,seed,mode,route,phase,...simulate(checked.manifest,run.tiles,seed,phase,route,mode==='after',cfg.rift,cfg.depth)});
  }
 }catch(e){failures.push({config:cfg.id,floor,seed,error:String(e)});}
}
assert.deepEqual(fingerprint(),startFingerprint,'pacing sources stable during diagnostic');
assert.equal(failures.length, 0, 'every sampled board and route must succeed');
assert.equal(legacyExact, 600, 'all paired boards must be retained');
assert.equal(rows.length, 12000, 'all routes, including unavailable-Medic cases, must be retained');
const metrics=['total','mobs','fixed','hunters','threat','cards','bosses','elites','steps','backToBack'];
const stats=(r:any[])=>Object.fromEntries(metrics.map(k=>[k,{mean:r.reduce((s,x)=>s+x[k],0)/r.length,min:Math.min(...r.map(x=>x[k])),max:Math.max(...r.map(x=>x[k]))}]));
const groups:any[]=[];
for(const c of configs)for(const route of ['stairs','medic-stairs'])for(const mode of ['before','after']){const r=rows.filter(r=>r.config===c.id&&r.route===route&&r.mode===mode);groups.push({config:c.id,route,mode,n:r.length,...stats(r),medicNotReached:r.filter(x=>!x.medicReached).length,medicUnavailable:r.filter(x=>x.medicUnavailable).length});}
const paired=rows.filter(r=>r.mode==='after').map(a=>{const b=rows.find(r=>r.mode==='before'&&r.config===a.config&&r.floor===a.floor&&r.seed===a.seed&&r.route===a.route&&r.phase===a.phase)!;return {config:a.config,floor:a.floor,seed:a.seed,route:a.route,phase:a.phase,totalDelta:a.total-b.total,backToBackDelta:a.backToBack-b.backToBack,cardsDelta:a.cards-b.cards,elitesDelta:a.elites-b.elites};});
assert.equal(paired.length, 6000);
const report={scope:'Offline full-known-map shortest path, actual generator/physical blockers/wanderer movement. Instant victories; no combat time/survival/rewards model. One deterministic torch drain every five accepted steps, five phases. Medic route re-plans toward moving medic until adjacent; accepts heal then heads to stairs. When Medic is behind locked cache and no unlocked path exists, records unavailable and proceeds to stairs. No keys/torch refill/ward augment/escape/exploration. Current new hunter contact policy mirrored from step.ts; threat formula unchanged. Rift level>=20. Final-floor boss victory ends route.',legacyExact,failures,sourceHashes:startFingerprint,groups,pairedSummary:{n:paired.length,moreEncounters:paired.filter(r=>r.totalDelta>0).length,fewerEncounters:paired.filter(r=>r.totalDelta<0).length,moreBackToBack:paired.filter(r=>r.backToBackDelta>0).length,fewerBackToBack:paired.filter(r=>r.backToBackDelta<0).length,cardCountChanges:paired.filter(r=>r.cardsDelta!==0).length},rows,paired};
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({legacyExact,failures,groups,pairedSummary:report.pairedSummary},null,2));

