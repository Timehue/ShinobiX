import sharp from 'sharp';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Provider source and edit prompt are retained in output/living-world/leaf-work.
// Only alpha trimming, uniform fit and delivery encoding happen here.
const source='output/living-world/leaf-work/broom-provider-v2.png';
const file='shinobij.client/public/sector-life/shrine-broom-v2.webp';
await sharp(source).trim({threshold:8}).resize({height:96,width:32,fit:'inside'})
    .webp({quality:90,alphaQuality:100}).toFile(file);
const seal=path=>({file:path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
const metadata=await sharp(file).metadata();
const {data}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
let opaqueRed=0,transparent=0;
for(let i=0;i<data.length;i+=4){
    if(data[i+3]===0)transparent++;
    if(data[i+3]>=128&&data[i]>170&&data[i+1]<70&&data[i+2]<70)opaqueRed++;
}
if(opaqueRed||!metadata.hasAlpha||!transparent)throw Error('Transparent tool edge review failed.');
const review={version:1,sector:15,post:111,sections:[112,100],newActors:0,newRafLoops:0,
    tool:{...seal(file),bytes:statSync(file).size,width:metadata.width,height:metadata.height,hasAlpha:metadata.hasAlpha,opaqueRed,transparentPixels:transparent},
    source:seal(source),prompts:['output/living-world/leaf-work/broom-prompt-v1.json','output/living-world/leaf-work/broom-edge-prompt-v2.json'],
    mode:'Built-in image_gen generation with terrain as reference, then built-in transparent edge cleanup edit. Deterministic alpha trim/fit normalization only.',
    floors:['heartwood-rest-stop-v1','heartwood-dormant-shrine-v1','heartwood-left-lamp-v1','heartwood-supported-shrine-v1','heartwood-radiant-shrine-v1'].map(key=>seal(`shinobij.client/public/sector-life/${key}.webp`)),
    floorChanges:0,visualReview:'pending actual native desktop/phone review',
};
writeFileSync('shared/shrine-work-review.json',JSON.stringify(review,null,2)+'\n');
console.log(JSON.stringify(review.tool));
