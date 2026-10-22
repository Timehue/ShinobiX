import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export const DOCK_SHIPMENT_PAINT_AREAS={
 spilled:[{left:640,top:340,width:150,height:85,feather:8}],
 delivered:[{left:300,top:682,width:25,height:24,feather:2},{left:320,top:695,width:28,height:27,feather:2}],
};
export const DOCK_SHIPMENT_BASE='shinobij.client/public/sector-life/north-docks-work-stop-v1.webp';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Edit only the reviewed source/box lids. Provider changes to the rest of a
 * full map or local crop never enter the composition, including roads/water. */
export async function composeDockShipmentPainting(base,provider,kind){
 const areas=DOCK_SHIPMENT_PAINT_AREAS[kind];if(!areas)throw Error('Unknown shipment painting.');
 const reference=await sharp(base).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(reference.info.width!==1024||reference.info.height!==1024)throw Error('Expected the admitted 1024px dock floor.');
 let candidate;
 if(kind==='spilled')candidate=await sharp(provider).resize(1024,1024).png().toBuffer();
 else{const crop=await sharp(provider).resize(130,130).png().toBuffer();candidate=await sharp(base).composite([{input:crop,left:250,top:650}]).png().toBuffer();}
 const patches=[];
 for(const box of areas){
  const rgb=await sharp(candidate).extract({left:box.left,top:box.top,width:box.width,height:box.height}).removeAlpha().raw().toBuffer(),alpha=Buffer.alloc(box.width*box.height);
  for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++)alpha[y*box.width+x]=Math.round(255*Math.min(1,Math.min(x,y,box.width-1-x,box.height-1-y)/box.feather));
  const input=await sharp(rgb,{raw:{width:box.width,height:box.height,channels:3}}).joinChannel(alpha,{raw:{width:box.width,height:box.height,channels:1}}).png().toBuffer();patches.push({input,left:box.left,top:box.top});
 }
 const composed=await sharp(base).composite(patches).png().toBuffer(),pixels=await sharp(composed).removeAlpha().raw().toBuffer();
 let changedOutside=0,changedInside=0;
 for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){
  const inside=areas.some(box=>x>=box.left&&x<box.left+box.width&&y>=box.top&&y<box.top+box.height);
  for(let c=0;c<3;c++)if(reference.data[(y*1024+x)*3+c]!==pixels[(y*1024+x)*3+c]){if(inside)changedInside++;else changedOutside++;}
 }
 if(changedOutside)throw Error('Unreviewed terrain pixels changed.');if(!changedInside)throw Error('No visible shipment dressing was produced.');
 return {composed,changedOutside,changedInside,areas};
}

async function main(){
 const inputs=process.argv.slice(2);if(inputs.length!==2)throw Error('Pass the spilled full-sector edit and delivered local crate-lid edit.');
 const base=await readFile(DOCK_SHIPMENT_BASE),records=[];
 await mkdir('output/living-world/shipment/painted',{recursive:true});await mkdir('shinobij.client/public/sector-life',{recursive:true});
 for(const [index,kind] of ['spilled','delivered'].entries()){
  const provider=await readFile(inputs[index]),{composed,...proof}=await composeDockShipmentPainting(base,provider,kind),slug=`north-docks-shipment-${kind}-v1`;
  const encoded=await sharp(composed).webp({quality:78,effort:6}).toBuffer();if(encoded.length>256*1024)throw Error('Shipment floor exceeds the 256 KiB per-variant budget.');
  const file=`shinobij.client/public/sector-life/${slug}.webp`;
  await writeFile(`output/living-world/shipment/painted/${slug}.png`,composed);await writeFile(file,encoded);
  records.push({kind,sector:2,file,base:DOCK_SHIPMENT_BASE,baseSha256:hash(base),provider:inputs[index],providerSha256:hash(provider),composedSha256:hash(composed),sha256:hash(encoded),bytes:encoded.length,...proof,method:'Exact base outside reviewed grass patch / existing wooden crate lids before WebP encoding. No new independent props, roads, furniture or NPC sprites.',visualReview:'pending-native-map'});
 }
 await writeFile('output/living-world/shipment/painting-review.json',JSON.stringify({provider:'built-in image_gen',records},null,2)+'\n');console.log(JSON.stringify(records.map(({kind,bytes,changedOutside,changedInside})=>({kind,bytes,changedOutside,changedInside}))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
