import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
// Usage: node scripts/package-sector-building-art.mjs [asset-id ...]
// With ids, only those assets are re-encoded; every other entry keeps its
// receipted file, hashes and size from the current manifest. Entries no input
// file lists (the ruin restorations baked by scripts/bake-ruin-restorations.mjs)
// are carried over unchanged, in their place.
const manifestPath=path.resolve('docs/art/sector-building-art-v1.json');
const only=new Set(process.argv.slice(2));
const previousAssets=JSON.parse(await fs.readFile(manifestPath,'utf8')).assets;
const previous=new Map(previousAssets.map(asset=>[asset.id,asset]));
const manifest=JSON.parse(await fs.readFile(path.resolve('docs/art/sector-building-art-inputs-v1.json'),'utf8'));
manifest.assets.push(...JSON.parse(await fs.readFile(path.resolve('docs/art/sector-building-restoration-inputs-v1.json'),'utf8')).assets);
manifest.assets.push(...JSON.parse(await fs.readFile(path.resolve('docs/art/sector-building-winter-inputs-v1.json'),'utf8')).assets);
// Road places reuse the reviewed campaign painting of the same place.
manifest.assets.push(...JSON.parse(await fs.readFile(path.resolve('docs/art/sector-building-road-place-inputs-v1.json'),'utf8')).assets);
for(const id of only)if(!manifest.assets.some(asset=>asset.id===id))throw new Error('Unknown asset '+id);
const directory=path.resolve('shinobij.client/public/sector-buildings');
await fs.mkdir(directory,{recursive:true});
for(const asset of manifest.assets){
    if(only.size&&!only.has(asset.id)){
        const kept=previous.get(asset.id);
        if(!kept)throw new Error('No receipted entry for '+asset.id+'; package it by id');
        Object.assign(asset,{file:kept.file,sourceSha256:kept.sourceSha256,sha256:kept.sha256,bytes:kept.bytes});
        continue;
    }
    const output=path.join(directory,asset.id+'-v1.webp');
    if(!asset.source)throw new Error('Missing generated source for '+asset.id);
    const source=await fs.readFile(asset.source);
    const pipeline=sharp(source);
    const result=asset.transparent?await pipeline.resize(512,512,{fit:'inside'}).webp({quality:84,alphaQuality:100}).toBuffer():await pipeline.resize(800,450,{fit:'cover'}).webp({quality:78}).toBuffer();
    await fs.writeFile(output,result);
    asset.file=path.relative(process.cwd(),output).split(path.sep).join('/');
    asset.sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
    asset.sha256=crypto.createHash('sha256').update(result).digest('hex');asset.bytes=result.length;
    console.log(asset.id,result.length);
}
const packaged=new Map(manifest.assets.map(asset=>[asset.id,asset]));
manifest.assets=[...previousAssets.map(asset=>packaged.get(asset.id)??asset),...manifest.assets.filter(asset=>!previous.has(asset.id))];
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+String.fromCharCode(10));
