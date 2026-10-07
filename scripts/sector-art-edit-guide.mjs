import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { GUIDE_COLORS } from './sector-layout-guide.mjs';

// This is a model input guide, never a delivered floor. Final repainting uses image_gen.
export async function renderSectorArtEditGuide({ layout, painting, material, tiles }) {
    if(!layout||!GUIDE_COLORS[material]||!tiles.length)throw Error('Invalid layout/material or empty selection');
    for(const tile of tiles)if(!Number.isInteger(tile)||tile<0||tile>=144||layout.mask[Math.floor(tile/12)][tile%12]!==material)throw Error(`Guide tile ${tile} does not match the current ${material} footprint`);
    const dimensions=await sharp(painting).metadata();
    if(dimensions.width!==1024||dimensions.height!==1024)throw Error('Paint guide requires a full-frame 1024 floor');
    const rects=tiles.map(tile=>`<rect x="${tile%12*1024/12}" y="${Math.floor(tile/12)*1024/12}" width="${1024/12}" height="${1024/12}" fill="${GUIDE_COLORS[material]}"/>`).join('');
    const overlay=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${rects}</svg>`);
    return sharp(painting).composite([{input:overlay}]).png().toBuffer();
}

async function main() {
    const [sectorArg,revision,material,tileArg]=process.argv.slice(2);
    if(!sectorArg||!revision||!material||!tileArg)throw Error('Usage: node --import tsx scripts/sector-art-edit-guide.mjs sector revision mask-character tile,tile');
    const sector=Number(sectorArg),out=path.resolve('output/connected-world');
    const layouts=JSON.parse(await fs.readFile(path.join(out,'layouts.json'),'utf8'));
    const layout=Object.values(layouts).find(item=>item.sector===sector);
    if(!layout)throw Error('Invalid layout');
    const tiles=tileArg==='all'?Array.from({length:144},(_,tile)=>tile).filter(tile=>layout.mask[Math.floor(tile/12)][tile%12]===material):tileArg.split(',').map(Number);
    const source=path.join(out,`s${layout.artKey}-candidate.webp`),painting=await fs.readFile(source);
    const guide=await renderSectorArtEditGuide({layout,painting,material,tiles});
    const file=path.join(out,`sector-${sector}-job-${revision}-paint-guide.png`);
    await fs.writeFile(file,guide);
    const metadata={sector,artKey:layout.artKey,revision,material,tiles,file,
        sourceSha256:createHash('sha256').update(painting).digest('hex'),
        layoutSha256:createHash('sha256').update(JSON.stringify(layout)).digest('hex'),
        sha256:createHash('sha256').update(guide).digest('hex'),purpose:'model-input-only-not-delivered-art'};
    await fs.writeFile(file+'.json',JSON.stringify(metadata,null,2)+'\n');
    console.log(JSON.stringify(metadata,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
    void main().catch(error=>{console.error(error);process.exitCode=1;});
}
