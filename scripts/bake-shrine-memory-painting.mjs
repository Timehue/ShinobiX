import sharp from 'sharp';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const [litPath,dormantPath,radiantPath]=process.argv.slice(2);
if(!litPath||!dormantPath)throw new Error('Pass the lit and unlit full-sector edits.');
const output=resolve('output/living-world/painted'),runtime=resolve('shinobij.client/public/sector-life');
await mkdir(resolve(output,'sources'),{recursive:true});await mkdir(runtime,{recursive:true});
const base=await readFile(resolve(runtime,'heartwood-rest-stop-v1.webp'));
const lit=await readFile(litPath),dormant=await readFile(dormantPath);
await writeFile(resolve(output,'sources/heartwood-shrine-lit-provider.png'),lit);
await writeFile(resolve(output,'sources/heartwood-shrine-unlit-provider.png'),dormant);
const box={left:165,top:748,width:200,height:105};
const original=await sharp(base).removeAlpha().raw().toBuffer();
const sha=b=>createHash('sha256').update(b).digest('hex');
async function admitted(source,under=base,area=box) {
    const pixels=await sharp(source).resize(1024,1024,{fit:'fill'}).extract(area).removeAlpha().raw().toBuffer();
    const alpha=Buffer.alloc(area.width*area.height);
    for(let y=0;y<area.height;y++)for(let x=0;x<area.width;x++) {
        const px=x+area.left,py=y+area.top;
        // The existing roof and its ornament stay exact, even inside the crop.
        const protectedRoof=px>=160&&px<350&&py<760;
        alpha[y*area.width+x]=protectedRoof?0:Math.round(255*Math.min(1,Math.min(x,y,area.width-1-x,area.height-1-y)/12));
    }
    const patch=await sharp(pixels,{raw:{width:area.width,height:area.height,channels:3}}).joinChannel(alpha,{raw:{width:area.width,height:area.height,channels:1}}).png().toBuffer();
    return sharp(under).composite([{input:patch,left:area.left,top:area.top}]).png().toBuffer();
}
const unlit=await admitted(dormant),both=await admitted(lit);
const left=await admitted(lit,unlit,{left:172,top:748,width:90,height:100});
const variants=[['heartwood-dormant-shrine-v1',unlit,box],['heartwood-left-lamp-v1',left,box],['heartwood-supported-shrine-v1',both,box]];
let radiant;
if(radiantPath) {
    radiant=await readFile(radiantPath);await writeFile(resolve(output,'sources/heartwood-shrine-radiant-provider.png'),radiant);
    const first=await admitted(radiant,both,{left:186,top:811,width:72,height:80});
    const painting=await admitted(radiant,first,{left:300,top:807,width:75,height:84});
    variants.push(['heartwood-radiant-shrine-v1',painting,{left:165,top:748,width:215,height:145}]);
}
for(const [slug,painting,allowed] of variants) {
    const pixels=await sharp(painting).removeAlpha().raw().toBuffer();let changedOutside=0;
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++) {
        const protectedPixel=x<allowed.left||x>=allowed.left+allowed.width||y<allowed.top||y>=allowed.top+allowed.height||x>=160&&x<350&&y<760;
        if(protectedPixel)for(let c=0;c<3;c++)if(pixels[(y*1024+x)*3+c]!==original[(y*1024+x)*3+c])changedOutside++;
    }
    if(changedOutside)throw new Error(`${slug}: pixels changed outside the reviewed shrine-front area.`);
    const delivered=await sharp(painting).webp({quality:82}).toBuffer();
    await writeFile(resolve(output,`${slug}.png`),painting);await writeFile(resolve(runtime,`${slug}.webp`),delivered);
    const receipt={sector:15,artKey:42,provider:'built-in image_gen',method:'Full-sector paint edits admitted into the actual shrine-front area, with exact roof and terrain protection before WebP delivery.',box:allowed,changedOutside,baseSha256:sha(base),litSourceSha256:sha(lit),unlitSourceSha256:sha(dormant),...(slug.includes('radiant')?{radiantSourceSha256:sha(radiant)}:{}),deliveredSha256:sha(delivered),bytes:delivered.length,prompts:'output/living-world/shrine-image-prompts.json',visualReview:'pending-in-game'};
    await writeFile(resolve(runtime,`${slug}.json`),JSON.stringify(receipt,null,2)+'\n');
    await writeFile(resolve(output,`${slug}.json`),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify({slug,bytes:delivered.length,changedOutside}));
}
