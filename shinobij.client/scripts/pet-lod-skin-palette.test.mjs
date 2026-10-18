import test from 'node:test';
import assert from 'node:assert/strict';
import {petLodSkinPalette,petLodSkinMetricLayout} from './lib/pet-lod-skin-palette.mjs';

test('existing 21/29-joint LOD banks retain every original channel and ordering',()=>{
    for(const n of [21,29])assert.deepEqual(petLodSkinPalette(n,[4,2,0,0],[.7,.3,0,0]),Array.from({length:n},(_,i)=>i));
});
test('an appended limb bank keeps distinct active joint identities within meshoptimizer channel limits',()=>{
    const ids=[32,20,0,0,30,20,0,0],weights=[.75,.25,0,0,.6,.4,0,0];
    const palette=petLodSkinPalette(33,ids,weights);assert.deepEqual(palette,[20,30,32]);
    const dense=Array.from({length:2},()=>new Array(palette.length).fill(0));
    for(let v=0;v<2;v++)for(let s=0;s<4;s++)if(weights[v*4+s]>0)dense[v][palette.indexOf(ids[v*4+s])]+=weights[v*4+s];
    assert.deepEqual(dense,[[.25,0,.75],[.4,.6,0]]);
    assert.ok(palette.length+5<=32);
});
test('oversized active palettes and invalid influence streams fail explicitly',()=>{
    const ids=Array.from({length:36},(_,i)=>i),weights=new Array(36).fill(.25);
    assert.throws(()=>petLodSkinPalette(37,ids,weights),/active joint count/);
    assert.throws(()=>petLodSkinPalette(33,[33,0,0,0],[1,0,0,0]),/Invalid Warfront skin influence/);
    assert.throws(()=>petLodSkinPalette(33,[1,0,0,0],[NaN,0,0,0]),/Invalid Warfront skin influence/);
});

test('large active banks keep every distinct skin channel within the 32-channel metric budget',()=>{
    for(const n of [21,27,28,29,30,31,32]){
        const palette=Array.from({length:n},(_,i)=>i),layout=petLodSkinMetricLayout(palette);
        assert.ok(layout.attributeStride<=32);assert.equal(layout.attributeWeights.length,layout.attributeStride);
        assert.equal(layout.includeNormals,n<=29);assert.equal(layout.includeUvs,n<=27);
        for(let j=0;j<n;j++)assert.equal(layout.attributeWeights[layout.skinOffset+j],1);
        if(n<=29)assert.equal(layout.attributeStride,n+(n<=27?5:3));
    }
    const ids=Array.from({length:32},(_,i)=>i),weights=new Array(32).fill(.25);
    assert.deepEqual(petLodSkinPalette(33,ids,weights),ids);
});
