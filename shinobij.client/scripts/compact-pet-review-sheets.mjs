// Inspection copies only. Original fixed-camera sheets and hashes are retained.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
const arg=(key,fallback)=>process.argv.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const source=resolve(import.meta.dirname,'../.tmp/pet-shape-review',arg('source','roster-current'));
const output=resolve(import.meta.dirname,'../.tmp/pet-shape-review',arg('label','compact-originals'));
const requested=arg('model','all'),head=process.argv.includes('--head');
const manifest=JSON.parse(await readFile(resolve(source,'manifest.json')));
const ids=requested==='all'?manifest.pets.map(p=>p.id):requested.split(',');
await mkdir(output,{recursive:true});
for(const id of ids){
 const row=manifest.pets.find(p=>p.id===id);if(!row)throw Error(`Missing manifest ${id}`);
 const cells=[],step=160,rowHeight=180,columns=row.progress.length,width=columns*step*2;
 for(const [viewIndex,view] of (head?['head-front','head-side']:['front','side']).entries()){
  const bytes=await readFile(resolve(source,`${id}-${view}.webp`));
  const sheet=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
  for(let r=0;r<row.clips.length;r++)for(let c=0;c<columns;c++){
   const channels=sheet.info.channels,tileData=Buffer.alloc(320*320*channels);
   for(let y=0;y<320;y++)sheet.data.copy(tileData,y*320*channels,((r*344+24+y)*sheet.info.width+c*320)*channels,((r*344+24+y)*sheet.info.width+c*320+320)*channels);
   const tile=sharp(tileData,{raw:{width:320,height:320,channels}});
   let input;
   if(head)input=await tile.resize(step,step).png().toBuffer();
   else {
    const data=tileData,info={channels};
    let x0=320,y0=320,x1=-1,y1=-1;
    for(let y=0;y<320;y++)for(let x=0;x<320;x++){
     const i=(y*320+x)*info.channels;
     if(Math.abs(data[i]-16)+Math.abs(data[i+1]-23)+Math.abs(data[i+2]-38)>25){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    }
    if(x1<0)throw Error(`${id}: empty ${view} ${r} ${c}`);
    x0=Math.max(0,x0-8);y0=Math.max(0,y0-8);x1=Math.min(319,x1+8);y1=Math.min(319,y1+8);
    input=await tile.extract({left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}).resize(step,step,{fit:'contain',background:'#101726'}).png().toBuffer();
   }
   cells.push({input,left:(viewIndex*columns+c)*step,top:r*rowHeight+20});
  }
 }
 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
 const phases=row.progress.map(p=>p*100).join(' ');
 const labels=Buffer.from(`<svg width="${width}" height="${row.clips.length*rowHeight}">${row.clips.map((clip,i)=>`<text x="4" y="${i*rowHeight+15}" fill="white" font-family="sans-serif" font-size="13">${escape(id)} ${escape(clip)} | FRONT ${phases}% | SIDE ${phases}%</text>`).join('')}</svg>`);
 await sharp({create:{width,height:row.clips.length*rowHeight,channels:3,background:'#101726'}}).composite([...cells,{input:labels,left:0,top:0}]).webp({quality:92}).toFile(resolve(output,`${id}-${head?'heads':'body'}.webp`));
 console.log(`${id}: ${row.clips.length} clips compacted`);
}
