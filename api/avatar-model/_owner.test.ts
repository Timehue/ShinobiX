import assert from 'node:assert/strict';
import { test } from 'node:test';

test('model ownership is allocated atomically, remains stable, and does not transfer with a reused name',async()=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner,modelOwnerProof,modelOwnerKey}=await import('./_owner.js');
    const owner='modelidentity';
    await kv.set('save:'+owner,{_saveVersion:1,character:{name:owner,level:10,ryo:50}});
    const [a,b]=await Promise.all([ensureModelOwner(owner),ensureModelOwner(owner)]);
    assert.ok(a.ok && b.ok);assert.equal(a.value.id,b.value.id);
    const oldId=a.value.id, saved=await kv.get('save:'+owner);
    assert.ok(await modelOwnerProof(owner,oldId));
    const again=await ensureModelOwner(owner);assert.ok(again.ok);
    assert.equal(again.value.id,oldId);assert.equal(again._saveVersion,b._saveVersion);
    assert.deepEqual(await kv.get('save:'+owner),saved);
    await kv.set(modelOwnerKey(oldId),{...a.value,state:'deleting'});
    assert.equal((await ensureModelOwner(owner)).ok,false);
    assert.equal(await modelOwnerProof(owner,oldId),null);
    // A genuinely new account has a new save; the old opaque identity is never reassigned.
    await kv.del('save:'+owner);
    await kv.set('save:'+owner,{_saveVersion:1,character:{name:owner,level:10,ryo:7}});
    const newer=await ensureModelOwner(owner);assert.ok(newer.ok);
    assert.notEqual(newer.value.id,oldId);
    assert.ok(await modelOwnerProof(owner,newer.value.id));
    assert.equal(await modelOwnerProof(owner,oldId),null);
    assert.equal((await kv.get<{character:{ryo:number}}>('save:'+owner))?.character.ryo,7);
});

test('corrupted model ownership is refused instead of assigning another identity',async()=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js');const {ensureModelOwner}=await import('./_owner.js');
    await kv.set('save:modelidentitybad',{character:{name:'modelidentitybad',playerModelOwnerId:'invalid'}});
    assert.equal((await ensureModelOwner('modelidentitybad')).ok,false);
    assert.equal((await kv.get<{character:{playerModelOwnerId:string}}>('save:modelidentitybad'))?.character.playerModelOwnerId,'invalid');
});
