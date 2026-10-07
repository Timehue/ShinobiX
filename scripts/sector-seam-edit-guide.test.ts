import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { neighborConditionedGuide } from '../shinobij.client/scripts/gen-floor-from-layout.mjs';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';
import { sectorExits, sectorExitById } from '../shared/sector-links.js';
import { sectorArtKey } from '../shared/sector-geo.js';

test('seam references retain the actual reverse edge pixels, including adjacent mouths', async t => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sector-seam-guide-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const basePainting=path.join(dir,'base.png');
    await sharp({create:{width:1200,height:1200,channels:3,background:'#faeedd'}}).png().toFile(basePainting);
    const west=sectorExits(26).filter(exit=>exit.direction==='west');
    assert.equal(west.length,2);
    assert.equal(Math.abs(Math.floor(west[0]!.tile/12)-Math.floor(west[1]!.tile/12)),1);
    for(const sector of [9,26]) {
    const result=await neighborConditionedGuide({id:sector,artKey:sectorArtKey(sector)},{root,out:dir,basePainting,layouts:SECTOR_FLOOR_LAYOUTS,basePrompt:'Keep the scene.'});
    const {data,info}=await sharp(result.guide).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(const exit of sectorExits(sector)) {
        const reverse=sectorExitById(exit.destinationSector,exit.destinationExitId)!;
        const horizontal=['north','south'].includes(exit.direction);
        const lane=horizontal?reverse.tile%12:Math.floor(reverse.tile/12);
        const neighbor=path.join(root,'shinobij.client/public/sector-map',`s${sectorArtKey(exit.destinationSector)}.webp`);
        const crop=horizontal?{left:lane*100,top:reverse.direction==='south'?1100:0,width:100,height:100}
            :{left:reverse.direction==='east'?1100:0,top:lane*100,width:100,height:100};
        // Independent oracle: decode the whole neighbor, then index its actual
        // reverse-edge pixels. Sharp mirrors before extraction regardless of
        // method order, so repeating an extract().flip() pipeline hides this bug.
        const expected=await sharp(neighbor).resize(1200,1200).removeAlpha().raw().toBuffer();
        // An overlapping three-tile reference must never overwrite its neighbor's one-tile mouth.
        const left=horizontal?lane*100:exit.direction==='east'?1100:0;
        const top=horizontal?(exit.direction==='south'?1100:0):lane*100;
        for(let y=0;y<100;y++)for(let x=0;x<100;x++) {
            const sx=crop.left+(horizontal?x:99-x),sy=crop.top+(horizontal?99-y:y);
            const offset=((top+y)*1200+left+x)*info.channels,at=(sy*1200+sx)*3;
            if(data[offset]!==expected[at]||data[offset+1]!==expected[at+1]||data[offset+2]!==expected[at+2])assert.fail(`Incorrect actual-neighbor pixel at ${exit.id}:${x},${y}`);
        }
    }
    const center=(600*1200+600)*info.channels;
    assert.deepEqual([...data.subarray(center,center+3)],[250,238,221]);
    }
});
