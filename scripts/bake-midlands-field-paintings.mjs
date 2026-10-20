import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const source='output/living-world/field-work/garden-provider-v1.png';
const runtime='shinobij.client/public/sector-life',root='output/living-world/field-work/painted';
const area={left:600,top:700,width:350,height:250},sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const provider=await readFile(source),normalized=await sharp(provider).resize(1024,1024).removeAlpha().raw().toBuffer();
const patch=await sharp(normalized,{raw:{width:1024,height:1024,channels:3}}).extract(area).raw().toBuffer(),alpha=Buffer.alloc(area.width*area.height);
for(let y=0;y<area.height;y++)for(let x=0;x<area.width;x++)alpha[y*area.width+x]=Math.round(255*Math.min(1,Math.min(x,y,area.width-1-x,area.height-1-y)/8));
const layer={input:await sharp(patch,{raw:{width:area.width,height:area.height,channels:3}}).joinChannel(alpha,{raw:{width:area.width,height:area.height,channels:1}}).png().toBuffer(),left:area.left,top:area.top};
await mkdir(root,{recursive:true});
const paintings=[];
for(const [baseKey,key]of[['midlands-tea-stop-v1','midlands-herb-tea-stop-v2'],['midlands-chronicle-table-v1','midlands-herb-chronicle-table-v2']]){
    const baseFile=`${runtime}/${baseKey}.webp`,base=await readFile(baseFile),original=await sharp(base).removeAlpha().raw().toBuffer();
    const png=await sharp(base).composite([layer]).png().toBuffer(),pixels=await sharp(png).removeAlpha().raw().toBuffer();let changedOutside=0;
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(x<area.left||y<area.top||x>=area.left+area.width||y>=area.top+area.height)for(let c=0;c<3;c++)if(original[(y*1024+x)*3+c]!==pixels[(y*1024+x)*3+c])changedOutside++;
    if(changedOutside)throw Error(`${key}: protected terrain changed`);
    const delivered=await sharp(png).webp({quality:82}).toBuffer();
    const receipt={sector:42,artKey:30,key,baseFile,baseSha256:sha(base),source,sourceSha256:sha(provider),provider:'built-in image_gen',prompts:'output/living-world/field-work/garden-prompt-v1.json',areas:[area],feather:8,width:1024,height:1024,changedOutside,deliveredSha256:sha(delivered),bytes:delivered.length,method:'Full-sector garden edit admitted only in the reviewed lower-right grass. Original tea/cards/mats/barrel, all roads, all rocks and the northern ore seam remain exact before delivery compression.',visualReview:'pending-native-review'};
    await writeFile(`${root}/${key}.png`,png);await writeFile(`${runtime}/${key}.webp`,delivered);await writeFile(`${runtime}/${key}.json`,JSON.stringify(receipt,null,2)+'\n');paintings.push(receipt);console.log(JSON.stringify({key,bytes:delivered.length,changedOutside}));
}
const toolSource='output/living-world/field-work/hoe-provider-v1.png',toolFile=`${runtime}/field-hoe-v1.webp`;
const tool=await sharp(toolSource).trim({threshold:8}).resize({height:96,width:32,fit:'inside'}).webp({quality:90,alphaQuality:100}).toBuffer();
await writeFile(toolFile,tool);const metadata=await sharp(tool).metadata();
await writeFile('shared/midlands-field-art-review.json',JSON.stringify({version:1,sector:42,artKey:30,source,sourceSha256:sha(provider),areas:[area],workTiles:[127,115],resourceReview:'Only resource-68 is in this sector, approach68/target80 at the northern natural rock seam. All rock/water and road pixels lie outside this admitted ground.',paintings,tool:{file:toolFile,source:toolSource,sourceSha256:sha(await readFile(toolSource)),sha256:sha(tool),bytes:tool.length,width:metadata.width,height:metadata.height,hasAlpha:metadata.hasAlpha,prompts:'output/living-world/field-work/hoe-prompt-v1.json'},visualReview:'pending-native-review'},null,2)+'\n');
