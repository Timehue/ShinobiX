import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Normalize the full-sector image_gen edit through the same protected admission
// used for other painted workplaces. No independent prop enters the renderer.
const source='output/living-world/painted/sources/shrinefall-supply-windbreak-v3-provider.png';
const root='output/living-world/painted/winter-supply',runtime='shinobij.client/public/sector-life';
const areas=[{left:434,top:718,width:44,height:92},{left:472,top:735,width:110,height:105}];
// Retain the original brazier, including its feet. Only the new screen, sled,
// and replacement snow at the old loose blanket/parcel positions are admitted.
const protectedAreas=[{left:479,top:717,width:36,height:43}];
const inside=(x,y,r)=>x>=r.left&&y>=r.top&&x<r.left+r.width&&y<r.top+r.height;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const provider=await readFile(source),normalized=await sharp(provider).resize(1024,1024,{fit:'fill'}).removeAlpha().raw().toBuffer();
const layers=await Promise.all(areas.map(async area=>{
 const pixels=await sharp(normalized,{raw:{width:1024,height:1024,channels:3}}).extract(area).raw().toBuffer(),alpha=Buffer.alloc(area.width*area.height);
 for(let y=0;y<area.height;y++)for(let x=0;x<area.width;x++){
  const px=area.left+x,py=area.top+y;
  const protection=Math.min(...protectedAreas.map(r=>Math.min(1,Math.hypot(Math.max(r.left-px,0,px-(r.left+r.width-1)),Math.max(r.top-py,0,py-(r.top+r.height-1)))/6)));
  alpha[y*area.width+x]=Math.round(255*protection*Math.min(1,Math.min(x,y,area.width-1-x,area.height-1-y)/6));
 }
 return {input:await sharp(pixels,{raw:{width:area.width,height:area.height,channels:3}}).joinChannel(alpha,{raw:{width:area.width,height:area.height,channels:1}}).png().toBuffer(),left:area.left,top:area.top};
}));
await mkdir(root,{recursive:true});
const recipes=[['shrinefall-warming-stop-v1','shrinefall-supply-stop-v2'],...['dormant','supported','radiant'].map(state=>[`frostveil-${state}-shrine-v1`,`frostveil-${state}-shrine-supply-v2`])];
const paintings=[];
for(const [baseKey,key] of recipes){
 const baseFile=`${runtime}/${baseKey}.webp`,base=await readFile(baseFile),original=await sharp(base).removeAlpha().raw().toBuffer();
 const png=await sharp(base).composite(layers).png().toBuffer(),pixels=await sharp(png).removeAlpha().raw().toBuffer();
 let changedOutside=0;
 for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(!areas.some(r=>inside(x,y,r))||protectedAreas.some(r=>inside(x,y,r)))for(let c=0;c<3;c++)if(original[(y*1024+x)*3+c]!==pixels[(y*1024+x)*3+c])changedOutside++;
 if(changedOutside)throw Error(`${key}: ${changedOutside} channel changes outside admitted ground or on original brazier`);
 const delivered=await sharp(png).webp({quality:82}).toBuffer();
 const receipt={sector:31,artKey:53,key,baseFile,baseSha256:sha(base),source,sourceSha256:sha(provider),provider:'built-in image_gen',prompts:'output/living-world/winter-supply-v3-prompt.json',method:'Full-sector edited source admitted only at the winter screen/sled areas; original brazier, tree, roads, buildings, shrine lamps, ore and all other terrain remain exact before delivery compression.',areas,protected:protectedAreas,protectedFeather:6,changedOutside,deliveredSha256:sha(delivered),bytes:delivered.length,width:1024,height:1024,visualReview:'pending-in-game'};
 await writeFile(`${root}/${key}.png`,png);await writeFile(`${runtime}/${key}.webp`,delivered);await writeFile(`${runtime}/${key}.json`,JSON.stringify(receipt,null,2)+'\n');
 paintings.push(receipt);console.log(JSON.stringify({key,bytes:delivered.length,changedOutside}));
}
await writeFile('shared/winter-supply-art-review.json',JSON.stringify({version:1,sector:31,artKey:53,source,sourceSha256:sha(provider),areas,protected:protectedAreas,resourceReview:'Only resource-56 is in this sector, at the northern natural rime seam (target6, approach18). Every rock/water pixel and all shrine light states are outside the admitted snow areas.',paintings},null,2)+'\n');
