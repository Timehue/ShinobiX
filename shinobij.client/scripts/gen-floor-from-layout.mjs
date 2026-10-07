import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { sectorExits, sectorExitById } from '../../shared/sector-links.ts';
import { sectorArtKey } from '../../shared/sector-geo.ts';
import { writeSectorLayoutGuide } from '../../scripts/sector-layout-guide.mjs';

/** Construct model references; native compositing changes the guide, never a delivered painting. */
export async function neighborConditionedGuide(task, { root=path.resolve('.'), out=path.resolve('output/connected-world/conditioned'), candidates=false,
    basePainting, destinations, layouts:providedLayouts, basePrompt }={}) {
    await fs.mkdir(out,{recursive:true});
    const layouts=providedLayouts??JSON.parse(await fs.readFile(path.join(root,'output/connected-world/layouts.json'),'utf8'));
    const layout=layouts[task.artKey];
    if(!layout||layout.sector!==task.id)throw Error(`Missing current layout for sector ${task.id}`);
    if(destinations?.some(destination=>!sectorExits(task.id).some(exit=>exit.destinationSector===destination)))throw Error('Requested neighbor is not connected to this sector');
    // Guides can become stale after a mask correction. Rebuild before every job.
    const base=basePainting??await writeSectorLayoutGuide(layout,{out:path.join(root,'output/connected-world')});
    const layers=[],mouths=[],neighbors=[];
    for(const exit of sectorExits(task.id).filter(exit=>!destinations||destinations.includes(exit.destinationSector))) {
        const reverse=sectorExitById(exit.destinationSector,exit.destinationExitId);
        if(!reverse)throw Error(`Missing reverse exit ${exit.id}`);
        const artKey=sectorArtKey(exit.destinationSector);
        const file=candidates?path.join(root,'output/connected-world',`s${artKey}-candidate.webp`)
            :path.join(root,'shinobij.client/public/sector-map',`s${artKey}.webp`);
        const horizontal=['north','south'].includes(exit.direction);
        const lane=horizontal?reverse.tile%12:Math.floor(reverse.tile/12);
        // Guides are 1200px: one cell is exactly 100px. Preserve the existing road lane.
        const image=sharp(file).resize(1200,1200);
        const crop=horizontal?{left:(lane-1)*100,top:reverse.direction==='south'?1100:0,width:300,height:100}
            :{left:reverse.direction==='east'?1100:0,top:(lane-1)*100,width:100,height:300};
        // Sharp applies flip/flop before extraction even when called afterwards.
        // Finish the crop first, then mirror only that extracted reverse edge.
        const extracted=await image.extract(crop).png().toBuffer();
        const strip=await sharp(extracted)[horizontal?'flip':'flop']().png().toBuffer();
        layers.push({input:strip,
            left:horizontal?(lane-1)*100:exit.direction==='east'?1100:0,
            top:horizontal?(exit.direction==='south'?1100:0):(lane-1)*100});
        // Adjacent exits have overlapping three-cell references. Restore every
        // one-cell road mouth last, so a neighbor's border never covers another exit.
        mouths.push({input:await sharp(strip).extract(horizontal
            ?{left:100,top:0,width:100,height:100}
            :{left:0,top:100,width:100,height:100}).png().toBuffer(),
            left:horizontal?lane*100:exit.direction==='east'?1100:0,
            top:horizontal?(exit.direction==='south'?1100:0):lane*100});
        neighbors.push({exit:exit.id,destination:exit.destinationSector,artKey,file,reverseExit:reverse.id,
            sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
    }
    const guide=path.join(out,`s${task.artKey}-${basePainting?'painted-':''}neighbor-guide.png`);
    await sharp(base).resize(1200,1200).composite([...layers,...mouths]).png().toFile(guide);
    const prompt=basePrompt??await fs.readFile(path.join(root,'output/connected-world',`s${task.artKey}-prompt.txt`),'utf8');
    const conditionedPrompt=prompt+'\nEDGE REFERENCES: Photographic strips in this guide are the real adjacent paintings, mirrored outward from their matching road mouths. Continue their stone material, scale, tone and bordering biome precisely into this board. Preserve the lane and width. The flat-color interior is strict occupancy geometry: accessible pale or tan zones contain only ankle-height material, never tree canopy, tree trunks, roof overhangs or tall rock. Entire roof silhouettes, wall shadows, trunks and tall cliff silhouettes stay inside the colored blocked unions. Remove guide colors from the final painting. Match the existing regional palette; this is an alignment correction, not a palette change.\n';
    await fs.writeFile(path.join(out,`s${task.artKey}-conditioned-prompt.txt`),conditionedPrompt);
    await fs.writeFile(path.join(out,`s${task.artKey}-neighbors.json`),JSON.stringify(neighbors,null,2)+'\n');
    return {sector:task.id,artKey:task.artKey,guide,prompt:conditionedPrompt,neighbors,edgeReferenceVersion:2,
        layoutSha256:createHash('sha256').update(JSON.stringify(layout)).digest('hex'),
        guideSha256:createHash('sha256').update(await fs.readFile(guide)).digest('hex')};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
    void (async()=>{
    const root=path.resolve('.'),tasks=JSON.parse(await fs.readFile('output/connected-world/tasks.json','utf8'));
    const selected=process.argv.slice(2).filter(a=>!a.startsWith('--')).map(Number);
    const results=[];
    for(const task of tasks.filter(t=>!selected.length||selected.includes(t.id)))results.push(await neighborConditionedGuide(task,{root,candidates:process.argv.includes('--candidates')}));
    const manifest='output/connected-world/conditioned/tasks.json';
    // A targeted repair must not discard the other sectors' reference records.
    const previous=JSON.parse(await fs.readFile(manifest,'utf8').catch(()=> '[]'));
    const merged=new Map(previous.map(task=>[task.sector,task]));
    for(const result of results)merged.set(result.sector,result);
    const complete=[...merged.values()].sort((a,b)=>a.sector-b.sector);
    await fs.writeFile(manifest,JSON.stringify(complete,null,2)+'\n');
    console.log(`Prepared ${results.length} neighbor-conditioned guides and complete prompts. Use image_gen with the guide and existing floor as the style reference.`);
    })().catch(error=>{console.error(error);process.exitCode=1;});
}
