import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Runtime custody checks use admitted project assets only. The stronger raw
// pixel/lighting verifier explicitly consumes retained authoring PNGs in output/.
test('all fifteen regional shrine assets match their reviewed admission receipts',async()=>{
 const root='shinobij.client/public/',hash=b=>createHash('sha256').update(b).digest('hex');
 const recipes=[['tide',4,34],['frostveil',31,53],['moonwell',23,16],['hollowgate',56,13],['ancients',44,10]];
 for(const [id,sector,artKey] of recipes)for(const state of ['dormant','supported','radiant']){
  const key=`${id}-${state}-shrine-v1`,receipt=JSON.parse(await readFile(`${root}sector-life/${key}.json`,'utf8')),bytes=await readFile(`${root}sector-life/${key}.webp`);
  const base=await readFile(id==='frostveil'?`${root}sector-life/shrinefall-warming-stop-v1.webp`:`${root}sector-map/s${artKey}.webp`);
  assert.equal(receipt.sector,sector);assert.equal(receipt.artKey,artKey);assert.equal(receipt.key,key);assert.equal(receipt.deliveredSha256,hash(bytes));assert.equal(receipt.bytes,bytes.length);assert.equal(receipt.baseSha256,hash(base));
  assert.equal(receipt.changedOutside,0);assert.equal(receipt.areas.length,4);assert.match(receipt.visualReview,/^passed/);
  for(const digest of Object.values(receipt.sourceHashes))assert.match(digest,/^[a-f0-9]{64}$/);
 }
});
