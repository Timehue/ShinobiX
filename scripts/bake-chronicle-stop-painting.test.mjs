import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('the admitted Chronicle tabletop preserves every road, rock, water tile and surrounding painted prop pixel',async()=>{
    const base=await sharp('shinobij.client/public/sector-life/midlands-tea-stop-v1.webp').removeAlpha().raw().toBuffer();
    const file='shinobij.client/public/sector-life/midlands-chronicle-table-v1.webp';
    const current=await sharp(file).removeAlpha().raw().toBuffer();
    assert.equal(current.length,base.length);
    let changed=0;
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)for(let c=0;c<3;c++)if(base[(y*1024+x)*3+c]!==current[(y*1024+x)*3+c]) {
        changed++;assert(x>=270&&x<341&&y>=737&&y<787,`protected pixel ${x},${y}`);
    }
    assert(changed>0,'cards must be present on the tabletop');
    const review=JSON.parse(readFileSync('shared/resource-node-review.json','utf8'));
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),review.paintings.find(p=>p.file===file)?.sha256,'the new painting also passes the gathering terrain review');
});
