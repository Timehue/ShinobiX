import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { SECTOR_BUILDINGS } from './sector-buildings.js';

test('every building illustration and restoration sprite is a checked local production asset',async()=>{
    const manifest=JSON.parse(await readFile(new URL('../docs/art/sector-building-art-v1.json',import.meta.url),'utf8')) as {assets:{id:string;file:string;sha256:string;bytes:number;prompt:string;transparent?:boolean}[]};
    const ids=new Set(manifest.assets.map(asset=>asset.id));
    for(const b of SECTOR_BUILDINGS)assert.ok(ids.has(b.art),`${b.id} has a production illustration`);
    for(let stage=1;stage<=3;stage++)assert.ok(ids.has(`restoration-stage-${stage}`));
    assert.equal(ids.size,manifest.assets.length);
    for(const asset of manifest.assets){
        assert.ok(asset.prompt.length>100,`${asset.id} retains its generation brief`);
        const bytes=await readFile(new URL(`../${asset.file}`,import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.id);
        assert.equal(bytes.length,asset.bytes);assert.ok(bytes.length<128*1024,`${asset.id} delivery budget`);
        const metadata=await sharp(bytes).metadata();
        if(asset.transparent){assert.equal(metadata.hasAlpha,true,asset.id);assert.equal(metadata.width,512);assert.equal(metadata.height,512);}
        else{assert.equal(metadata.width,800);assert.equal(metadata.height,450);}
    }
});
