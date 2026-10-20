import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {RESOURCE_NODES,RETIRED_RESOURCE_NODE_IDS,resourceNode,validResourceNodeTerrain} from './resource-nodes.js';

test('the festival counter floors retain the reviewed original terrain, real staffing points and retired hut mine',async()=>{
    const review=JSON.parse(readFileSync(new URL('festival-work-art-review.json',import.meta.url),'utf8'));
    const file=(name:string)=>readFileSync(new URL('../'+name,import.meta.url));
    const hash=(name:string)=>createHash('sha256').update(file(name)).digest('hex');
    assert.match(review.visualReview,/^passed/);assert.equal(hash(review.baseFile),review.baseSha256);
    for(const [source,sha]of [[review.source,review.sourceSha256],[review.packedSource,review.packedDetailSha256]]){assert.match(sha,/^[a-f0-9]{64}$/);if(existsSync(new URL('../'+source,import.meta.url)))assert.equal(hash(source),sha);}
    assert.deepEqual(review.openArea,{left:744,top:648,width:140,height:140});assert.deepEqual(review.coverArea,{left:768,top:679,width:60,height:54});
    assert.equal(review.staffTile,104);assert.equal(review.buildingSideTile,92);assert.equal(review.paintings.length,2);
    for(const floor of review.paintings){assert.equal(hash(floor.file),floor.sha256);assert.equal(file(floor.file).length,floor.bytes);assert(floor.bytes<300_000);const meta=await sharp(file(floor.file)).metadata();assert.equal(meta.width,1024);assert.equal(meta.height,1024);}
    assert(review.records.every((record:{changedOutside:number})=>record.changedOutside===0),'original RGB is protected outside the counter before lossy delivery compression');
    const resources=JSON.parse(file('shared/resource-node-review.json').toString('utf8'));
    assert(RETIRED_RESOURCE_NODE_IDS.includes('resource-78'));assert(!RESOURCE_NODES.some(node=>node.id==='resource-78'),'the unsupported hut mine remains absent from the active cast');
    assert.equal(validResourceNodeTerrain(resourceNode('resource-78')!),false,'historical attempts retain the original ID without authorizing a new gather');
    for(const floor of review.paintings)assert(resources.paintings.some((record:{file:string;sha256:string})=>record.file===floor.file&&record.sha256===floor.sha256));
});
