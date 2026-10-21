import test from 'node:test';
import assert from 'node:assert/strict';
import {petImpostorVertexColor} from './lib/pet-impostor-vertex-color.mjs';
test('uncolored existing meshes retain every exact texture channel value',()=>{
    for(let value=0;value<=255;value++)assert.equal(petImpostorVertexColor(value),value);
});
test('Marmot cap vertex colors recover the original brown boundary from its neutral texel',()=>{
    for(const value of [18,47,86,133,191]){
        const srgb=value/255,linear=srgb<=.04045?srgb/12.92:((srgb+.055)/1.055)**2.4;
        assert.ok(Math.abs(petImpostorVertexColor(255,linear)-value)<1e-10);
    }
    assert.equal(petImpostorVertexColor(128,.5,true),64);
});
