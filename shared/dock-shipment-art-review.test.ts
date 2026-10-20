import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RESOURCE_NODES,WORLD_BOSS_CRYSTAL_NODES,resourceNodePosition} from './resource-nodes';
const review=JSON.parse(readFileSync(new URL('./dock-shipment-art-review.json',import.meta.url),'utf8')) as {paintings:{file:string;sha256:string;bytes:number;base:string;baseSha256:string;areas:{left:number;top:number;width:number;height:number}[]}[]};
test('both admitted shipment floors retain every existing dock resource site and fit the delivery budget',()=>{
 const nodes=[...RESOURCE_NODES,...WORLD_BOSS_CRYSTAL_NODES].filter(node=>node.sector===2);
 assert.equal(nodes.length,6);assert.equal(review.paintings.length,2);
 const hash=(file:string)=>createHash('sha256').update(readFileSync(new URL(`../${file}`,import.meta.url))).digest('hex');
 for(const painting of review.paintings){
  assert.equal(hash(painting.file),painting.sha256);assert.equal(hash(painting.base),painting.baseSha256);
  assert.equal(readFileSync(new URL(`../${painting.file}`,import.meta.url)).length,painting.bytes);assert(painting.bytes<=256*1024);
  for(const node of nodes){const pos=resourceNodePosition(node),x=pos.left/100*1024,y=pos.top/100*1024;
   for(const area of painting.areas)assert(x<area.left||x>=area.left+area.width||y<area.top||y>=area.top+area.height,`${node.id}: dressing covered the painted resource surface`);
  }
 }
});
