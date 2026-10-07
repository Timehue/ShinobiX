import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';
import { GUIDE_COLORS, sectorLayoutGuideSvg } from './sector-layout-guide.mjs';

test('all 66 exact-layout guide tile centers agree with their current movement mask',async()=>{
    let checked=0;
    for(const layout of Object.values(SECTOR_FLOOR_LAYOUTS)) {
        const {data,info}=await sharp(Buffer.from(sectorLayoutGuideSvg(layout))).removeAlpha().raw().toBuffer({resolveWithObject:true});
        assert.equal(info.width,1200);assert.equal(info.height,1200);
        for(let tile=0;tile<144;tile++) {
            const cell=layout.mask[Math.floor(tile/12)]![tile%12]!;
            const x=tile%12*100+50,y=Math.floor(tile/12)*100+50,offset=(y*info.width+x)*info.channels;
            let hex=(GUIDE_COLORS as Record<string,string>)[cell]!;
            if(cell==='B'&&!layout.village) {
                const site=Object.entries(layout.sites).find(([kind,site])=>kind!=='rift'&&site
                    &&tile%12>=site.footprint[0]&&tile%12<site.footprint[0]+site.footprint[2]
                    &&Math.floor(tile/12)>=site.footprint[1]&&Math.floor(tile/12)<site.footprint[1]+site.footprint[2]);
                hex=({stronghold:'#bd85be',shrine:'#d2af60',cairn:'#b4a7ce'} as Record<string,string>)[site![0]]!;
            }
            const rgb=[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16));
            assert.deepEqual([...data.subarray(offset,offset+3)],rgb,`Sector ${layout.sector}, tile ${tile}:${cell}`);
            checked++;
        }
    }
    assert.equal(checked,9504);
});
