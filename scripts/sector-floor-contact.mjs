import fs from 'node:fs/promises';
import sharp from 'sharp';
const out='output/connected-world';
const sources=JSON.parse(await fs.readFile(out+'/floor-sources.json','utf8'));
const tasks=JSON.parse(await fs.readFile(out+'/tasks.json','utf8'));
const ids=process.argv.slice(2).map(Number);
const selected=sources.filter(s=>!ids.length||ids.includes(s.sector));
for(let offset=0;offset<selected.length;offset+=12){
 const chunk=selected.slice(offset,offset+12), layers=[];
 for(let i=0;i<chunk.length;i++){
  const s=chunk[i],t=tasks.find(t=>t.id===s.sector);
  const source=process.env.REVIEW_PACKED==='1'?out+'/s'+t.artKey+'-candidate.webp':s.path;
  layers.push({input:await sharp(source).resize(400,400).toBuffer(),left:i%3*400,top:Math.floor(i/3)*425});
  layers.push({input:Buffer.from('<svg width="400" height="25"><text x="8" y="18" fill="white" font-family="Arial" font-size="15">Sector '+s.sector+' · '+t.name+'</text></svg>'),left:i%3*400,top:Math.floor(i/3)*425+400});
 }
 const target=out+'/floor-contact-'+(ids.length?'selected-':'')+offset/12+'.png';
 await sharp({create:{width:1200,height:Math.ceil(chunk.length/3)*425,channels:3,background:'#141c20'}}).composite(layers).png().toFile(target);console.log(target);
}
