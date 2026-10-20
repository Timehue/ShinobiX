import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root='output/living-world/painted/regional-shrines',runtime='shinobij.client/public/sector-life';
const inside=(x,y,r)=>x>=r.left&&y>=r.top&&x<r.left+r.width&&y<r.top+r.height;
const hash=b=>createHash('sha256').update(b).digest('hex');
async function verify(){
 const manifest=JSON.parse(await readFile(`${root}/bake-manifest.json`,'utf8'));assert.deepEqual(manifest.map(r=>r.sector),[4,31,23,56,44]);
 for(const recipe of manifest){
  const base=await readFile(recipe.base),original=await sharp(base).removeAlpha().raw().toBuffer();
  const images={};for(const state of recipe.states){const delivered=await readFile(`${runtime}/${state.key}.webp`);assert.equal(hash(delivered),state.deliveredSha256);assert.equal(hash(base),state.baseSha256);
   const png=await readFile(`${root}/${state.key}.png`),pixels=await sharp(png).removeAlpha().raw().toBuffer();assert.equal(pixels.length,1024*1024*3);images[state.key]=pixels;
   let changedOutside=0;for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(!recipe.areas.some(r=>inside(x,y,r))||recipe.protected.some(r=>inside(x,y,r)))for(let c=0;c<3;c++)if(pixels[(y*1024+x)*3+c]!==original[(y*1024+x)*3+c])changedOutside++;
   assert.equal(changedOutside,0,`${state.key}: changed original ground or architecture outside the lamp areas`);
  }
  // Use explicit keys rather than a filename token to keep ids extensible.
  const [dormant,supported,radiant]=['dormant','supported','radiant'].map(state=>images[`${recipe.id}-${state}-shrine-v1`]);
  for(const [index,area] of recipe.areas.entries()){
   let bodies=0,two=0,four=0,warm=0;for(let y=area.top;y<area.top+area.height;y++)for(let x=area.left;x<area.left+area.width;x++){
    const p=(y*1024+x)*3;if([0,1,2].some(c=>dormant[p+c]!==original[p+c]))bodies++;
    if([0,1,2].some(c=>supported[p+c]!==dormant[p+c]))two++;
    if([0,1,2].some(c=>radiant[p+c]!==dormant[p+c]))four++;
    if(radiant[p]>dormant[p]+25&&radiant[p]>radiant[p+2]+50)warm++;
   }
   assert(bodies>20,`${recipe.id}/${index}: missing permanent lamp body`);assert(four>20&&warm>4,`${recipe.id}/${index}: missing painted light`);
   if(index<2)assert(two>20,`${recipe.id}: front lamps must light at first support`);else assert.equal(two,0,`${recipe.id}: outer lamps must remain unlit at first support`);
  }
 }
}
await verify();
console.log('PASS: fifteen paintings preserve protected base pixels and contain the authored two/four-light states.');
