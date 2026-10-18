import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryFittedLimbClips} from './audit-pet-fitted-limb-clips.mjs';

test('an original humanoid rig is not mistaken for an appended quadruped rig',async()=>{
    assert.equal(await inventoryFittedLimbClips(new URL('./fixtures/pet-polar-bear-anatomical-limbs/legendary-13.glb',import.meta.url)),null);
});

test('Polar Bear original joints need no legacy prefix to expose omitted fitted clips',async()=>{
    const r=await inventoryFittedLimbClips(new URL('./fixtures/pet-polar-bear-coordinated-actions/legendary-13.glb',import.meta.url));
    assert.equal(r.fittedJointCount,12);
    assert.equal(r.originalJointCount,12);
    assert.equal(r.unrenamedOriginalJointCount,12);
    assert.equal(r.legacyJointCount,0);
    assert.equal(r.clips.length,13);
    for(const name of ['gallop_jump','death','entrance','victory']){
        const clip=r.clips.find(c=>c.name===name);
        assert.equal(clip.fitted.length,0);
        assert.ok(clip.original.length>0,name);
    }
});

test('legacy-prefixed Oni joints remain detectable after the naming-independent scan',async()=>{
    const r=await inventoryFittedLimbClips(new URL('./fixtures/pet-omitted-limb-performances/mythic-4-before-lod.glb',import.meta.url));
    assert.equal(r.fittedJointCount,12);
    assert.equal(r.originalJointCount,12);
    assert.equal(r.legacyJointCount,12);
    assert.equal(r.unrenamedOriginalJointCount,0);
    assert.equal(r.clips.length,13);
    assert.ok(r.clips.every(c=>c.original.length===c.legacy.length));
});
