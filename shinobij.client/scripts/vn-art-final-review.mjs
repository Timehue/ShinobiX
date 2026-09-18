// Diagnostic contact sheets and exact script contexts, never runtime assets.
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root='../tmp/vn-art-audit';
const out=path.join(root,'final-review');
await mkdir(out,{recursive:true});
const inventory=JSON.parse(await readFile(path.join(root,'current.json'),'utf8'));
const production=JSON.parse(await readFile('../docs/art-audit/production.json','utf8'));
const clean=p=>p.split(/[?#]/)[0];
const produced=new Set(production.assets.map(a=>a.asset));
const retained=[...new Set(Object.keys(inventory.assets).map(clean))].filter(p=>!produced.has(p));
const portraits=retained.filter(p=>p.startsWith('/portraits/'));
for(let at=0;at<portraits.length;at+=12){
 const slice=portraits.slice(at,at+12), layers=[];
 for(const [i,asset] of slice.entries()){
  const data=await sharp(path.join('public',asset)).resize(225,330,{fit:'contain',background:'#5685a0'}).flatten({background:'#5685a0'}).jpeg({quality:90}).toBuffer();
  const x=i%3*225,y=Math.floor(i/3)*360;
  layers.push({input:data,left:x,top:y});
  const label=path.basename(asset).replace(/[<>&]/g,'');
  layers.push({input:Buffer.from(`<svg width="225" height="30"><rect width="100%" height="100%" fill="#111"/><text x="4" y="18" fill="white" font-size="10">${at+i}: ${label}</text></svg>`),left:x,top:y+330});
 }
 await sharp({create:{width:675,height:Math.ceil(slice.length/3)*360,channels:3,background:'#111'}}).composite(layers).jpeg({quality:90}).toFile(path.join(out,`retained-alpha-${at}.jpg`));
}
const contexts=retained.filter(p=>!p.startsWith('/portraits/')).map(asset=>{
 const rows=inventory.rows.filter(r=>r.presentations.some(p=>clean(p.background)===asset));
 const scenes=[...new Set(rows.map(r=>`${r.eventId} / ${r.title}: ${r.scene}`))];
 return [asset,...scenes.map(s=>'  '+s)].join('\n');
});
await writeFile(path.join(out,'retained-background-contexts.txt'),contexts.join('\n\n'));
console.log(JSON.stringify({retained:retained.length,portraits:portraits.length,backgrounds:contexts.length}));
