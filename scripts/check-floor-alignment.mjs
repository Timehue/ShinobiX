import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.ts';
import { sectorExits, SECTOR_ROAD_PAIRS } from '../shared/sector-links.ts';
import { sectorArtKey } from '../shared/sector-geo.ts';
import calibration from './sector-floor-alignment-calibration.json' with { type: 'json' };

// Conservative color evidence, not a semantic substitute for the hatched review.
// Each sample covers the standing area at the center of a logical tile.
export function samplePixels(data, width, channels, rect) {
    let count=0, water=0, lava=0, canopy=0, sum=[0,0,0], light=0, square=0, edge=0;
    const [left,top,right,bottom]=rect.map(Math.round);
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++) {
        const offset=(y*width+x)*channels, r=data[offset],g=data[offset+1],b=data[offset+2];
        const l=(r+g+b)/3;
        count++;sum[0]+=r;sum[1]+=g;sum[2]+=b;light+=l;square+=l*l;
        // Coastal water can be green-teal: blue need not exceed green.
        // Require strong cyan chroma to exclude neutral stone and olive foliage.
        const blueWater=b>r+18&&b>g+6&&g>r+8&&b-r>45;
        const tealWater=g>r+25&&b>r+25&&b>=g*.88&&Math.max(g,b)-r>45;
        if((blueWater||tealWater)&&l<175)water++;
        if(r>g*1.7&&r>b*2&&r>130)lava++;
        if(g>r*1.12&&g>b*1.08&&l<72)canopy++;
        if(x>left)edge+=Math.abs(l-(data[offset-channels]+data[offset-channels+1]+data[offset-channels+2])/3);
    }
    return { rgb:sum.map(v=>v/count), brightness:light/count,
        deviation:Math.sqrt(Math.max(0,square/count-(light/count)**2)),
        edge:edge/count, water:water/count,lava:lava/count,canopy:canopy/count };
}

export function classifySample(sample) {
    if(sample.water>.55)return 'water';
    if(sample.lava>.35)return 'lava';
    if(sample.canopy>.65)return 'canopy';
    const [r,g,b]=sample.rgb;
    if(sample.brightness>85&&r>=g*.92&&b<=r+10&&sample.canopy<.1&&sample.water<.1&&sample.lava<.05)return 'ground';
    return 'uncertain';
}

export function alignmentIssues(layout, tiles, layouts=SECTOR_FLOOR_LAYOUTS) {
    const critical=new Set([...sectorExits(layout.sector).map(e=>e.tile),
        ...Object.values(layouts).flatMap(l=>sectorExits(l.sector).filter(e=>e.destinationSector===layout.sector).map(e=>e.destinationTile)),
        ...Object.values(layout.sites).map(s=>s.approach),...(layout.village?[layout.village.approach]:[])]);
    const mask=layout.mask.join('');
    return tiles.flatMap((sample,tile)=>{
        const actual=classifySample(sample),expected=mask[tile],open='='.includes(expected)||expected==='.';
        const mismatch=(open&&['water','lava','canopy'].includes(actual))
            ||(expected==='~'&&actual==='ground')
            ||(expected==='T'&&actual==='ground'&&sample.brightness>145);
        return mismatch?[{tile,expected,actual,critical:critical.has(tile)}]:[];
    });
}

export function seamDifference(a,b) {
    return Math.sqrt(a.reduce((sum,n,i)=>sum+(n-b[i])**2,0)/3);
}

function edgeRect(direction,lane,size,depth=calibration.roadBandDepth) {
    const lo=(lane/12)*size,hi=((lane+1)/12)*size,d=depth*size;
    return direction==='north'?[lo,0,hi,d]:direction==='south'?[lo,size-d,hi,size]
        :direction==='west'?[0,lo,d,hi]:[size-d,lo,size,hi];
}

