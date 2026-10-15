/* Contact sheets for inspecting a painted card beside its matching duel views.
 * node scripts/chronicle-figure-review.cjs [--ids tc-61,...] [--tag figures-01] [--include-partial]
 */
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'shinobij.client/art-source/chronicle-refresh/manifest.json'),'utf8'));
const idsIndex=process.argv.indexOf('--ids'),tagIndex=process.argv.indexOf('--tag');
const ids=idsIndex>=0?new Set(process.argv[idsIndex+1].split(',')):null;
const tag=tagIndex>=0?process.argv[tagIndex+1].replace(/[^a-z0-9-]/gi,''):'figures';
const partial=process.argv.includes('--include-partial');
const rows=manifest.cards.filter(row=>row.status==='packaged'&&(partial?(row.figures?.front||row.figures?.back):(row.figures?.front&&row.figures?.back))&&(!ids||ids.has(row.id)));
const publicDir=path.join(root,'shinobij.client/public');
const evidence=path.join(root,'shinobij.client/art-source/chronicle-refresh/review');
async function main(){
  fs.mkdirSync(evidence,{recursive:true});
  for(let start=0;start<rows.length;start+=12){
    const page=rows.slice(start,start+12),layers=[];
    for(let i=0;i<page.length;i++){
      const row=page[i],left=(i%3)*400,top=Math.floor(i/3)*260;
      const name=`${row.id} ${row.name}`.replaceAll('&','&amp;').replaceAll('<','&lt;');
      layers.push({input:Buffer.from(`<svg width="400" height="25"><rect width="400" height="25" fill="#101820"/><text x="8" y="17" fill="#f3e8cc" font-size="12" font-family="Arial">${name}</text></svg>`),left,top});
      layers.push({input:await sharp(path.join(publicDir,row.runtimePath)).resize(110,210,{fit:'contain',background:'#00000000'}).png().toBuffer(),left:left+4,top:top+30});
      for(const [direction,x] of [['front',120],['back',260]]){
        const figure=row.figures[direction];
        layers.push({input:figure?await sharp(path.join(publicDir,figure.runtimePath)).resize(132,210,{fit:'contain',background:'#00000000'}).png().toBuffer():Buffer.from(`<svg width="132" height="210"><text x="18" y="110" fill="#a8b9c7" font-size="11" font-family="Arial">${direction.toUpperCase()} PENDING</text></svg>`),left:left+x,top:top+30});
      }
      layers.push({input:Buffer.from('<svg width="400" height="18"><text x="142" y="13" fill="white" font-size="10" font-family="Arial">FRONT</text><text x="286" y="13" fill="white" font-size="10" font-family="Arial">BACK</text></svg>'),left,top:top+242});
    }
    const output=path.join(evidence,`${tag}-${String(start/12+1).padStart(2,'0')}.png`);
    await sharp({create:{width:1200,height:Math.ceil(page.length/3)*260,channels:3,background:'#303d48'}}).composite(layers).png().toFile(output);
    console.log(path.relative(root,output).replaceAll('\\','/'));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
