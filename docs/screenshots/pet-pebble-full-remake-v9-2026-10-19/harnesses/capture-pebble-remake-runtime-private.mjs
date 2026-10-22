// Evidence capture only. Every resulting sheet remains pending human/visual review.
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {runtimePetModels} from '../scripts/lib/pet-runtime-audit.mjs';
import {petReviewRendererSha256} from '../scripts/check-pet-shape-review.mjs';
const arg=(k,d)=>process.argv.find(v=>v.startsWith(`--${k}=`))?.slice(k.length+3)??d;
const ids=arg('model')?.split(','),label=arg('label','runtime-transitions');
const client=resolve(import.meta.dirname,'..'),repo=resolve(client,'..');
const viewport=arg('quality','medium')==='low'?{width:390,height:844}:{width:1280,height:800};
const out=resolve(client,'.tmp/pet-shape-review',label);await mkdir(out,{recursive:true});
const regions=JSON.parse(await readFile(resolve(client,'scripts/pet-skull-regions.json'))).pets;
const cameras=JSON.parse(await readFile(resolve(client,'scripts/pet-review-cameras.json')));
const anatomicalPicks=JSON.parse(await readFile(resolve(client,'.tmp/pebble-full-remake/new-anatomy.json'))).pets;
const selected=runtimePetModels.filter(r=>!ids||ids.includes(r.pet.id));
if(!selected.length||ids?.some(id=>!selected.some(row=>row.pet.id===id)))throw Error('Empty or incomplete pet selection');
Object.assign(regions,cameras.pets);
if(arg('region-file'))Object.assign(regions,JSON.parse(await readFile(resolve(arg('region-file')))).pets);
const rows=[
 ['idle',1.2,{motion:'idle'}],['run',.8,{motion:'run',moving:true,speed:3}],
 ['dash',.6,{motion:'dash',moving:true,speed:5}],['windup',.38,{motion:'windup'}],
 ['strike',.26,{motion:'strike',contactPose:true}],['recover',.51,{motion:'recover'}],
 ['stagger',.65,{motion:'stagger',hit:.6,contactPose:true}],['dodge',.65,{motion:'dodge'}],
 ['guard',.8,{motion:'guard'}],['rest',1.2,{motion:'rest'}],
 ['cast',.9,{motion:'idle',casting:true}],['entrance',1.1,{motion:'idle'}],
 ['victory',1.2,{motion:'idle',victorious:true}],['dead',1.6,{motion:'dead'}],
 ['revive',.8,{motion:'idle'}],['attack-sequence',1.7,{motion:'windup'}],
];
const phases=[.025,.10,.25,.50,.75,1];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rendererSha256=await petReviewRendererSha256(repo),errors=[],pets=[];
const harnessHash=createHash('sha256');
for(const file of ['.tmp/capture-pebble-remake-runtime-private.mjs','src/pet-runtime-audit.tsx','src/pet-independent-face-probe.ts'])harnessHash.update(file+'\0').update((await readFile(resolve(client,file),'utf8')).replaceAll('\r\n','\n')).update('\0');
const captureHarnessSha256=harnessHash.digest('hex');
const cameraHash=id=>sha(Buffer.from(JSON.stringify({region:regions[id],extraHeads:cameras.extraHeads[id]??[]})));
const anatomyHash=id=>sha(Buffer.from(JSON.stringify(anatomicalPicks[id]?.landmarks?anatomicalPicks[id]:null)));
if(process.argv.includes('--resume')){
 try{
  const previous=JSON.parse(await readFile(resolve(out,'manifest.json')));
  if(previous.rendererSha256!==rendererSha256||previous.captureHarnessSha256!==captureHarnessSha256||JSON.stringify(previous.viewport)!==JSON.stringify(viewport)||previous.errors.length)throw Error('Cannot resume stale or failed renderer/capture evidence');
  for(const pet of previous.pets){
   const row=runtimePetModels.find(r=>r.pet.id===pet.id);
   for(const capture of pet.captures){
    if(capture.cameraSha256!==cameraHash(pet.id)||capture.anatomySha256!==anatomyHash(pet.id)||capture.quality!==arg('quality','medium'))throw Error(`${pet.id}: cannot resume changed framing, anatomy or quality`);
    if(process.argv.includes('--require-independent-faces')&&(!capture.anatomyReport?.poses||capture.anatomyReport.failed))throw Error(`${pet.id}: cannot resume missing or failed anatomical measurements`);
    const path=capture.stage==='source'?row.path:resolve(client,'public/pet-models/warfront-lod',relative(resolve(client,'public/pet-models'),row.path));
    if(sha(await readFile(path))!==capture.sha256)throw Error(`${pet.id}: cannot resume changed asset`);
    for(const sheet of capture.sheets)if(sha(await readFile(resolve(out,sheet.name)))!==sheet.sha256)throw Error(`${pet.id}: cannot resume changed evidence`);
   }
   pets.push(pet);
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}
}
const browser=await chromium.launch({headless:true});let page;
try{
 for(const [index,row] of selected.filter(r=>!pets.some(p=>p.id===r.pet.id)).entries()){
  if(!page||index%6===0){await page?.close();page=await browser.newPage({viewport,ignoreHTTPSErrors:process.argv.includes('--ignore-https-errors')});
   page.on('pageerror',error=>errors.push(`${row.pet.id}: ${error.message}`));
   await page.route('**/pet-models/**',async route=>{const url=new URL(route.request().url());if(!url.pathname.endsWith('/starter-earth.glb'))return route.continue();const path=resolve(client,url.pathname.includes('/warfront-lod/')?'.tmp/pebble-full-remake/delivery/public/pet-models/warfront-lod/starter-earth.glb':'.tmp/pebble-full-remake/pebble-remade-private.glb');await route.fulfill({contentType:'model/gltf-binary',body:await readFile(path)});});
   await page.goto(`${arg('base-url','http://127.0.0.1:5207')}/petruntimeaudit.html?quality=${arg('quality','medium')}`,{waitUntil:'domcontentloaded',timeout:120000});
   await page.waitForFunction(()=>!!window.petRuntimeAudit,{},{timeout:120000});}
  const captures=[];
  for(const stage of ['source','battle']){
   const path=resolve(client,stage==='source'?'.tmp/pebble-full-remake/pebble-remade-private.glb':'.tmp/pebble-full-remake/delivery/public/pet-models/warfront-lod/starter-earth.glb');
   const sha256=sha(await readFile(path));
   const extraHeads=cameras.extraHeads[row.pet.id]??[];
   const anatomy=anatomicalPicks[row.pet.id]?.landmarks?anatomicalPicks[row.pet.id]:undefined;
   if(process.argv.includes('--require-independent-faces')&&!anatomy)throw Error(`${row.pet.id}: independent anatomical coverage missing`);
   const diagnostic={landmarkCamera:process.argv.includes('--landmark-cameras'),normals:process.argv.includes('--diagnostic-normals')};
   const loaded=await page.evaluate(({id,stage,region,extraHeads,anatomy,diagnostic})=>window.petRuntimeAudit.load(id,stage,region,extraHeads,anatomy,diagnostic),{id:row.pet.id,stage,region:regions[row.pet.id],extraHeads,anatomy,diagnostic});
   if(diagnostic.normals&&!loaded.diagnosticNormalSurfaces)throw Error('No production surfaces for normal attachments');
   const frames=await page.evaluate(({rows,phases,extraCount,diagnostic})=>{
    const api=window.petRuntimeAudit,parts=['head',...Array.from({length:extraCount},(_,i)=>`head-${i+2}`),'body'];
    const outputs=Object.fromEntries(parts.flatMap(part=>diagnostic.normals?[[part,[]],[part+'-normals',[]]]:[[part,[]]]));
    for(const [label,duration,patch] of rows){let age=0;
     for(const phase of phases){const target=duration*phase;
      while(age<target-1e-8){const delta=Math.min(1/30,target-age);age+=delta;
       const state={motion:'idle',moving:false,speed:0,casting:false,victorious:false,contactPose:false,hit:0,entranceProgress:undefined,attackPhaseProgress:undefined,...patch};
       if(['windup','strike','recover'].includes(state.motion))state.attackPhaseProgress=age/duration;
       if(label==='entrance')state.entranceProgress=age/duration;
       if(label==='attack-sequence'){
        state.motion=age<.38?'windup':age<.64?'strike':age<1.15?'recover':'idle';
        state.contactPose=state.motion==='strike';
        state.attackPhaseProgress=age<.38?age/.38:age<.64?(age-.38)/.26:(age-.64)/.51;
       }
       api.step(delta,state);
      }
      for(const part of parts)for(const view of ['front','side']){
       const headIndex=part==='head'||part==='body'?0:Number(part.split('-')[1])-1;
       outputs[part].push({label,phase,view,image:api.render(view,part==='body'?'body':'head',headIndex)});
       if(diagnostic.normals){const signature=api.poseSignature();outputs[part+'-normals'].push({label,phase,view,image:api.render(view,part==='body'?'body':'head',headIndex,true)});if(signature!==api.poseSignature())throw Error('Normal attachment changed production pose or frame clock');}
      }
     }
    }
    return outputs;
   },{rows,phases,extraCount:extraHeads.length,diagnostic});
   const sheets=[];
   for(const part of Object.keys(frames)){
    const cell=160,header=20,width=cell*12,height=rows.length*(cell+header),cells=[];
    for(const entry of frames[part]){
     const r=rows.findIndex(v=>v[0]===entry.label),c=phases.indexOf(entry.phase)+(entry.view==='side'?6:0);
     const buffer=await sharp(Buffer.from(entry.image.split(',')[1],'base64')).resize(cell,cell).png().toBuffer();
     cells.push({input:buffer,left:c*cell,top:r*(cell+header)+header});
    }
    const xml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;');
    const titles=`<svg width="${width}" height="${height}">${rows.map(([label],r)=>`<text x="4" y="${r*(cell+header)+15}" fill="white" font-family="sans-serif" font-size="13">${xml(row.pet.id)} | ${stage} | ${label} | FRONT 2.5 10 25 50 75 100% | SIDE 2.5 10 25 50 75 100%</text>`).join('')}</svg>`;
    const name=`${row.pet.id}-${stage}-${part}.webp`;
    const bytes=await sharp({create:{width,height,channels:3,background:'#101726'}}).composite([...cells,{input:Buffer.from(titles),left:0,top:0}]).webp({quality:88}).toBuffer();
    await writeFile(resolve(out,name),bytes);sheets.push({name,sha256:sha(bytes)});
   }
   if(sha(await readFile(path))!==sha256)throw Error(`${row.pet.id}: asset changed during runtime capture`);
   const anatomyReport=await page.evaluate(()=>window.petRuntimeAudit.anatomyReport());
   if(anatomyReport?.failed)errors.push(`${row.pet.id}/${stage}: independent anatomical deformation detected; inspect retained captures`);
   captures.push({stage,sha256,...loaded,sheets,pairedNormalPoseVerified:diagnostic.normals,cameraSha256:cameraHash(row.pet.id),anatomySha256:anatomyHash(row.pet.id),...(anatomyReport?{anatomyReport}:{})});
  }
  pets.push({id:row.pet.id,name:row.pet.name,captures,review:'pending'});
  await writeFile(resolve(out,'manifest.json'),JSON.stringify({schema:1,rendererSha256,captureHarnessSha256,viewport,rows:rows.map(([name,duration,frame])=>({name,duration,frame})),phases,views:['front','side'],errors,pets,artisticCertification:false},null,2)+'\n');
  console.log(`Runtime transitions captured ${pets.length}: ${row.pet.id}`);
 }
 if(await petReviewRendererSha256(repo)!==rendererSha256)throw Error('Production renderer changed during capture');
 console.log(JSON.stringify({identities:pets.length,errors,output:out}));if(errors.length)process.exitCode=1;
}finally{await browser.close();}
