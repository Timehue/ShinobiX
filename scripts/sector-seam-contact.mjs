import fs from 'node:fs/promises';
import sharp from 'sharp';
import {SECTOR_EXITS} from '../shared/sector-links.ts';
import {sectorArtKey} from '../shared/sector-geo.ts';
const out='output/connected-world', pairs=SECTOR_EXITS.filter(e=>e.sector<e.destinationSector);
const board=id=>out+'/s'+sectorArtKey(id)+'-candidate.webp';
const crop=async(id,tile,direction)=>{
 const center=Math.round((['north','south'].includes(direction)?tile%12:Math.floor(tile/12))/12*1024+1024/24);
 const offset=Math.max(0,Math.min(768,center-128));
 const region=direction==='east'?{left:896,top:offset,width:128,height:256}:direction==='west'?{left:0,top:offset,width:128,height:256}:direction==='north'?{left:offset,top:0,width:256,height:128}:{left:offset,top:896,width:256,height:128};
 return sharp(board(id)).extract(region).toBuffer();
};
const opposite={east:'west',west:'east',north:'south',south:'north'};
for(let start=0;start<pairs.length;start+=16){
 const layers=[], chunk=pairs.slice(start,start+16);
 for(let i=0;i<chunk.length;i++){
  const e=chunk[i],a=await crop(e.sector,e.tile,e.direction),b=await crop(e.destinationSector,e.destinationTile,opposite[e.direction]),x=i%4*256,y=Math.floor(i/4)*280;
  if(e.direction==='east'||e.direction==='west'){
   layers.push({input:e.direction==='east'?a:b,left:x,top:y},{input:e.direction==='east'?b:a,left:x+128,top:y});
  }else layers.push({input:e.direction==='south'?a:b,left:x,top:y},{input:e.direction==='south'?b:a,left:x,top:y+128});
  layers.push({input:Buffer.from('<svg width="256" height="24"><text x="5" y="18" fill="white" font-family="Arial" font-size="13">'+e.sector+' '+e.direction+' → '+e.destinationSector+'</text></svg>'),left:x,top:y+256});
 }
 const target=out+'/seam-contact-'+start/16+'.png';
 await sharp({create:{width:1024,height:Math.ceil(chunk.length/4)*280,channels:3,background:'#141c20'}}).composite(layers).png().toFile(target);console.log(target);
}
