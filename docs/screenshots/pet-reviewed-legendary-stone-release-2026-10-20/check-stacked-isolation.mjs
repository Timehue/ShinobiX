import{readFile,writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';import{resolve}from'node:path';import assert from'node:assert/strict';
const root=resolve('.'),at=resolve('.tmp/ripple-live-release'),base='afb655fabcad4b694aebadc1858a46b5234006e5',c='shinobij.client/',json=async(p,where=at)=>JSON.parse(await readFile(resolve(where,p))),sha=b=>createHash('sha256').update(b).digest('hex'),git=a=>execFileSync('git',a,{cwd:at,encoding:'utf8',maxBuffer:16e6}).trim(),report=await json('docs/audits/pet-reviewed-legendary-stone-release-batch-2026-10-20.json'),ids=new Set(report.ids);
assert.equal(ids.size,18);git(['merge-base','--is-ancestor',base,'HEAD']);
for(const id of ids)for(const[folder,ext]of[['roster','glb'],['warfront-lod/roster','glb'],['warfront-impostors/roster','webp']]){const p=c+'public/pet-models/'+folder+'/'+id+'.'+ext;assert.equal(sha(await readFile(resolve(at,p))),sha(await readFile(resolve(root,p))),id+' reviewed asset changed');}
const expectedPebble={
 'starter-earth.glb':'e3c992fa17abf531f99572620499560295a9a99b3d4518eee180f13a0b69890b',
 'warfront-lod/starter-earth.glb':'0d32d4a122c8d5524a71489a420ed730986a95bce855bbe864b7dfb341f20bcc',
 'warfront-impostors/starter-earth.webp':'fe80e863de1972674df6ae6cbff4710766e6b183ee2a401a5b4d1f152142c354',
};for(const[p,h]of Object.entries(expectedPebble))assert.equal(sha(await readFile(resolve(at,c+'public/pet-models/'+p))),h);
const manifests=[];
for(const path of['public/pet-models/roster-manifest.json','public/pet-models/warfront-lod/manifest.json','public/pet-models/warfront-impostors/manifest.json']){
 const p=c+path,next=await json(p),before=JSON.parse(git(['show',base+':'+p]));let checked=0;
 if(Array.isArray(next.entries)){assert.equal(next.entries.length,161);for(const e of before.entries){const id=e.sourceUrl.split('/').at(-1).replace('.glb','');if(ids.has(id))continue;assert.deepEqual(next.entries.find(v=>v.sourceUrl===e.sourceUrl),e,p+'/'+id);checked++;}
  if(next.totals){let changed=false;for(const key of Object.keys(next.totals)){const sum=next.entries.reduce((n,e)=>n+(e[key]??0),0);if(next.totals[key]!==sum){next.totals[key]=sum;changed=true;}}if(changed)await writeFile(resolve(at,p),JSON.stringify(next,null,2)+'\n');}
 }else{for(const[id,e]of Object.entries(before.entries)){if(ids.has(id))continue;assert.deepEqual(next.entries[id],e,p+'/'+id);checked++;}}
 manifests.push({path:p,unselectedEntriesUnchanged:checked});
}
const source=await readFile(resolve(root,c+'src/lib/pet-proper-animation-assets.ts'),'utf8'),target=await readFile(resolve(at,c+'src/lib/pet-proper-animation-assets.ts'),'utf8');
for(const id of [...ids,'starter-earth']){const re=new RegExp("'"+id+"': '[^']+'",'g'),a=[...source.matchAll(re)].map(v=>v[0]),b=[...target.matchAll(re)].map(v=>v[0]);assert.equal(a.length,1,id);assert.deepEqual(b,a,id+' cache differs');}
const changed=git(['diff','--name-only',base,'--',c+'public/pet-models']).split(/\r?\n/).filter(p=>/\.(glb|webp)$/.test(p));for(const p of changed)assert.ok([...ids].some(id=>p.endsWith('/'+id+'.glb')||p.endsWith('/'+id+'.webp')),p);
const result={base,validatedCommit:git(['rev-parse','HEAD']),batchPets:18,reviewedAssetHashesMatched:54,pebbleFullRemakePreserved:true,pebbleCanonicalHashes:expectedPebble,manifests,changedAssetFiles:changed.length,unselectedAssetFilesChanged:0};
await writeFile(resolve(at,c+'.tmp/eighteen-pet-stacked-isolation.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
