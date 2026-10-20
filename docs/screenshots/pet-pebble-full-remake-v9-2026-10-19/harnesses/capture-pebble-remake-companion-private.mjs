// A capture is pending until its retained sheets are actually inspected.
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {runtimePetModels} from '../scripts/lib/pet-runtime-audit.mjs';
import {petCloseupPresentationModel} from '../src/lib/pet-3d-models.ts';
import {petReviewRendererSha256} from '../scripts/check-pet-shape-review.mjs';

const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const ids=arg('model')?.split(','),selected=runtimePetModels.filter(r=>!ids||ids.includes(r.pet.id));
if(!selected.length||ids?.some(id=>!selected.some(r=>r.pet.id===id)))throw Error('Empty or incomplete pet selection');
const client=resolve(import.meta.dirname,'..'),repo=resolve(client,'..'),base=arg('base-url','http://127.0.0.1:5207');
const out=resolve(client,'.tmp/pet-independent-face-recheck/companion',arg('label','final'));await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const rendererSha256=await petReviewRendererSha256(repo),stagePath=resolve(client,'src/components/PetYardModelStage.tsx');
const companionComponentSha256=sha(Buffer.from((await readFile(stagePath,'utf8')).replaceAll('\r\n','\n')));
const lods=JSON.parse(await readFile(resolve(client,'public/pet-models/warfront-lod/manifest.json'))).entries;
const pets=[],errors=[],browser=await chromium.launch({headless:true});
try{for(const row of selected){
    const local=relative(resolve(client,'public/pet-models'),row.path),lodPath=resolve(client,'public/pet-models/warfront-lod',local);
    const privateSource=resolve(client,'.tmp/pebble-full-remake/pebble-remade-private.glb'),privateBattle=resolve(client,'.tmp/pebble-full-remake/delivery/public/pet-models/warfront-lod/starter-earth.glb');const sourceSha256=sha(await readFile(privateSource)),battleSha256=sha(await readFile(privateBattle));
    const page=await browser.newPage({viewport:{width:540,height:340},reducedMotion:'no-preference',ignoreHTTPSErrors:process.argv.includes('--ignore-https-errors')}),requests=[],petErrors=[];
    page.on('pageerror',e=>petErrors.push(e.message));page.on('request',r=>{if(r.url().includes('.glb'))requests.push(r.url());});
    try{
        await page.route('**/pet-models/**',async route=>{const u=new URL(route.request().url());if(!u.pathname.endsWith('/starter-earth.glb'))return route.continue();await route.fulfill({contentType:'model/gltf-binary',body:await readFile(u.pathname.includes('/warfront-lod/')?privateBattle:privateSource)});});
        await page.goto(`${base}/petyardmodelaudit.html?pet=${encodeURIComponent(row.pet.id)}`,{waitUntil:'domcontentloaded',timeout:120000});
        if(!petCloseupPresentationModel(row.pet)){
            await page.locator(`[data-companion-artwork-fallback="${row.pet.id}"]`).waitFor();
            assert.equal(await page.locator('canvas').count(),0);
            pets.push({id:row.pet.id,sourceSha256,battleSha256,mode:'production-portrait-fallback',frames:[],errors:petErrors,review:'policy-verified; source/battle animation review still required'});
        }else{
            const entry=lods.find(e=>new URL(e.sourceUrl,'https://local.invalid').pathname===new URL(row.model.url,'https://local.invalid').pathname);
            assert.ok(entry,`${row.pet.id}: no certified battle entry`);
            await page.waitForFunction(()=>Number(document.querySelector('canvas')?.dataset.previewTriangles)>0,{},{timeout:120000});
            const directory=resolve(out,row.pet.id);await mkdir(directory,{recursive:true});
            const frames=[];
            for(let i=0;i<24;i++){
                await page.waitForTimeout(220);const data=await page.locator('canvas').evaluate(c=>({...c.dataset}));
                assert.equal(new URL(data.previewModel,base).href,new URL(entry.lodUrl,base).href,'Companion must select the exact certified battle revision');
                assert.ok(Number.isFinite(Number(data.previewTime))&&(!i||Number(data.previewTime)>Number(frames[i-1].previewTime)),'Companion idle clock stopped or reset');
                const buffer=await page.locator('canvas').screenshot();await writeFile(resolve(directory,`idle-${i}.png`),buffer);frames.push({...data,buffer});
            }
            const sheets=[];
            for(let group=0;group<6;group++){
                const cells=frames.slice(group*4,group*4+4).map((f,i)=>({input:f.buffer,left:i%2*500,top:Math.floor(i/2)*280+20}));
                const title=Buffer.from(`<svg width="1000" height="560">${frames.slice(group*4,group*4+4).map((f,i)=>`<text x="${i%2*500+4}" y="${Math.floor(i/2)*280+15}" fill="white" font-size="13">${row.pet.id} | companion idle | t=${Number(f.previewTime).toFixed(3)}</text>`).join('')}</svg>`);
                const name=`idle-sheet-${group}.webp`,bytes=await sharp({create:{width:1000,height:560,channels:3,background:'#111b26'}}).composite([...cells,{input:title,left:0,top:0}]).webp({quality:95}).toBuffer();await writeFile(resolve(directory,name),bytes);sheets.push({name:`${row.pet.id}/${name}`,sha256:sha(bytes)});
            }
            assert.equal(sha(await readFile(privateSource)),sourceSha256);assert.equal(sha(await readFile(privateBattle)),battleSha256);
            pets.push({id:row.pet.id,name:row.pet.name,mode:'exact-production-companion-component',sourceSha256,battleSha256,requests,frames:frames.map(({buffer,...f})=>f),sheets,errors:petErrors,review:'pending'});
        }
        errors.push(...petErrors.map(error=>`${row.pet.id}: ${error}`));
        await writeFile(resolve(out,'manifest.json'),JSON.stringify({schema:1,rendererSha256,companionComponentSha256,appearance:'original',collarId:'',quality:'low',errors,pets,artisticCertification:false},null,2)+'\n');
        console.log(`Companion captured ${pets.length}/${selected.length}: ${row.pet.id}`);
    }finally{await page.close();}
}
assert.equal(await petReviewRendererSha256(repo),rendererSha256);
assert.equal(sha(Buffer.from((await readFile(stagePath,'utf8')).replaceAll('\r\n','\n'))),companionComponentSha256);
if(errors.length)process.exitCode=1;
}finally{await browser.close();}
