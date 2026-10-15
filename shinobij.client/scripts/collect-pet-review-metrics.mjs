// Reuse only successful, complete numeric evidence for the exact current bytes.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {PET_REVIEW_CLIPS} from './check-pet-shape-review.mjs';
const client=resolve(import.meta.dirname,'..'),repo=resolve(client,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const regions=JSON.parse(await readFile(resolve(import.meta.dirname,'pet-skull-regions.json'))).pets;
const mask=r=>JSON.stringify(Object.fromEntries(['y','z','x','union','exclude','anchorBone'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));
const index=new Map();
for(const row of runtimePetModels)for(const stage of ['source','battle']){
 const file=stage==='source'?row.path:resolve(client,'public/pet-models/warfront-lod',relative(resolve(client,'public/pet-models'),row.path));
 const hash=sha(await readFile(file)),key=`${row.pet.id}:${hash}`;
 index.set(`${row.pet.id}:${stage}`,{id:row.pet.id,stage,sha256:hash,key,skull:null,geometry:null});
}
const sets=[['.tmp/pet-reviewed-skulls','skull'],['.tmp/pet-animation-audit','geometry']];
for(const [directory,kind] of sets)for(const name of await readdir(resolve(client,directory))){
 if(!name.endsWith('.json'))continue;
 let report;try{report=JSON.parse(await readFile(resolve(client,directory,name)));}catch{continue;}
 if(!Array.isArray(report.pets))continue;
 for(const pet of report.pets){
  const entries=[...index.values()].filter(row=>row.key===`${pet.id}:${pet.sha256??pet.assetSha256}`);if(!entries.length)continue;
  if(kind==='skull'){
   if(pet.failed!==false||pet.blendPoses!==468||mask(pet.region)!==mask(regions[pet.id])||PET_REVIEW_CLIPS.some(c=>!pet.clips.some(v=>v.clip===c&&Number.isFinite(v.worldMinRatio)&&Number.isFinite(v.worldMaxRatio))))continue;
  }else if(!pet.geometryCoverage?.startsWith('all vertices')||report.failures?.some(v=>v.id===pet.id)||report.deformationWarnings?.some(v=>v.id===pet.id)||PET_REVIEW_CLIPS.some(c=>!pet.clips.some(v=>v.name===c&&v.samples?.length&&v.samples.every(s=>s.severeEdges===0))))continue;
  for(const entry of entries)entry[kind]={report:relative(repo,resolve(client,directory,name)).replaceAll('\\','/'),reportSha256:sha(await readFile(resolve(client,directory,name)))};
 }
}
const pets=[...index.values()].map(({key,...entry})=>entry),missing=pets.filter(p=>!p.skull||!p.geometry).map(p=>({id:p.id,stage:p.stage,missing:['skull','geometry'].filter(k=>!p[k])}));
await writeFile(resolve(client,'.tmp/pet-reviewed-skulls/current-source-battle-index.json'),JSON.stringify({schema:1,pets,missing},null,2)+'\n');
console.log(JSON.stringify({assets:pets.length,verified:pets.length-missing.length,missing},null,2));if(missing.length)process.exitCode=1;
