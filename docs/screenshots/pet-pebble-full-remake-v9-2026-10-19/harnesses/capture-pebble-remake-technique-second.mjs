// Capture only: inspection and approval must be recorded separately.
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {runtimePetModels} from '../scripts/lib/pet-runtime-audit.mjs';
import {tacticsSpecies} from '../../shared/pet-tactics-roster.ts';
import {petReviewRendererSha256} from '../scripts/check-pet-shape-review.mjs';
const arg=(k,d)=>process.argv.find(a=>a.startsWith(`--${k}=`))?.slice(k.length+3)??d;
const id=arg('model','mythic-4'),label=arg('label',id+'-techniques'),row=runtimePetModels.find(r=>r.pet.id===id),species=tacticsSpecies(id);
if(!row||!species)throw Error('Unknown companion identity');
const moves=arg('moves')?.split(',')??[...species.pool,species.signature.id];
const views=arg('views','front,side').split(','),angles={front:0,side:2,opposite:6,quarter:1};
const client=resolve(import.meta.dirname,'..'),repo=resolve(client,'..'),out=resolve(client,'.tmp/pet-companion-techniques',label);await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),rendererSha256=await petReviewRendererSha256(repo);
const componentPath=resolve(client,'src/components/PetYardModelStage.tsx');
const componentHash=async()=>sha(Buffer.from((await readFile(componentPath,'utf8')).replaceAll('\r\n','\n')));
const companionComponentSha256=await componentHash();
const captureHarnessSha256=sha(Buffer.from((await readFile(new URL(import.meta.url),'utf8')).replaceAll('\r\n','\n')));
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:540,height:340},ignoreHTTPSErrors:process.argv.includes('--ignore-https-errors'),reducedMotion:'no-preference'});
const errors=[],requests=[],frames=[],sheets=[],diagnosticFrames=[],fiberModules=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('.glb'))requests.push(r.url());if(r.url().includes('/@react-three_fiber.js'))fiberModules.push(r.url());});
try{
 if(arg('asset')){const body=await readFile(resolve(arg('asset'))),pathname=new URL(row.model.url,'https://local.invalid').pathname.replace('/pet-models/','/pet-models/warfront-lod/');await page.route(`**${pathname}*`,route=>route.fulfill({contentType:'model/gltf-binary',body}));}
 await page.clock.install();await page.goto(`${arg('base-url','http://127.0.0.1:5207')}/petyardmodelaudit.html?pet=${encodeURIComponent(id)}`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>Number(document.querySelector('canvas')?.dataset.previewTriangles)>0,{},{timeout:120000});
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
 const contactFiber=[...new Set(fiberModules)][0];if(!contactFiber)throw Error('Production Fiber module missing');
 await page.evaluate(async fiberUrl=>{const {_roots}=await import(/* @vite-ignore */fiberUrl),state=_roots.get(document.querySelector('canvas')).store.getState();window.__PET_QA_CONTACT__=()=>{state.scene.updateMatrixWorld(true);let lowest=null,planeY=null;state.scene.traverse(n=>{if(n.isMesh&&n.geometry?.type==='CircleGeometry'){const e=n.matrixWorld.elements;planeY=e[13];}if(!n.isSkinnedMesh)return;n.skeleton.update();const p=n.geometry.attributes.position;for(let v=0;v<p.count;v++){const point=n.getVertexPosition(v,new (n.position.constructor)()).applyMatrix4(n.matrixWorld);if(!lowest||point.y<lowest.world[1])lowest={vertex:v,world:point.toArray(),bind:[p.getX(v),p.getY(v),p.getZ(v)],bones:[0,1,2,3].map(i=>({name:n.skeleton.bones[n.geometry.attributes.skinIndex.getComponent(v,i)].name,weight:n.geometry.attributes.skinWeight.getComponent(v,i)}))};}});if(!lowest||planeY===null)throw Error('Contact surfaces unavailable');return{planeY,lowest,clearance:lowest.world[1]-planeY};};},contactFiber);
 if(process.argv.includes('--diagnostic-normals')){
  const fiberUrl=[...new Set(fiberModules)][0];if(!fiberUrl)throw Error('Loaded production Fiber module not observed');
  await page.evaluate(async fiberUrl=>{
   const {_roots}=await import(/* @vite-ignore */fiberUrl);
   const root=_roots.get(document.querySelector('canvas'));if(!root)throw Error('Production scene unavailable');
   const state=root.store.getState(),banks=[];
   state.scene.traverse(node=>{if(!node.isSkinnedMesh)return;for(const material of Array.isArray(node.material)?node.material:[node.material]){
    const prior=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material),bank={value:0};banks.push(bank);
    material.onBeforeCompile=function(shader,renderer){prior.call(this,shader,renderer);if(!shader.fragmentShader.includes('vPetSurfaceNormal'))throw Error('Production skinned surface shader unavailable');shader.uniforms.uPetDiagnosticNormals=bank;shader.fragmentShader='uniform float uPetDiagnosticNormals;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','if(uPetDiagnosticNormals>0.5)outgoingLight=normalize(vPetSurfaceNormal)*0.5+0.5;\n#include <opaque_fragment>');};
    material.customProgramCacheKey=()=>cache()+'-qa-normal-attachment-v1';material.needsUpdate=true;
   }});
   if(!banks.length)throw Error('No production skinned surfaces');
   window.__PET_QA_NORMAL_ATTACHMENT__=enabled=>{const before=[];state.scene.traverse(n=>{if(n.isBone)before.push([n.name,...n.matrixWorld.elements]);});for(const bank of banks)bank.value=enabled?1:0;state.gl.render(state.scene,state.camera);const after=[];state.scene.traverse(n=>{if(n.isBone)after.push([n.name,...n.matrixWorld.elements]);});if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Diagnostic render moved production bones');return{boneMatrices:after,surfaces:banks.length,mode:enabled?'same-pose-surface-normals':'production-color'};};
  },fiberUrl);
 }
 let angle=0;
 // Twelve captures cover the full sequence; each interval advances the actual
 // production frame loop, including intermediate poses and the return to idle.
 const times=[.02,.09,.18,.30,.42,.54,.68,.86,1.08,1.32,1.56,1.86];
 for(const move of moves){
  await page.getByLabel('Preview technique').selectOption(move);
  for(const view of views){
   const target=angles[view];if(target===undefined)throw Error('Unknown camera');
   for(let n=0;n<(target-angle+8)%8;n++)await page.getByRole('button',{name:'Rotate 45',exact:true}).click();angle=target;
   await page.clock.runFor(100);await page.getByRole('button',{name:'Play technique',exact:true}).click();let prior=0;
   const group=[];
   for(const [i,time] of times.entries()){
    await page.clock.runFor((time-prior)*1000);prior=time;
    const selectedMove=await page.getByLabel('Preview technique').inputValue();if(selectedMove!==move)throw Error('Selected technique changed during capture');
    const data=await page.locator('canvas').evaluate(c=>({...c.dataset})),name=`${id}-${move}-${view}-${i}.png`,buffer=await page.locator('canvas').screenshot();
    await writeFile(resolve(out,name),buffer);const f={move,view,i,time,...data,name,sha256:sha(buffer)};f.contact=await page.evaluate(()=>window.__PET_QA_CONTACT__());group.push(f);frames.push(f);
    if(process.argv.includes('--diagnostic-normals')){
     const state=await page.evaluate(()=>window.__PET_QA_NORMAL_ATTACHMENT__(true)),diagnosticName=name.replace('.png','-normals.png'),normal=await page.locator('canvas').screenshot();await writeFile(resolve(out,diagnosticName),normal);
     const restored=await page.evaluate(()=>window.__PET_QA_NORMAL_ATTACHMENT__(false));if(JSON.stringify(state.boneMatrices)!==JSON.stringify(restored.boneMatrices))throw Error('Paired attachment changed production pose');
     const restoredData=await page.locator('canvas').evaluate(c=>({...c.dataset}));if(JSON.stringify(data)!==JSON.stringify(restoredData))throw Error('Paired attachment advanced production clock');
     diagnosticFrames.push({...f,name:diagnosticName,sha256:sha(normal),productionColorName:name,productionColorSha256:f.sha256,diagnostic:'surface-normals-after-original-production-vertex-shader',boneMatricesSha256:sha(Buffer.from(JSON.stringify(state.boneMatrices))),samePoseVerified:true,productionColorAssessment:'separate visual review required'});
    }
   }
   for(let g=0;g<2;g++){
    const cells=[];for(let k=0;k<6;k++)cells.push({input:await sharp(resolve(out,group[g*6+k].name)).png().toBuffer(),left:k%3*500,top:Math.floor(k/3)*280+20});
    const titles=Buffer.from(`<svg width="1500" height="560">${group.slice(g*6,g*6+6).map((f,k)=>`<text x="${k%3*500+4}" y="${Math.floor(k/3)*280+15}" fill="white" font-size="13">${move} ${view} ${f.time.toFixed(2)}s ${f.previewMotion}</text>`).join('')}</svg>`);
    const name=`${id}-${move}-${view}-sheet-${g}.webp`,bytes=await sharp({create:{width:1500,height:560,channels:3,background:'#111b26'}}).composite([...cells,{input:titles,left:0,top:0}]).webp({quality:97}).toBuffer();await writeFile(resolve(out,name),bytes);sheets.push({name,sha256:sha(bytes)});
   }
   console.log(`Captured ${id} ${move} ${view}`);
  }
 }
 if(errors.length)throw Error(errors.join('\n'));
 if(await petReviewRendererSha256(repo)!==rendererSha256)throw Error('Renderer changed during capture');
 if(await componentHash()!==companionComponentSha256)throw Error('Companion component changed during capture');
 const modelUrls=[...new Set(frames.map(f=>f.previewModel))],models=[];
 for(const url of modelUrls){const path=arg('asset')?resolve(arg('asset')):resolve(client,'public',`.${new URL(url,'https://local.invalid').pathname}`);models.push({url,sha256:sha(await readFile(path))});}
 await writeFile(resolve(out,'manifest.json'),JSON.stringify({id,label,rendererSha256,companionComponentSha256,captureHarnessSha256,models,moves,views,requests,errors,frames,sheets,review:'pending'},null,2)+'\n');
 if(diagnosticFrames.length)await writeFile(resolve(out,'normal-attachments.json'),JSON.stringify({id,label,rendererSha256,companionComponentSha256,captureHarnessSha256,models,moves,views,errors,frames:diagnosticFrames,limits:'Diagnostic surface normals reveal shape on the exact production animation pose. Original skinning, procedural vertex deformation and frame clock are retained. These are supplementary semantic attachments, not production colors.',review:'pending'},null,2)+'\n');
 console.log(JSON.stringify({id,moves:moves.length,frames:frames.length,sheets:sheets.length,out}));
}finally{await browser.close();}
