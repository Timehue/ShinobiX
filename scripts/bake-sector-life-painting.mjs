import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// The provider paints IN the full map. This admission step protects every pixel
// beyond the authored dressing area, including all roads, mouths and buildings.
const source=process.argv[2];
if(!source)throw new Error('Pass the full-sector painted edit.');
const sector=Number(process.argv[3]??15);
const recipes={
    15:{artKey:42,slug:'heartwood-rest-stop-v1',box:{left:700,top:620,width:155,height:175},prompt:'Paint one tiny weathered tea/rest spot east of the existing southern shrine courtyard.'},
    2:{artKey:21,slug:'north-docks-work-stop-v1',box:{left:265,top:665,width:105,height:100},prompt:'Paint tiny dockworker crates, rope and a folded net on the grass below-left of the dock building, above the waterline and left of the paving.'},
    31:{artKey:53,slug:'shrinefall-warming-stop-v1',box:{left:460,top:700,width:125,height:140},prompt:'Paint a tiny coal brazier, rolled grey wool blankets and a parcel in the open snow between the lower shrine approaches.'},
    42:{artKey:30,slug:'midlands-tea-stop-v1',box:{left:180,top:680,width:238,height:185},prompt:'Paint a modest tea table, kettle, cups, rolled sitting mats and basket in the grass left of the lower road and below the rock ledge.'},
};
const recipe=recipes[sector];if(!recipe)throw new Error('No reviewed composition recipe for this sector.');
const base=await readFile(`shinobij.client/public/sector-map/s${recipe.artKey}.webp`);
const painted=await readFile(source);
const box=recipe.box;
const normalized=await sharp(painted).resize(1024,1024,{fit:'fill'}).png().toBuffer();
const crop=await sharp(normalized).extract(box).removeAlpha().raw().toBuffer();
const alpha=Buffer.alloc(box.width*box.height);
for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++)alpha[y*box.width+x]=Math.round(255*Math.min(1,Math.min(x,y,box.width-1-x,box.height-1-y)/18));
const patch=await sharp(crop,{raw:{width:box.width,height:box.height,channels:3}}).joinChannel(alpha,{raw:{width:box.width,height:box.height,channels:1}}).png().toBuffer();
const composed=await sharp(base).composite([{input:patch,left:box.left,top:box.top}]).png().toBuffer();
const originalPixels=await sharp(base).raw().toBuffer(), finalPixels=await sharp(composed).removeAlpha().raw().toBuffer();
let changedOutside=0;
for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(x<box.left||x>=box.left+box.width||y<box.top||y>=box.top+box.height)for(let c=0;c<3;c++)if(originalPixels[(y*1024+x)*3+c]!==finalPixels[(y*1024+x)*3+c])changedOutside++;
if(changedOutside)throw new Error(`${changedOutside} channel values changed outside the admitted area.`);
const out=resolve('output/living-world/painted');await mkdir(out,{recursive:true});
await mkdir(resolve(out,'sources'),{recursive:true});
await writeFile(resolve(out,'sources',`${recipe.slug}-provider.png`),painted);
await writeFile(resolve(out,`${recipe.slug}.png`),composed);
const delivered=await sharp(composed).webp({quality:78}).toBuffer();
const runtime=resolve('shinobij.client/public/sector-life');await mkdir(runtime,{recursive:true});
await writeFile(resolve(runtime,`${recipe.slug}.webp`),delivered);
const hash=b=>createHash('sha256').update(b).digest('hex');
const receipt={sector,artKey:recipe.artKey,provider:'built-in image_gen',
    method:'Full-sector painted edit; exact-base composition outside the authored area. No independent prop sprites.',
    source:`output/living-world/painted/sources/${recipe.slug}-provider.png`,sourceSha256:hash(painted),baseSha256:hash(base),deliveredSha256:hash(delivered),box,changedOutside,
    bytes:delivered.length,visualReview:'pending-in-game',
    prompt:`${recipe.prompt} Match the original overhead camera, lighting, materials and ground contact. Preserve all roads, entrances, buildings and frame. No people or UI.`};
await writeFile(resolve(out,`${recipe.slug}.json`),JSON.stringify(receipt,null,2)+'\n');
await writeFile(resolve(runtime,`${recipe.slug}.json`),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({sector,bytes:delivered.length,changedOutside,file:resolve(out,`${recipe.slug}.png`)}));
