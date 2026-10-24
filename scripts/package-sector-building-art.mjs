import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const manifestPath=path.resolve('docs/art/sector-building-art-v1.json');
const manifest=JSON.parse(await fs.readFile(path.resolve('docs/art/sector-building-art-inputs-v1.json'),'utf8'));
manifest.assets.push(...JSON.parse(await fs.readFile(path.resolve('docs/art/sector-building-restoration-inputs-v1.json'),'utf8')).assets);
manifest.assets.push(...JSON.parse(await fs.readFile(path.resolve('docs/art/sector-building-winter-inputs-v1.json'),'utf8')).assets);
const directory=path.resolve('shinobij.client/public/sector-buildings');
await fs.mkdir(directory,{recursive:true});
for(const asset of manifest.assets){
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
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+String.fromCharCode(10));
