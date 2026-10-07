import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { classifySample, samplePixels, seamDifference, alignmentIssues } from './check-floor-alignment.mjs';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';

test('painted water, lava and dense canopy cannot pass as walking ground',()=>{
    const sample=(rgb:number[])=>samplePixels(Buffer.from(Array.from({length:64},()=>rgb).flat()),8,3,[0,0,8,8]);
    assert.equal(classifySample(sample([30,65,130])),'water');
    assert.equal(classifySample(sample([220,60,20])),'lava');
    assert.equal(classifySample(sample([20,60,35])),'canopy');
    assert.equal(classifySample(sample([145,140,135])),'ground');
    assert.equal(seamDifference([10,20,30],[10,20,30]),0);
    assert.equal(seamDifference([0,0,0],[255,255,255]),255);
    const layout=Object.values(SECTOR_FLOOR_LAYOUTS)[0]!;
    const open=layout.mask.join('').indexOf('=');
    const tiles=Array.from({length:144},()=>sample([145,140,135]));
    tiles[open]=sample([30,65,130]);
    assert.ok(alignmentIssues(layout,tiles).some((issue:{tile:number;actual:string})=>issue.tile===open&&issue.actual==='water'));
});

test('green-teal coastal water is detected without flagging olive ground or neutral mineral',()=>{
    const sample=(rgb:number[])=>samplePixels(Buffer.from(Array.from({length:64},()=>rgb).flat()),8,3,[0,0,8,8]);
    // Observed mean RGB of rejected Western Piers pass4 walking72:
    // (39.33,84.91,90.05). The sea's green/blue channels are almost equal.
    for(const rgb of [[39,85,90],[26,92,85],[50,103,103]]){
        assert.equal(classifySample(sample(rgb)),'water',String(rgb));
    }
    for(const rgb of [[20,60,35],[85,100,65],[62,83,96],[140,162,183],[145,140,135]]){
        assert.notEqual(classifySample(sample(rgb)),'water',String(rgb));
    }
});

test('the observed coastal standing-area painting cannot pass as dry walking',async()=>{
    const file=await readFile(new URL('./fixtures/coastal-water-standing-area.png',import.meta.url));
    const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const water=samplePixels(data,info.width,info.channels,[0,0,info.width,info.height]);
    assert.equal(classifySample(water),'water');
    const layout=Object.values(SECTOR_FLOOR_LAYOUTS).find(l=>l.sector===7)!;
    const ground=samplePixels(Buffer.from(Array.from({length:64},()=>[145,140,135]).flat()),8,3,[0,0,8,8]);
    const tiles=Array.from({length:144},()=>ground);
    tiles[72]=water;
    assert.ok(alignmentIssues(layout,tiles).some((issue:{tile:number;actual:string})=>issue.tile===72&&issue.actual==='water'));
});
