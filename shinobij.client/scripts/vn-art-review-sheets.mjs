import sharp from 'sharp';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root='../tmp/vn-art-audit';
const out=path.join(root,'review');
await mkdir(out,{recursive:true});
const inventory=JSON.parse(await readFile(path.join(root,'current.json'),'utf8'));
const production=JSON.parse(await readFile('../docs/art-audit/production.json','utf8'));
const clean=p=>p.split(/[?#]/)[0];
const approved=new Set(production.assets.map(a=>a.asset));
const assets=[...new Set(Object.keys(inventory.assets).map(clean))].filter(p=>!approved.has(p));
const groups={backgrounds:assets.filter(p=>!p.includes('/portraits/')),portraits:assets.filter(p=>p.includes('/portraits/'))};
async function sheet(items,name,width,height,cols){
 const layers=[];
 for(const [index,item] of items.entries()){
  const x=index%cols*width,y=Math.floor(index/cols)*(height+40);
  layers.push({input:await sharp(item.file).resize(width,height,{fit:'contain',background:'#34383e'}).jpeg().toBuffer(),left:x,top:y});
  const words=item.label.replace(/[<>&]/g,'').match(/.{1,45}/g)||[];
  const svg=`<svg width="${width}" height="40"><rect width="100%" height="100%" fill="#111"/>${words.slice(0,2).map((w,i)=>`<text x="5" y="${15+i*17}" fill="white" font-size="12">${w}</text>`).join('')}</svg>`;
  layers.push({input:Buffer.from(svg),left:x,top:y+height});
 }
 await sharp({create:{width:width*cols,height:Math.ceil(items.length/cols)*(height+40),channels:3,background:'#111'}}).composite(layers).jpeg({quality:90}).toFile(path.join(out,`${name}.jpg`));
}
for(const [kind,paths] of Object.entries(groups)){
 await writeFile(path.join(out,`${kind}.json`),JSON.stringify(paths.map((asset,index)=>({index,asset,consumers:Object.entries(inventory.assets).filter(([p])=>clean(p)===asset).flatMap(([,v])=>v.consumers)})),null,2));
 for(let at=0;at<paths.length;at+=12) await sheet(paths.slice(at,at+12).map((p,i)=>({file:path.join('public',p),label:`${at+i}: ${path.basename(p)}`})),`${kind}-${at}`,kind==='portraits'?225:360,kind==='portraits'?320:220,3);
 console.log(kind,paths.length);
}
const sets=['reference-after','expanded-after','production-after','production-second','interiors-first','interiors-second','interiors-third','interiors-fourth','endings-first','endings-second','endings-third','endings-fourth','field-first','field-second','field-third','field-crop-fixes'];
const captures=[];
for(const set of sets){
 for(const f of await readdir(path.join(root,set))){if(f.endsWith('-390.png'))captures.push({file:path.join(root,set,f),label:f});}
}
const first=production.assets.slice(0,39).map(a=>captures.findLast(c=>c.label===a.key+'-390.png')).filter(Boolean);
await writeFile(path.join(out,'first-phone-index.json'),JSON.stringify(first,null,2));
for(let at=0;at<first.length;at+=4)await sheet(first.slice(at,at+4),`first-phones-${at}`,390,844,2);
console.log('first phones',first.length);
