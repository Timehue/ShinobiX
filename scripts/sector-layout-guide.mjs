import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sectorRoadRoutes } from './sector-road-routes.mjs';

export const GUIDE_COLORS = { '.': '#ccd0bf', '=': '#dbb989', '#': '#454951', T: '#365e42', '~': '#427485', B: '#bd85be' };

/** Build the occupancy reference from the exact layout that will accompany its painting. */
export function sectorLayoutGuideSvg(layout) {
    const siteColor=(x,y)=>Object.entries(layout.sites).find(([kind,site])=>kind!=='rift'
        && x>=site.footprint[0]&&x<site.footprint[0]+site.footprint[2]
        && y>=site.footprint[1]&&y<site.footprint[1]+site.footprint[2])?.[0];
    const rects=layout.mask.flatMap((row,y)=>[...row].map((cell,x)=>{
        const color=cell==='B'&&!layout.village
            ?({stronghold:'#bd85be',shrine:'#d2af60',cairn:'#b4a7ce'})[siteColor(x,y)]
            :GUIDE_COLORS[cell==='='&&layout.sector!==99?'.':cell];
        if(!color)throw Error(`Unknown guide material ${layout.sector}:${x},${y}`);
        return `<rect x="${x*100}" y="${y*100}" width="100" height="100" fill="${color}"/>`;
    })).join('');
    const paths=sectorRoadRoutes(layout).map(route=>{
        const points=route.map(tile=>[tile%12*100+50,Math.floor(tile/12)*100+50]);
        const first=route[0];
        if(first<12)points.unshift([points[0][0],-50]);
        else if(first>=132)points.unshift([points[0][0],1250]);
        else if(first%12===0)points.unshift([-50,points[0][1]]);
        else if(first%12===11)points.unshift([1250,points[0][1]]);
        return `<polyline points="${points.map(point=>point.join(',')).join(' ')}" fill="none" stroke="${GUIDE_COLORS['=']}" stroke-width="100" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">${rects}${paths}</svg>`;
}

export async function writeSectorLayoutGuide(layout,{out=path.resolve('output/connected-world')}={}) {
    await fs.mkdir(out,{recursive:true});
    const file=path.join(out,`s${layout.artKey}-guide.png`);
    await sharp(Buffer.from(sectorLayoutGuideSvg(layout))).png().toFile(file);
    return file;
}
