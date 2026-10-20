import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {composeDockShipmentPainting,DOCK_SHIPMENT_BASE} from './bake-dock-shipment-paintings.mjs';
test('both shipment dressings preserve every channel outside their small authored areas, including paving and water',async()=>{
 const base=readFileSync(DOCK_SHIPMENT_BASE),provider=await sharp({create:{width:1024,height:1024,channels:3,background:'#a9824e'}}).png().toBuffer();
 for(const kind of ['spilled','delivered']){
  const result=await composeDockShipmentPainting(base,provider,kind);assert.equal(result.changedOutside,0);assert.ok(result.changedInside>0);
  assert(result.areas.every(box=>kind==='spilled'?box.top+box.height<=425:box.left+box.width<=348&&box.top+box.height<=722));
 }
});
