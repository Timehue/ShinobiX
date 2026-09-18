import sharp from 'sharp';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
const sources=process.argv.slice(3), out=process.argv[2];
const width=600,height=362,columns=2;
const tiles=[];
for(let i=0;i<sources.length;i++){
 const label=path.basename(sources[i]).replace(/[<>&]/g,'');
 const buffer=await sharp(sources[i]).resize(width,338,{fit:'contain',background:'#171717'}).png().toBuffer();
 tiles.push({input:buffer,left:(i%columns)*width,top:Math.floor(i/columns)*height});
 tiles.push({input:Buffer.from(`<svg width="600" height="24"><rect width="600" height="24" fill="#111"/><text x="8" y="17" fill="white" font-size="14">${label}</text></svg>`),left:(i%columns)*width,top:Math.floor(i/columns)*height+338});
}
await mkdir(path.dirname(out),{recursive:true});
await sharp({create:{width:width*columns,height:height*Math.ceil(sources.length/columns),channels:3,background:'#111'}}).composite(tiles).png().toFile(out);
