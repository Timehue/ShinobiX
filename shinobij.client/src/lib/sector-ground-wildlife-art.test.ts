import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import review from '../../../shared/sector-ground-wildlife-review.json';
import {GROUND_HABITATS,GROUND_WILDLIFE_LIMITS} from './sector-ground-wildlife';
import {GROUND_WILDLIFE_ART_ROWS,GROUND_WILDLIFE_ATLAS_URL} from './sector-ground-wildlife-render';
import {isNightOnlyWildPet} from '../../../shared/night-pets';
const root=new URL('../../../',import.meta.url),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

test('wildlife admission binds six reviewed habitats to actual unmodified painted surfaces',()=>{
 assert.deepEqual(review.sites.map(site=>site.habitat),GROUND_HABITATS,'moving a sighting requires another floor review');
 for(const site of review.sites){
  assert.equal(site.habitat.night,isNightOnlyWildPet(site.habitat.pet),'the owl follows the established pet night gate');
  for(const surface of site.surfaces)assert.equal(sha(readFileSync(new URL(surface.file,root))),surface.sha256,`${site.habitat.species}: re-review changed floor pixels`);
 }
 assert.deepEqual(review.atlas.rows,Object.entries(GROUND_WILDLIFE_ART_ROWS).map(([id,art])=>({id,...art})));
});

test('the shipped atlas stays within compressed and decoded budgets and all 48 frames have real alpha',async()=>{
 const bytes=readFileSync(new URL(review.atlas.file,root));
 assert.equal(bytes.length,review.atlas.compressedBytes);assert.ok(bytes.length<=GROUND_WILDLIFE_LIMITS.maxCompressedBytes);
 assert.equal(sha(bytes),review.atlas.sha256);assert.ok(GROUND_WILDLIFE_ATLAS_URL.endsWith(`?v=${review.atlas.sha256.slice(0,12)}`));
 const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,512);assert.equal(info.height,384);assert.equal(info.width*info.height*4,786432);
 assert.ok(data.length<=GROUND_WILDLIFE_LIMITS.maxDecodedBytes);
 for(const row of review.atlas.rows){
  const poses=new Set<string>();
  for(let frame=0;frame<8;frame++){
   const pixels=Buffer.alloc(64*64*4);let clear=0,content=0,left=64,top=64,right=-1,bottom=-1;
   for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const source=((row.row*64+y)*512+frame*64+x)*4,target=(y*64+x)*4;data.copy(pixels,target,source,source+4);
    const alpha=data[source+3];if(alpha===0)clear++;if(alpha>8){content++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   }
   assert.ok(clear>64*64*.15,`${row.id} frame ${frame}: no scenic background`);assert.ok(content>100,`${row.id} frame ${frame}: complete visible pose`);
   if(frame===0)assert.equal(Math.max(right-left+1,bottom-top+1),row.idleExtent,`${row.id}: idle scale matches its reviewed map size`);
   poses.add(sha(pixels));
  }
  assert.ok(poses.size>=3,`${row.id}: animation has distinct idle and movement poses`);
 }
});
