import { readFile, writeFile } from 'node:fs/promises';
const manifestPath='../docs/art-audit/production.json';
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const batch=JSON.parse(await readFile(process.argv[2],'utf8'));
for(const asset of batch){
 if(asset.supersedes){
  const previous=manifest.assets.find(a=>a.key===asset.supersedes);
  if(!previous||!asset.reason) throw new Error('Supersession needs an existing key and reason');
  manifest.superseded??=[];
  manifest.superseded.push({...previous,reason:asset.reason,supersededBy:asset.key});
  manifest.assets=manifest.assets.filter(a=>a.key!==asset.supersedes);
 }
 if(manifest.assets.some(a=>a.key===asset.key||a.asset===asset.asset)) throw new Error(`Duplicate asset: ${asset.key}`);
 if(!asset.source||!asset.asset?.endsWith('.webp')||!asset.review) throw new Error('Incomplete reviewed asset');
 manifest.assets.push(asset);
}
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`${batch.length} reviewed assets registered; ${manifest.assets.length} total.`);
