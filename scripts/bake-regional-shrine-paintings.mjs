import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Each source is a full-sector image_gen edit. Only these four local lamp
// areas are admitted. Existing roofs, landmarks and the rest of the floor stay
// pixel-exact before delivery compression; no prop sprite enters the renderer.
const root='output/living-world/painted/regional-shrines',runtime='shinobij.client/public/sector-life';
const rect=(left,top,width,height)=>({left,top,width,height});
const recipes=[
 {id:'tide',sector:4,artKey:34,base:'shinobij.client/public/sector-map/s34.webp',lamps:[[702,434],[835,434],[702,492],[835,492]],protected:[rect(688,260,166,156)]},
 {id:'frostveil',sector:31,artKey:53,base:`${runtime}/shrinefall-warming-stop-v1.webp`,lamps:[[195,778],[315,778],[195,867],[315,867]],protected:[rect(174,604,166,158)]},
 {id:'moonwell',sector:23,artKey:16,base:'shinobij.client/public/sector-map/s16.webp',lamps:[[208,778],[314,778],[208,837],[314,837]],protected:[rect(174,604,166,146),rect(223,748,66,13)]},
 {id:'hollowgate',sector:56,artKey:13,base:'shinobij.client/public/sector-map/s13.webp',lamps:[[193,254],[323,254],[156,174],[360,174]],protected:[rect(174,92,166,146),rect(223,236,65,11),rect(173,232,12,9),rect(330,232,10,9)]},
 {id:'ancients',sector:44,artKey:10,base:'shinobij.client/public/sector-map/s10.webp',lamps:[[596,846],[760,846],[596,922],[760,922]],protected:[rect(601,689,168,146),rect(650,834,62,20)]},
];
const inside=(x,y,r)=>x>=r.left&&y>=r.top&&x<r.left+r.width&&y<r.top+r.height;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(root,{recursive:true});await mkdir(runtime,{recursive:true});
const manifest=[];
for(const recipe of recipes){
 const base=await readFile(recipe.base),original=await sharp(base).removeAlpha().raw().toBuffer();
 const sources=await Promise.all(['unlit','lit'].map(async state=>({state,bytes:await readFile(`${root}/${recipe.id}-${state}-provider.png`)})));
 const areas=recipe.lamps.map(([x,y])=>rect(x-27,y-27,54,54));
 async function painted(under,source,indexes){
  const normalized=await sharp(source).resize(1024,1024,{fit:'fill'}).removeAlpha().raw().toBuffer();
  const layers=await Promise.all(indexes.map(async index=>{
   const area=areas[index],pixels=await sharp(normalized,{raw:{width:1024,height:1024,channels:3}}).extract(area).raw().toBuffer(),alpha=Buffer.alloc(area.width*area.height);
   for(let y=0;y<area.height;y++)for(let x=0;x<area.width;x++)alpha[y*area.width+x]=recipe.protected.some(r=>inside(area.left+x,area.top+y,r))?0:Math.round(255*Math.min(1,Math.min(x,y,area.width-1-x,area.height-1-y)/8));
   return {input:await sharp(pixels,{raw:{width:area.width,height:area.height,channels:3}}).joinChannel(alpha,{raw:{width:area.width,height:area.height,channels:1}}).png().toBuffer(),left:area.left,top:area.top};
  }));return sharp(under).composite(layers).png().toBuffer();
 }
 const dormant=await painted(base,sources[0].bytes,[0,1,2,3]);
 const supported=await painted(dormant,sources[1].bytes,[0,1]);
 const radiant=await painted(dormant,sources[1].bytes,[0,1,2,3]);
 const states=[];
 for(const [state,painting] of [['dormant',dormant],['supported',supported],['radiant',radiant]]){
  const pixels=await sharp(painting).removeAlpha().raw().toBuffer();let changedOutside=0;
  for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(!areas.some(r=>inside(x,y,r))||recipe.protected.some(r=>inside(x,y,r)))for(let c=0;c<3;c++)if(original[(y*1024+x)*3+c]!==pixels[(y*1024+x)*3+c])changedOutside++;
  if(changedOutside)throw Error(`${recipe.id}/${state}: ${changedOutside} channel changes outside lamp areas or on protected architecture.`);
  const key=`${recipe.id}-${state}-shrine-v1`,delivered=await sharp(painting).webp({quality:82}).toBuffer();
  const receipt={sector:recipe.sector,artKey:recipe.artKey,key,provider:'built-in image_gen',method:'Full-sector generated edits admitted only at the four authored shrine lamp areas; protected original architecture and all other terrain remain exact before compression.',areas,protected:recipe.protected,changedOutside,baseSha256:sha(base),sourceHashes:Object.fromEntries(sources.map(s=>[s.state,sha(s.bytes)])),deliveredSha256:sha(delivered),bytes:delivered.length,prompts:'output/living-world/regional-shrine-image-prompts.json',visualReview:'pending-in-game'};
  await writeFile(`${root}/${key}.png`,painting);await writeFile(`${runtime}/${key}.webp`,delivered);await writeFile(`${runtime}/${key}.json`,JSON.stringify(receipt,null,2)+'\n');await writeFile(`${root}/${key}.json`,JSON.stringify(receipt,null,2)+'\n');states.push(receipt);
 }
 manifest.push({...recipe,areas,states});console.log(JSON.stringify({sector:recipe.sector,id:recipe.id,states:states.map(s=>({key:s.key,bytes:s.bytes,changedOutside:s.changedOutside}))}));
}
await writeFile(`${root}/bake-manifest.json`,JSON.stringify(manifest,null,2)+'\n');
