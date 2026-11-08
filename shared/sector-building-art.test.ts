import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { SECTOR_BUILDINGS } from './sector-buildings.js';
import { restorationArtBounds, restoredArtFile, ruinRestoration } from './sector-ruin-restorations.js';

test('every building illustration and restoration sprite is a checked local production asset',async()=>{
    const manifest=JSON.parse(await readFile(new URL('../docs/art/sector-building-art-v1.json',import.meta.url),'utf8')) as {assets:{id:string;file:string;sha256:string;bytes:number;prompt:string;transparent?:boolean;kind?:string;width?:number;height?:number}[]};
    const ids=new Set(manifest.assets.map(asset=>asset.id));
    for(const b of SECTOR_BUILDINGS)assert.ok(ids.has(b.art),`${b.id} has a production illustration`);
    for(const b of SECTOR_BUILDINGS.filter(b=>b.structure)){
        const sprite=manifest.assets.find(asset=>asset.id===b.structure!.sprite);
        assert.ok(sprite?.transparent,`${b.id} map sprite is a receipted transparent asset`);
    }
    for(let stage=1;stage<=3;stage++)assert.ok(ids.has(`restoration-stage-${stage}`));
    // Every ruin has its own painted restoration.
    for(const b of SECTOR_BUILDINGS.filter(b=>b.kind==='ruin')){
        assert.ok(ids.has(`restored-${b.id}`),`${b.id} has a painted restoration`);
        assert.ok(ids.has(`weathered-${b.id}`),`${b.id} has a last-day weathered painting`);
    }
    assert.equal(ids.size,manifest.assets.length);
    for(const asset of manifest.assets){
        assert.ok(asset.prompt.length>100,`${asset.id} retains its generation brief`);
        const bytes=await readFile(new URL(`../${asset.file}`,import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.id);
        assert.equal(bytes.length,asset.bytes);assert.ok(bytes.length<128*1024,`${asset.id} delivery budget`);
        const metadata=await sharp(bytes).metadata();
        if(asset.kind==='ruin-restoration'){
            // Baked to the exact floor box the client draws it into, restored and last-day weathered alike.
            const spec=ruinRestoration(asset.id.replace(/^(restored|weathered)-/,''));assert.ok(spec,asset.id);
            const box=restorationArtBounds(spec!);assert.equal(metadata.hasAlpha,true,asset.id);
            assert.equal(metadata.width,box.width,asset.id);assert.equal(metadata.height,box.height,asset.id);
            assert.equal(`/${asset.file.replace('shinobij.client/public/','')}`,restoredArtFile(spec!.buildingId).replace('/restored-',`/${asset.id.split('-')[0]}-`));
        }
        else if(asset.transparent){assert.equal(metadata.hasAlpha,true,asset.id);assert.equal(metadata.width,512);assert.equal(metadata.height,512);}
        else{assert.equal(metadata.width,800);assert.equal(metadata.height,450);}
    }
});
