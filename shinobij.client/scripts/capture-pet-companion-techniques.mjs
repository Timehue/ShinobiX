// Capture only: inspection and approval must be recorded separately.
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {tacticsSpecies} from '../../shared/pet-tactics-roster.ts';
import {petReviewRendererSha256} from './check-pet-shape-review.mjs';
const arg=(k,d)=>process.argv.find(a=>a.startsWith(`--${k}=`))?.slice(k.length+3)??d;
const id=arg('model','mythic-4'),label=arg('label',id+'-techniques'),row=runtimePetModels.find(r=>r.pet.id===id),species=tacticsSpecies(id);
if(!row||!species)throw Error('Unknown companion identity');
const moves=arg('moves')?.split(',')??[...species.pool,species.signature.id];
const views=arg('views','front,side').split(','),angles={front:0,side:2,opposite:6,quarter:1};
const client=resolve(import.meta.dirname,'..'),repo=resolve(client,'..'),out=resolve(client,'.tmp/pet-companion-techniques',label);await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),rendererSha256=await petReviewRendererSha256(repo);
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:540,height:340},ignoreHTTPSErrors:process.argv.includes('--ignore-https-errors'),reducedMotion:'no-preference'});
const errors=[],requests=[],frames=[],sheets=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('.glb'))requests.push(r.url());});
try{
 if(arg('asset')){const body=await readFile(resolve(arg('asset'))),pathname=new URL(row.model.url,'https://local.invalid').pathname.replace('/pet-models/','/pet-models/warfront-lod/');await page.route(`**${pathname}*`,route=>route.fulfill({contentType:'model/gltf-binary',body}));}
 await page.clock.install();await page.goto(`${arg('base-url','http://127.0.0.1:5207')}/petyardmodelaudit.html?pet=${encodeURIComponent(id)}`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>Number(document.querySelector('canvas')?.dataset.previewTriangles)>0,{},{timeout:120000});
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
 let angle=0;
 // Twelve captures cover the full sequence; each interval advances the actual
 // production frame loop, including intermediate poses and the return to idle.
 const times=[.04,.12,.24,.36,.48,.60,.76,.96,1.20,1.44,1.68,1.92];
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
    await writeFile(resolve(out,name),buffer);const f={move,view,i,time,...data,name,sha256:sha(buffer)};group.push(f);frames.push(f);
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
 const modelUrls=[...new Set(frames.map(f=>f.previewModel))],models=[];
 for(const url of modelUrls){const path=arg('asset')?resolve(arg('asset')):resolve(client,'public',`.${new URL(url,'https://local.invalid').pathname}`);models.push({url,sha256:sha(await readFile(path))});}
 await writeFile(resolve(out,'manifest.json'),JSON.stringify({id,label,rendererSha256,models,moves,views,requests,errors,frames,sheets,review:'pending'},null,2)+'\n');
 console.log(JSON.stringify({id,moves:moves.length,frames:frames.length,sheets:sheets.length,out}));
}finally{await browser.close();}
