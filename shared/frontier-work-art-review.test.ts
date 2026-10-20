import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {RESOURCE_NODES,RETIRED_RESOURCE_NODE_IDS} from './resource-nodes.js';
import {FRONTIER_SITES} from './sector-frontier-work.js';

test('frontier gear floors are reviewed protected terrain, preserve the real ore, and never restore the retired ruin mines',async()=>{
    const review=JSON.parse(readFileSync(new URL('frontier-work-art-review.json',import.meta.url),'utf8'));
    const file=(name:string)=>readFileSync(new URL('../'+name,import.meta.url)),hash=(name:string)=>createHash('sha256').update(file(name)).digest('hex');
    assert.match(review.visualReview,/^passed/);assert.equal(review.records.length,2);
    const terrain=JSON.parse(file('shared/resource-node-review.json').toString('utf8'));
    for(const r of review.records){
        assert.equal(hash(r.baseFile),r.baseSha256);assert.equal(hash(r.file),r.sha256);if(existsSync(new URL('../'+r.sourceFile,import.meta.url)))assert.equal(hash(r.sourceFile),r.sourceSha256);
        assert.equal(r.changedOutside,0);assert.equal(file(r.file).length,r.bytes);assert(r.bytes<280_000);const meta=await sharp(file(r.file)).metadata();assert.equal(meta.width,1024);assert.equal(meta.height,1024);
        assert.equal(r.inspection,FRONTIER_SITES[r.sector].inspection);assert.equal(r.key,FRONTIER_SITES[r.sector].painting);
        assert(terrain.paintings.some((p:{file:string;sha256:string})=>p.file===r.file&&p.sha256===r.sha256));
        for(const node of RESOURCE_NODES.filter(n=>n.sector===r.sector))for(const tile of [node.target,node.approach]){
            const x=tile%12/12*1024,y=Math.floor(tile/12)/12*1024,size=1024/12;
            assert(x+size<=r.area.left||x>=r.area.left+r.area.width||y+size<=r.area.top||y>=r.area.top+r.area.height,'protected detail cannot repaint an active resource or approach');
        }
    }
    assert.equal(RESOURCE_NODES.filter(n=>n.sector===55).length,1);assert.equal(RESOURCE_NODES.filter(n=>n.sector===60).length,0);
    for(const id of ['resource-23','resource-24'])assert(RETIRED_RESOURCE_NODE_IDS.includes(id));
});
