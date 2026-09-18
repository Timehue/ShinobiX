import sharp from 'sharp';
import { readFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { vnPortraitFrame } from '../src/lib/vn-portrait-framing.ts';
const output = path.resolve('../tmp/vn-art-audit/sizing/review');
await mkdir(output, { recursive: true });
const portraits = JSON.parse(await readFile('../tmp/vn-art-audit/sizing/assets.json', 'utf8'));
const framed = portraits.map((p,i)=>({...p,index:i})).filter(p=>vnPortraitFrame(p.src));
for (const viewport of [390,1440]) {
 const width=viewport===390?390:720, height=viewport===390?844:450, columns=viewport===390?3:2;
 for (let start=0;start<framed.length;start+=6) {
    const slice=framed.slice(start,start+6), tiles=[];
    for (const [i,p] of slice.entries()) {
        const file=path.resolve(`../tmp/vn-art-audit/sizing/all-portraits/npc-${p.index}-${viewport}.png`);
        try{await access(file);}catch{continue;}
        const left=(i%columns)*width,top=Math.floor(i/columns)*(height+24);
        tiles.push({input:await sharp(file).resize(width,height).png().toBuffer(),left,top});
        tiles.push({input:Buffer.from(`<svg width="${width}" height="24"><rect width="100%" height="100%" fill="#111"/><text x="8" y="17" fill="white" font-size="13">${p.index}: ${p.name.replace(/[<>&]/g,'')}</text></svg>`),left,top:top+height});
    }
    if(tiles.length) await sharp({create:{width:width*columns,height:Math.ceil(slice.length/columns)*(height+24),channels:3,background:'#151b25'}}).composite(tiles).jpeg({quality:90}).toFile(path.join(output,`${viewport}-${start}.jpg`));
 }
}
console.log({reviewedFramingPaths:framed.length});
