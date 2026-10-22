import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Raw built-in imagegen drafts are kept outside the shipped public folder.
// Re-run after an intentional source change, then repeat native art review.
const root='output/living-world/festival',baseFile='shinobij.client/public/sector-map/s14.webp';
const openArea={left:744,top:648,width:140,height:140},coverArea={left:768,top:679,width:60,height:54};
const cropOrigin={left:680,top:560,width:256,height:256};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=await readFile(`${root}/open-counter-provider-v1.png`),closedSource=await readFile(`${root}/packed-counter-closeup-provider-v3.png`),base=await readFile(baseFile);
async function layer(input,area,feather){
 const pixels=await sharp(input).extract(area).removeAlpha().raw().toBuffer(),alpha=Buffer.alloc(area.width*area.height);
 for(let y=0;y<area.height;y++)for(let x=0;x<area.width;x++)alpha[y*area.width+x]=Math.round(255*Math.min(1,Math.min(x,y,area.width-1-x,area.height-1-y)/feather));
 return sharp(pixels,{raw:{width:area.width,height:area.height,channels:3}}).joinChannel(alpha,{raw:{width:area.width,height:area.height,channels:1}}).png().toBuffer();
}
const normalized=await sharp(source).resize(1024,1024).png().toBuffer();
const open=await sharp(base).composite([{input:await layer(normalized,openArea,8),left:openArea.left,top:openArea.top}]).png().toBuffer();
const detail=await sharp(closedSource).resize(256,256).png().toBuffer();
const local={...coverArea,left:coverArea.left-cropOrigin.left,top:coverArea.top-cropOrigin.top};
const packed=await sharp(open).composite([{input:await layer(detail,local,2),left:coverArea.left,top:coverArea.top}]).png().toBuffer();
const original=await sharp(base).removeAlpha().raw().toBuffer(),records=[];
for(const [state,image]of [['open',open],['packed',packed]]){
 const pixels=await sharp(image).removeAlpha().raw().toBuffer();let changedOutside=0;
 for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(x<openArea.left||y<openArea.top||x>=openArea.left+openArea.width||y>=openArea.top+openArea.height)for(let c=0;c<3;c++)if(original[(y*1024+x)*3+c]!==pixels[(y*1024+x)*3+c])changedOutside++;
 if(changedOutside)throw Error('Protected original terrain changed');
 const delivered=await sharp(image).webp({quality:82}).toBuffer();await writeFile(`${root}/${state}-protected-candidate-v1.png`,image);await writeFile(`${root}/${state}-protected-candidate-v1.webp`,delivered);
 await sharp(image).extract({left:670,top:550,width:270,height:280}).png().toFile(`${root}/${state}-protected-detail-v1.png`);
 records.push({state,file:`${root}/${state}-protected-candidate-v1.webp`,sha256:hash(delivered),bytes:delivered.length,changedOutside});
}
const receipt={status:'private terrain candidates; no runtime admission',provider:'built-in image_gen',source:`${root}/open-counter-provider-v1.png`,packedSource:`${root}/packed-counter-closeup-provider-v3.png`,recipe:'scripts/bake-festival-work-paintings.mjs',baseFile,baseSha256:hash(base),sourceSha256:hash(source),packedDetailSha256:hash(closedSource),openArea,coverArea,cropOrigin,staffTile:104,buildingSideTile:92,records,notes:'Only the attached counter enters the canonical floor. Packed differs from open only in the small cover area, so roofs, kettle, pot, ledge and surrounding terrain stay stable. Original public floor unchanged.'};
await writeFile(`${root}/protected-candidates-v1.json`,JSON.stringify(receipt,null,2)+'\n');
const paintings=[];
for(const record of records){
 const key=`festival-tea-counter-${record.state}-v1`,file=`shinobij.client/public/sector-life/${key}.webp`;
 await writeFile(file,await readFile(record.file));paintings.push({key,file,sha256:record.sha256,bytes:record.bytes,width:1024,height:1024,changedOutside:0});
}
await writeFile('shared/festival-work-art-review.json',JSON.stringify({...receipt,status:'runtime candidate; native review required',visualReview:'pending-native-review',paintings,prompts:`${root}/art-and-prompts.json`},null,2)+'\n');
