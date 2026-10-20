import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Publish only the two reviewed local details from the existing built-in
// imagegen drafts. Terrain outside each small area remains original RGB before
// delivery compression. Rerunning intentionally resets the native review gate.
const root='output/living-world/frontier',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const candidates=JSON.parse(await readFile(`${root}/protected-candidates-v1.json`,'utf8')),records=[];
for(const item of candidates.records){
    const baseFile=`shinobij.client/public/sector-map/${item.base}.webp`,sourceFile=`${root}/${item.name}-provider-v1.png`;
    const base=await readFile(baseFile),source=await readFile(sourceFile);
    if(hash(base)!==item.baseSha256||hash(source)!==item.sourceSha256)throw Error('Unreviewed frontier source or original terrain');
    const normalized=await sharp(source).resize(1024,1024).png().toBuffer(),area=item.area;
    const rgb=await sharp(normalized).extract(area).removeAlpha().raw().toBuffer(),alpha=Buffer.alloc(area.width*area.height);
    for(let y=0;y<area.height;y++)for(let x=0;x<area.width;x++)alpha[y*area.width+x]=Math.round(255*Math.min(1,Math.min(x,y,area.width-x-1,area.height-y-1)/8));
    const layer=await sharp(rgb,{raw:{width:area.width,height:area.height,channels:3}}).joinChannel(alpha,{raw:{width:area.width,height:area.height,channels:1}}).png().toBuffer();
    const image=await sharp(base).composite([{input:layer,left:area.left,top:area.top}]).png().toBuffer();
    const before=await sharp(base).removeAlpha().raw().toBuffer(),after=await sharp(image).removeAlpha().raw().toBuffer();let changedOutside=0;
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(x<area.left||y<area.top||x>=area.left+area.width||y>=area.top+area.height)for(let c=0;c<3;c++)if(before[(y*1024+x)*3+c]!==after[(y*1024+x)*3+c])changedOutside++;
    if(changedOutside)throw Error('Protected frontier terrain changed');
    const delivered=await sharp(image).webp({quality:82}).toBuffer();if(hash(delivered)!==item.sha256)throw Error('Rebaked floor differs from the reviewed protected candidate');
    const key=item.sector===55?'hollow-road-gear-v1':'lavafront-road-gear-v1',file=`shinobij.client/public/sector-life/${key}.webp`;
    await writeFile(file,delivered);records.push({...item,key,file,baseFile,sourceFile,width:1024,height:1024,changedOutside});
}
await writeFile('shared/frontier-work-art-review.json',JSON.stringify({status:'runtime candidates; native inspection required',visualReview:'pending-native-review',provider:'built-in image_gen',recipe:'scripts/bake-frontier-work-paintings.mjs',prompts:`${root}/art-and-prompts.json`,records},null,2)+'\n');
console.log(JSON.stringify(records.map(r=>({sector:r.sector,file:r.file,bytes:r.bytes,changedOutside:r.changedOutside}))));
