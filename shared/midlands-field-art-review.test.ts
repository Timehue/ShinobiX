import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

test('both garden floors protect the original tea/card states, all rock and the actual ore node',async()=>{
    const review=JSON.parse(readFileSync(new URL('midlands-field-art-review.json',import.meta.url),'utf8'));
    const hash=(file:string)=>createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex');
    // Raw provider drafts stay outside runtime/CI. Public floors, original bases
    // and their reviewed hashes are required in every clean checkout.
    assert.match(review.sourceSha256,/^[a-f0-9]{64}$/);if(existsSync(new URL('../'+review.source,import.meta.url)))assert.equal(review.sourceSha256,hash(review.source));
    assert.match(review.visualReview,/^passed/);assert.deepEqual(review.areas,[{left:600,top:700,width:350,height:250}]);assert.deepEqual(review.workTiles,[127,115]);assert.equal(review.paintings.length,2);
    for(const floor of review.paintings){assert.match(floor.visualReview,/^passed/);assert.equal(floor.changedOutside,0);assert.equal(hash(floor.baseFile),floor.baseSha256);assert.equal(hash(`shinobij.client/public/sector-life/${floor.key}.webp`),floor.deliveredSha256);assert.equal(floor.width,1024);assert.equal(floor.height,1024);assert(floor.bytes<280_000);}
    const resources=JSON.parse(readFileSync(new URL('resource-node-review.json',import.meta.url),'utf8'));const nodes=resources.nodes.filter((node:{sector:number})=>node.sector===42);assert.deepEqual(nodes.map((node:{id:string;target:number;approach:number})=>[node.id,node.target,node.approach]),[['resource-68',80,68]]);
    const tool=readFileSync(new URL('../'+review.tool.file,import.meta.url)),meta=await sharp(tool).metadata();assert.equal(hash(review.tool.file),review.tool.sha256);assert(meta.hasAlpha);assert(meta.width!<=32&&meta.height===96);assert(tool.length<4096);
});