export async function checkFloorAlignment({root=path.resolve('.'),out=path.resolve('output/connected-world/alignment'),render=true,candidates=false,layouts=SECTOR_FLOOR_LAYOUTS}={}) {
    await fs.mkdir(out,{recursive:true});
    const results=[],images=new Map();
    for(const layout of Object.values(layouts).sort((a,b)=>a.sector-b.sector)) {
        const file=candidates?path.join(root,'output/connected-world',`s${layout.artKey}-candidate.webp`)
            :path.join(root,'shinobij.client/public/sector-map',`s${layout.artKey}.webp`);
        const painting=await fs.readFile(file);
        const sha256=createHash('sha256').update(painting).digest('hex');
        const layoutSha256=createHash('sha256').update(JSON.stringify(layout)).digest('hex');
        const {data,info}=await sharp(painting).removeAlpha().raw().toBuffer({resolveWithObject:true});
        if(info.width!==1024||info.height!==1024)throw Error(`Wrong floor dimensions ${layout.sector}`);
        images.set(layout.sector,{data,info});
        const tiles=Array.from({length:144},(_,tile)=>{
            const x=tile%12,y=Math.floor(tile/12),size=info.width/12;
            return samplePixels(data,info.width,info.channels,[(x+calibration.standingSampleInset)*size,(y+calibration.standingSampleInset)*size,(x+calibration.standingSampleEnd)*size,(y+calibration.standingSampleEnd)*size]);
        });
        const issues=alignmentIssues(layout,tiles,layouts);
        results.push({sector:layout.sector,artKey:layout.artKey,sha256,layoutSha256,issues,tiles});
        if(render) {
            const size=1024/12,mask=layout.mask.join('');
            const cells=[...mask].map((c,t)=>{
                const x=t%12*size,y=Math.floor(t/12)*size;
                return `${'.='.includes(c)?'':`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="url(#hatch)"/>`}
                    <rect x="${x}" y="${y}" width="${size}" height="${size}" fill="none" stroke="red" stroke-opacity=".1"/>
                    <circle cx="${x+size/2}" cy="${y+size/2}" r="5" fill="${'.='.includes(c)?'#62ef9c':'#fa5a66'}"/>
                    <text x="${x+5}" y="${y+17}" font-family="Arial" font-size="14" fill="white" stroke="#111" stroke-width=".5">${t}:${c}</text>`;
            }).join('');
            const overlay=Buffer.from(`<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M-3 3L3-3M0 12L12 0M9 15L15 9" stroke="#ff3445" stroke-width="2" opacity=".32"/></pattern></defs>${cells}</svg>`);
            const reviewFile=path.join(out,`sector-${layout.sector}-mask.png`);
            const reviewImage=await sharp(painting).composite([{input:overlay}]).png().toBuffer();
            await fs.writeFile(reviewFile,reviewImage);
            await fs.writeFile(reviewFile+'.json',JSON.stringify({paintingSha256:sha256,layoutSha256,
                imageSha256:createHash('sha256').update(reviewImage).digest('hex')},null,2)+'\n');
        }
    }
    const seams=SECTOR_ROAD_PAIRS.map(([a,b])=>{
        const exit=sectorExits(a).find(e=>e.destinationSector===b),reverse=sectorExits(b).find(e=>e.destinationSector===a);
        const lane=['north','south'].includes(exit.direction)?exit.tile%12:Math.floor(exit.tile/12);
        const sample=id=>{
            const image=images.get(id),e=id===a?exit:reverse;
            return samplePixels(image.data,image.info.width,image.info.channels,edgeRect(e.direction,lane,image.info.width));
        };
        const left=sample(a),right=sample(b);
        return {a,b,lane,difference:seamDifference(left.rgb,right.rgb),left,right};
    });
    const failedSeams=seams.filter(seam=>seam.difference>calibration.maxRoadRmsDelta);
    const report={results,seams,calibration,scope:'Central standing area color classification plus matching road-mouth edge-band color. Uncertain samples require semantic hatched-image review.'};
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    const critical=results.flatMap(r=>r.issues.filter(i=>i.critical).map(i=>({...i,sector:r.sector})));
    const interior=results.filter(r=>r.issues.filter(i=>!i.critical).length>calibration.maxInteriorMismatches);
    console.log(JSON.stringify({floors:results.length,critical,interior:interior.map(r=>({sector:r.sector,issues:r.issues})),seams:seams.length,failedSeams:failedSeams.map(({a,b,difference})=>({a,b,difference})),out},null,2));
    return {report,critical,interior,failedSeams};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
    void checkFloorAlignment({render:!process.argv.includes('--no-render'),candidates:process.argv.includes('--candidates'),
        out:path.resolve(process.argv.includes('--candidates')?'output/connected-world/candidate-alignment':'output/connected-world/alignment')}).then(result=>{
        if(result.critical.length||result.interior.length||result.failedSeams.length)process.exitCode=1;
    }).catch(error=>{console.error(error);process.exitCode=1;});
}
