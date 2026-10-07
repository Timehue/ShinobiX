import fs from 'node:fs/promises';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
const target='output/connected-world/landmark-provenance.json';
const artifacts=JSON.parse(await fs.readFile(target,'utf8'));
for(const [key,p] of Object.entries(artifacts)){
 if(!key.endsWith(':rift'))continue;
 const bytes=await sharp(await fs.readFile(p.output)).resize(256,256,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:84,effort:6}).toBuffer();
 await fs.writeFile(p.output,bytes);
 artifacts[key]={...p,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:256,height:256};
}
await fs.writeFile(target,JSON.stringify(artifacts,null,2));console.log('Packaged 10 runtime rifts at their required display resolution.');
